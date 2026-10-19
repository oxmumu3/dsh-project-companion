/**
 * Host-level alarm scheduler for dsh-proactive.
 *
 * One serialized drive loop owns all firing decisions:
 *   - due detection (nextDueAt <= now), boot overdue policy, quiet-hours
 *     gating (respect=true occurrences inside the window are DROPPED: once
 *     alarms complete, repeating alarms fast-forward to the first anchor
 *     outside the window), hourly wake cap, and daily budget gating for
 *     alarms that respect quiet hours;
 *   - one alarm at a time through the WakeDriver, then advances its state
 *     from the analyzed outcome: once -> completed, every/cron -> next due;
 *   - bounded retries for busy/failed fires, coalesced re-arming.
 *
 * The loop never busy-waits: every pass ends by arming a single timer at the
 * nearest due alarm (split across the 24.8-day setTimeout ceiling) or by
 * scheduling an explicit deferral for busy/deferred outcomes.
 *
 * v2 (260907-proactive-alarm-v2): the alarm/heartbeat wake_reason split is
 * gone; `respectQuietHours` is a per-alarm switch. true = occurrences inside
 * quiet hours are skipped (no late re-delivery) and gated by the daily
 * budget; false = user-requested, quiet hours and budget exempt. Formal
 * gating order: quiet(+respect) -> hourly cap -> budget (+respect) -> fire.
 * every/cron jitter is pre-drawn into nextDueAt so this loop never waits.
 */
import { firesAlarm, instantEpoch, isRecord, nextDriftingOccurrence } from "./domain.js";
import { nextCronOccurrence } from "./cron.js";
import { isInQuietHours } from "./config.js";
const MAX_TIMEOUT_MS = 2_147_483_647;
const BUSY_RETRY_MS = 30_000;
const QUIET_DEFER_MS = 5 * 60_000;
/** Bound for the quiet-window fast-forward walk (pure math per iteration). */
const QUIET_SKIP_MAX_ITERATIONS = 4096;
export class ProactiveScheduler {
    deps;
    config;
    timer = null;
    driveChain = Promise.resolve();
    driveRequested = false;
    stopped = false;
    retries = new Map();
    recentFires = [];
    constructor(deps) {
        this.deps = deps;
        this.config = deps.config;
    }
    start() {
        this.stopped = false;
        this.recoverInFlight();
        this.requestDrive();
    }
    stop() {
        this.stopped = true;
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    /** Coalesced tick: at most one drive per macrotask. */
    requestDrive() {
        if (this.stopped || this.driveRequested)
            return;
        this.driveRequested = true;
        this.driveChain = this.driveChain
            .then(() => this.drive().catch((error) => {
            // A drive pass must never take the chain down (unhandled rejection):
            // a transient store failure is logged and the next pass re-runs.
            const message = error instanceof Error ? error.message : String(error);
            this.deps.log("error", "drive pass failed: " + message);
        }))
            .finally(() => {
            this.driveRequested = false;
        });
    }
    now() {
        return this.deps.now?.() ?? Date.now();
    }
    /** Boot recovery: anything left in-flight resumes as overdue. */
    recoverInFlight() {
        const nowIso = new Date(this.now()).toISOString();
        for (const alarm of this.deps.store.listAlarms()) {
            if (alarm.status !== "in-flight")
                continue;
            const recovered = { ...alarm, status: "scheduled", nextDueAt: nowIso, updatedAt: nowIso };
            this.deps.store.replaceAlarm(recovered);
            this.deps.log("info", "recovered in-flight alarm " + alarm.id);
        }
        void this.deps.store.persist().catch(() => undefined);
    }
    dueAlarms(now) {
        return this.deps.store
            .listAlarms()
            // "file" alarms are subscription handles: they never fire, and their
            // nextDueAt is a derived display value (the earliest child wake).
            .filter((alarm) => alarm.status === "scheduled" && firesAlarm(alarm.type) && instantEpoch(alarm.nextDueAt) <= now)
            .sort((left, right) => instantEpoch(left.nextDueAt) - instantEpoch(right.nextDueAt));
    }
    hourlyCapHit(now) {
        const windowStart = now - 3600_000;
        this.recentFires = this.recentFires.filter((t) => t > windowStart);
        return this.recentFires.length >= this.config.maxWakeupsPerHour;
    }
    async drive() {
        if (this.stopped)
            return;
        const now = this.now();
        let due = this.dueAlarms(now);
        // Boot overdue policy applies only to alarms that were already past due
        // when the first pass ran; distinguish by a scheduler-lifetime flag.
        if (!this.bootHandled) {
            this.bootHandled = true;
            if (this.config.bootOverduePolicy !== "fire") {
                for (const alarm of due) {
                    const outcome = await this.applyBootOverdue(alarm, now);
                    if (outcome === "retry")
                        this.deferRetry(alarm, BUSY_RETRY_MS);
                }
                // The policy pass may have advanced or cancelled alarms: re-derive.
                due = this.dueAlarms(this.now());
            }
        }
        for (const alarm of due) {
            if (this.stopped)
                break;
            // Freshness check: skip entries a previous pass already moved.
            const current = this.deps.store.getAlarm(alarm.id);
            if (current === undefined || current.status !== "scheduled")
                continue;
            try {
                const result = await this.fireOne(current, this.now());
                if (result === "retry")
                    this.deferRetry(current, BUSY_RETRY_MS);
            }
            catch (error) {
                // One bad alarm (corrupt trigger, storage failure, ...) must never
                // take down the whole drive loop: record it failed and move on.
                const message = error instanceof Error ? error.message : String(error);
                this.deps.log("error", "alarm " + current.id + " failed in drive: " + message);
                await this.recordRun(current, "failed", 0, "exception in drive: " + message).catch(() => undefined);
                this.retries.delete(current.id);
                this.terminate(current, "failed", "exception in drive");
            }
        }
        if (this.stopped)
            return;
        this.arm();
    }
    bootHandled = false;
    async applyBootOverdue(alarm, now) {
        const policy = this.config.bootOverduePolicy;
        // Called only for non-"fire" policies: "notify-only" records a skip;
        // "drop" cancels/clears without a run.
        if (policy === "notify-only") {
            await this.recordSkip(alarm, "boot overdue: notify-only policy");
            this.advancePast(alarm, now, "skipped");
            return "skipped";
        }
        await this.recordSkip(alarm, "boot overdue: drop policy");
        if (alarm.type !== "once")
            this.advancePast(alarm, now, "skipped");
        else
            this.terminate(alarm, "cancelled", "boot overdue: drop policy");
        return "skipped";
    }
    /** Gate + run one due alarm; returns the transition the loop should apply. */
    async fireOne(alarm, now) {
        const quiet = isInQuietHours(now, this.config);
        if (quiet && alarm.respectQuietHours) {
            return await this.skipPastQuiet(alarm, now);
        }
        if (this.hourlyCapHit(now)) {
            this.deflect(alarm, QUIET_DEFER_MS);
            return "skipped";
        }
        if (alarm.respectQuietHours) {
            const used = this.deps.store.budgetFor(new Date(now).toISOString().slice(0, 10));
            if (used >= this.config.maxDeliveriesPerDay) {
                await this.recordSkip(alarm, "daily budget exhausted (" + used + "/" + this.config.maxDeliveriesPerDay + ")");
                this.advancePast(alarm, now, "skipped");
                return "skipped";
            }
        }
        // Crash-window semantics (plan 4.7): persist in-flight BEFORE the wake
        // runs. A restart then finds the alarm in-flight and recovers it as due
        // instead of leaving it scheduled-and-due (which would fire it again).
        const inflight = { ...alarm, status: "in-flight", updatedAt: new Date(this.now()).toISOString() };
        this.deps.store.replaceAlarm(inflight);
        await this.deps.store.persist().catch(() => undefined);
        const start = this.now();
        const result = await this.deps.runWake(alarm);
        const elapsed = this.now() - start;
        if (elapsed >= 1000)
            this.deps.log("info", "wake " + alarm.id + " took " + elapsed + "ms");
        if (result.outcome === "busy") {
            this.bumpRetry(alarm);
            if (this.retries.get(alarm.id) >= this.config.maxRetriesPerFire) {
                await this.recordSkip(alarm, "busy after " + this.config.maxRetriesPerFire + " retries");
                this.advancePast(alarm, now, "skipped");
                this.retries.delete(alarm.id);
                return "skipped";
            }
            return "retry";
        }
        if (result.outcome === "defer") {
            this.deferWakeTo(alarm, result.deferUntilMs ?? this.now() + 1000);
            return "deferred";
        }
        if (result.outcome === "failed") {
            this.bumpRetry(alarm);
            const attempt = this.retries.get(alarm.id);
            // The driver's error text rides in the note: cordis info/warn never
            // reaches a persisted log, so runs.jsonl is the only durable trace of
            // WHY a wake failed. sessionId goes to its own (last) slot — passing it
            // positionally as the 5th arg once misfiled it into reasoningSummary.
            const reason = result.error !== undefined && result.error !== "" ? ": " + result.error : "";
            await this.recordRun(alarm, "failed", 0, "wake failed (attempt " + attempt + ")" + reason, undefined, undefined, undefined, result.sessionId);
            if (attempt >= this.config.maxRetriesPerFire) {
                this.retries.delete(alarm.id);
                if (alarm.type === "once") {
                    this.terminate(alarm, "failed", "persistent wake failure");
                }
                else {
                    this.deps.log("warn", "alarm " + alarm.id + " hit max retries; advancing to next occurrence");
                    this.advancePast(alarm, now, "failed");
                }
                return "failed";
            }
            return "retry";
        }
        if (result.outcome === "skipped") {
            // Nothing was woken (no eligible destination): a legitimate no-op, not
            // a failure — record it, advance past this occurrence, never retry
            // (the condition does not change on its own) and never burn the
            // hourly cap or the budget.
            this.retries.delete(alarm.id);
            await this.recordSkip(alarm, result.skipReason ?? "no eligible target session");
            this.advancePast(alarm, now, "skipped");
            return "skipped";
        }
        // ok — count successful wakes only, so busy/failed retries do not burn
        // the hourly cap window for unrelated alarms.
        this.recentFires.push(this.now());
        this.retries.delete(alarm.id);
        const analysis = result.analysis;
        const actualSessionId = result.sessionId;
        const utcDate = new Date(this.now()).toISOString().slice(0, 10);
        if (analysis.budgetDelta > 0) {
            await this.deps.store.spendBudget(utcDate, analysis.budgetDelta);
        }
        const note = analysis.note;
        await this.recordRun(alarm, analysis.decision, analysis.budgetDelta, note, analysis.reasoningSummary, analysis.replySummary, analysis.noReplyReason, actualSessionId);
        this.advancePast(alarm, now, analysis.decision);
        return "advanced";
    }
    bumpRetry(alarm) {
        this.retries.set(alarm.id, (this.retries.get(alarm.id) ?? 0) + 1);
    }
    async recordRun(alarm, decision, budgetDelta, note, reasoningSummary, replySummary, noReplyReason, sessionIdOverride) {
        const rec = {
            id: "run_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
            alarmId: alarm.id,
            // The session the wake actually ran in (a fork/new child for those
            // target modes); for skips/failures without a real wake it is the owner.
            sessionId: sessionIdOverride ?? alarm.ownerSessionId,
            firedAt: new Date().toISOString(),
            decision,
            budgetDelta,
            ...(note !== undefined ? { note } : {}),
            ...(reasoningSummary !== undefined ? { reasoningSummary } : {}),
            ...(replySummary !== undefined ? { replySummary } : {}),
            ...(noReplyReason !== undefined ? { noReplyReason } : {})
        };
        await this.deps.store.appendRun(rec).catch(() => undefined);
    }
    async recordSkip(alarm, reason) {
        await this.recordRun(alarm, "skipped", 0, reason);
    }
    /** Once: terminate. every/cron: move to the next occurrence strictly after now. */
    advancePast(alarm, now, _decision) {
        const updated = this.advance(alarm, now);
        this.deps.store.replaceAlarm(updated);
        void this.deps.store.persist().catch(() => undefined);
    }
    advance(alarm, now) {
        const stamp = new Date(now).toISOString();
        if (alarm.type === "once") {
            return { ...alarm, status: "completed", lastRunAt: stamp, runCount: alarm.runCount + 1, updatedAt: stamp };
        }
        const trigger = alarm.trigger;
        let nextDueEpoch;
        let nextTrigger = trigger;
        if (alarm.type === "every") {
            // Corrupt every data (missing/invalid trigger) must fail closed instead
            // of throwing into the drive loop: mark failed so it leaves the due set.
            if (!isRecord(trigger) || !("everySeconds" in trigger) || typeof trigger["everySeconds"] !== "number" || !Number.isSafeInteger(trigger["everySeconds"])) {
                return { ...alarm, status: "failed", lastRunAt: stamp, runCount: alarm.runCount + 1, updatedAt: stamp };
            }
            // jitterSeconds is an enhancement field: a corrupt/malformed value
            // degrades softly to the deterministic interval instead of killing the
            // alarm — everySeconds is the load-bearing part.
            const jitterSeconds = typeof trigger["jitterSeconds"] === "number" && Number.isFinite(trigger["jitterSeconds"]) && trigger["jitterSeconds"] > 0 ? trigger["jitterSeconds"] : undefined;
            nextDueEpoch = nextDriftingOccurrence(now, trigger["everySeconds"], this.now(), jitterSeconds, this.deps.random ?? Math.random);
            nextTrigger = { ...trigger, anchor: stamp };
        }
        else {
            // cron — the expression and zone are the load-bearing parts; a corrupt
            // pair fails closed to "failed" and leaves the due set.
            if (!isRecord(trigger) || !("expr" in trigger) || typeof trigger["expr"] !== "string") {
                return { ...alarm, status: "failed", lastRunAt: stamp, runCount: alarm.runCount + 1, updatedAt: stamp };
            }
            try {
                const base = nextCronOccurrence(trigger["expr"], alarm.timeZone, now);
                const jitterSeconds = typeof trigger["jitterSeconds"] === "number" && Number.isFinite(trigger["jitterSeconds"]) && trigger["jitterSeconds"] > 0 ? trigger["jitterSeconds"] : undefined;
                nextDueEpoch = base + (jitterSeconds === undefined ? 0 : Math.floor((this.deps.random ?? Math.random)() * jitterSeconds * 1000));
            }
            catch (error) {
                return { ...alarm, status: "failed", lastRunAt: stamp, runCount: alarm.runCount + 1, updatedAt: stamp };
            }
        }
        return {
            ...alarm,
            trigger: nextTrigger,
            status: "scheduled",
            nextDueAt: new Date(nextDueEpoch).toISOString(),
            lastRunAt: stamp,
            runCount: alarm.runCount + 1,
            updatedAt: stamp
        };
    }
    terminate(alarm, status, note) {
        const updated = { ...alarm, status, updatedAt: new Date().toISOString() };
        this.deps.store.replaceAlarm(updated);
        void this.deps.store.persist().catch(() => undefined);
        this.deps.log("info", "alarm " + alarm.id + " -> " + status + " (" + note + ")");
    }
    /** Rewind one alarm to now + delay without recording; only used by quiet/cap defers. */
    deflect(alarm, delayMs) {
        const updated = {
            ...alarm,
            nextDueAt: new Date(this.now() + delayMs).toISOString(),
            updatedAt: new Date().toISOString()
        };
        this.deps.store.replaceAlarm(updated);
        void this.deps.store.persist().catch(() => undefined);
    }
    /**
     * Quiet-hours gate for alarms that respect it: the occurrence is dropped,
     * not postponed — respect=true alarms are model-initiated, so a late
     * re-delivery at window end would only pile up there. once -> completed
     * with one skipped run; every/cron -> fast-forward to the first anchor
     * outside the window (one skipped run per window entry), so a frequent
     * alarm never spins the drive loop all night.
     */
    async skipPastQuiet(alarm, now) {
        if (alarm.type === "once") {
            await this.recordSkip(alarm, "quiet hours: once alarm due inside the quiet window is dropped");
            this.advancePast(alarm, now, "skipped");
            return "skipped";
        }
        const next = this.nextAwakeOccurrence(alarm, now);
        if (next === undefined) {
            // Corrupt trigger: fail closed like advance() does instead of looping.
            this.deps.log("warn", "alarm " + alarm.id + " has a corrupt " + alarm.type + " trigger; marking failed at the quiet-hours gate");
            this.terminate(alarm, "failed", "corrupt trigger at the quiet-hours gate");
            return "failed";
        }
        await this.recordSkip(alarm, "quiet hours: skipped " + next.skipped + " occurrence" + (next.skipped === 1 ? "" : "s") + " inside the quiet window");
        const stamp = new Date(next.due).toISOString();
        const trigger = isRecord(alarm.trigger) && "anchor" in alarm.trigger ? { ...alarm.trigger, anchor: stamp } : alarm.trigger;
        // Consume the dropped occurrence like every other skip path does
        // (advancePast): runCount +1, lastRunAt = the dropped instant.
        this.deps.store.replaceAlarm({
            ...alarm,
            trigger,
            status: "scheduled",
            nextDueAt: stamp,
            runCount: alarm.runCount + 1,
            lastRunAt: new Date(now).toISOString(),
            updatedAt: new Date(this.now()).toISOString()
        });
        void this.deps.store.persist().catch(() => undefined);
        return "skipped";
    }
    /**
     * First occurrence of a repeating alarm strictly after `from` that lies
     * outside the quiet window, with the number of in-window occurrences
     * consumed; undefined when the trigger is corrupt. Pure schedule math (no
     * store writes), bounded so a pathological interval can never spin —
     * hitting the bound returns the last in-window instant and the next drive
     * pass continues skipping from there. Jitter keeps the same drift
     * semantics as advance() (each candidate redraws; cron candidates drift
     * off the minute grid the same way).
     */
    nextAwakeOccurrence(alarm, from) {
        const random = this.deps.random ?? Math.random;
        const trigger = alarm.trigger;
        if (!isRecord(trigger))
            return undefined;
        const jitterSeconds = typeof trigger["jitterSeconds"] === "number" && Number.isFinite(trigger["jitterSeconds"]) && trigger["jitterSeconds"] > 0 ? trigger["jitterSeconds"] : undefined;
        let cursor = from;
        let skipped = 0;
        if (alarm.type === "every") {
            const everySeconds = trigger["everySeconds"];
            if (typeof everySeconds !== "number" || !Number.isSafeInteger(everySeconds))
                return undefined;
            while (skipped < QUIET_SKIP_MAX_ITERATIONS) {
                cursor = nextDriftingOccurrence(cursor, everySeconds, this.now(), jitterSeconds, random);
                if (!isInQuietHours(cursor, this.config))
                    return { due: cursor, skipped };
                skipped += 1;
            }
            return { due: cursor, skipped };
        }
        const expr = trigger["expr"];
        if (typeof expr !== "string")
            return undefined;
        while (skipped < QUIET_SKIP_MAX_ITERATIONS) {
            let base;
            try {
                base = nextCronOccurrence(expr, alarm.timeZone, cursor);
            }
            catch {
                return undefined;
            }
            cursor = base + (jitterSeconds === undefined ? 0 : Math.floor(random() * jitterSeconds * 1000));
            if (!isInQuietHours(cursor, this.config))
                return { due: cursor, skipped };
            skipped += 1;
        }
        return { due: cursor, skipped };
    }
    /** Defer one due alarm to an absolute time without recording (min-idle gate). */
    deferWakeTo(alarm, atMs) {
        const at = Math.max(atMs, this.now() + 1000);
        const iso = new Date(at).toISOString();
        this.deps.store.replaceAlarm({ ...alarm, status: "scheduled", nextDueAt: iso, updatedAt: new Date(this.now()).toISOString() });
        void this.deps.store.persist().catch(() => undefined);
        this.deps.log("info", "wake " + alarm.id + " deferred to " + iso + " (destination not idle long enough)");
    }
    deferRetry(alarm, delayMs) {
        const updated = { ...alarm, nextDueAt: new Date(this.now() + delayMs).toISOString(), updatedAt: new Date().toISOString() };
        this.deps.store.replaceAlarm(updated);
        void this.deps.store.persist().catch(() => undefined);
    }
    /** Arm a single timer at the nearest due alarm (or explicit deferral). */
    arm() {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.stopped)
            return;
        const now = this.now();
        let next = Infinity;
        for (const alarm of this.deps.store.listAlarms()) {
            if (alarm.status !== "scheduled" || !firesAlarm(alarm.type))
                continue;
            const due = instantEpoch(alarm.nextDueAt);
            if (due > now && due < next)
                next = due;
        }
        if (!Number.isFinite(next))
            return;
        const delay = Math.max(0, Math.min(MAX_TIMEOUT_MS, next - now));
        this.timer = setTimeout(() => {
            this.timer = null;
            this.requestDrive();
        }, delay);
        this.timer.unref?.();
    }
}
