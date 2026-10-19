/**
 * Workspace target resolution for alarms with target_mode "workspace".
 *
 * Two halves:
 *
 *  create-side wiring (resolveWorkspaceArg) — run BEFORE the closed
 *  validateCreateArgs, mirroring wireTimeZones: the model may name the
 *  workspace by registry id, by absolute path, or not at all (default = the
 *  creator session's own workspace). Everything resolves to a canonical,
 *  existence-checked target_workspace_id so the closed validator only ever
 *  sees one spelling. No auto-create: workspaces are user-managed groupings.
 *
 *  fire-side resolution (resolveWorkspaceWakeTarget / WorkspaceWakePort) —
 *  the destination is derived AT FIRE TIME so it always follows the user's
 *  latest activity:
 *    1. the workspace's most recently UPDATED visible session
 *       (updatedAt = max(createdAt, lastPromptAt), the exact sidebar ordering:
 *       GUI session.list semantics — plugin-source wake messages never move
 *       it, so repeated wakes converge on one session until the user prompts
 *       elsewhere in the workspace);
 *    2. else the workspace's newest BLANK session (the GUI's New Session
 *       slot — dsh-client-runtime connectWorkspace reuses it the same way);
 *    3. else "none": nothing is eligible, the fire is SKIPPED. The resolver
 *       never creates a session — ensuring a conversation is target_mode
 *  "new"'s job, not the last-active resolver's.
 *
 *  Subagent-origin sessions, archived sessions, and sessions this plugin
 *  created itself are never eligible. The plugin's own wake products
 *  (target_mode-new sessions, fork children) are bookkept in state.json
 *  (store.recordCreatedSession) and excluded at resolution time: without
 *  that, every new/fork fire injects a fresh top-ranked candidate (createdAt
 *  = fire time) and a later workspace/preset alarm would wake inside the
 *  plugin's own echo instead of the user's conversation. One adoption
 *  escape: a target_mode-new session the user has since typed in (positive
 *  evidence — lastPromptAt !== null) follows the user's activity again.
 *  Fork children inherit their parent's human history (lastPromptAt is not
 *  their own) and stay excluded unconditionally.
 */
import { isRecord, isValidWorkspaceId } from "./domain.js";
/**
 * Live-session event log across dsh versions: the Session class dropped
 * `.events` in 0.1.2-rc.1 in favor of `snapshotEvents()`. A live session
 * whose log cannot be read folds as blank (a fresh GUI slot) — never as a
 * visible destination.
 */
export function liveEventsOf(live) {
    if (Array.isArray(live.events))
        return live.events;
    if (typeof live.snapshotEvents === "function") {
        try {
            return live.snapshotEvents();
        }
        catch {
            return [];
        }
    }
    return [];
}
/**
 * The session's effective preset id, latest `agent-preset/selected` first,
 * header stamp second, resolved by this local fold.
 *
 * The upstream plural package `@deepseek-ai/dsh-agent-presets` was pinned at
 * 0.1.1-rc.2 (its `resolveSessionPreset` export), but that package's module
 * graph imports `{ settingsNamespace }` from `@deepseek-ai/dsh-settings`, an
 * export the 0.1.7 core renamed to `SettingsForms`. Under the profile's
 * runtime interception the name routes to the core install, so even a
 * namespace import fails ESM link-time and takes the whole plugin tree down.
 * The singular successor (`dsh-agent-preset` / `-registry`, which the core
 * ships) exposes preset composition as the `agentPresets` service and does
 * not export `resolveSessionPreset` at all. This identical local fold is the
 * only usable implementation on 0.1.7 — the historic upstream upgrade path
 * (0.1.2-rc.1) is also dead because its `dsh-scope@^0.1.2` peer was never
 * published. Keep this fold; never re-introduce a static import of the
 * plural package at module scope.
 */
export function resolveSessionPresetOf(session) {
    for (let index = session.events.length - 1; index >= 0; index -= 1) {
        const event = session.events[index];
        if (event?.type === "agent-preset/selected")
            return event.data?.agentPreset;
    }
    return session.header.agentPreset;
}
/**
 * Adapt runtime `list()` rows into the header stream the resolvers rank —
 * the single choke point for the snapshot/header contract drift above.
 */
export function coldSessionHeaders(rows) {
    return rows.map((row) => row.header);
}
/**
 * Normalize the workspace argument root before the closed validation:
 *   target_workspace_id  -> validated existence, passed through
 *   target_workspace_path-> resolved through the registry (realpath canon)
 *   neither              -> resolved from the creator session's cwd
 * The output always carries a canonical target_workspace_id (or a closed
 * ToolError); the path key is stripped so validateCreateArgs never sees it.
 */
/** resolveByPath wrapper: a missing directory rejects inside its realpath — fold that into the closed not_found. */
async function resolveWorkspaceByPath(deps, path, missMessage) {
    try {
        const workspace = await deps.registry.resolveByPath(path);
        return workspace === undefined ? { code: "not_found", message: missMessage(path) } : workspace;
    }
    catch (error) {
        // dsh-workspace's resolveByPath realpaths the directory: ENOENT (deleted
        // since registration) surfaces as a throw, not undefined.
        const message = error instanceof Error ? error.message : String(error);
        if (/ENOENT|no such file|missing/i.test(message)) {
            return { code: "not_found", message: "path " + path + " does not exist or is not registered as a workspace (register the directory in the GUI sidebar first)." };
        }
        return { code: "not_found", message: "workspace lookup failed for path " + path + ": " + message };
    }
}
export async function resolveWorkspaceArg(args, deps) {
    const id = args["target_workspace_id"];
    const path = args["target_workspace_path"];
    const count = Number(id !== undefined) + Number(path !== undefined);
    if (count > 1)
        return { code: "invalid_trigger", message: "pass at most one of target_workspace_id, target_workspace_path." };
    let workspace;
    if (id !== undefined) {
        if (typeof id !== "string" || !isValidWorkspaceId(id)) {
            return { code: "invalid_trigger", message: "target_workspace_id must be a workspace registry id (uuid)." };
        }
        workspace = deps.registry.get(id);
        if (workspace === undefined) {
            return { code: "not_found", message: "workspace " + id + " does not exist (it may have been deleted in the GUI)." };
        }
    }
    else if (path !== undefined) {
        if (typeof path !== "string" || path.trim() === "" || path.includes("\0")) {
            return { code: "invalid_trigger", message: "target_workspace_path must be a non-empty absolute directory path." };
        }
        const resolved = await resolveWorkspaceByPath(deps, path, (p) => "no workspace is registered for path " + p + " (register the directory as a workspace in the GUI sidebar first).");
        if ("code" in resolved)
            return resolved;
        workspace = resolved;
    }
    else {
        if (deps.sessionCwd === undefined || deps.sessionCwd === "") {
            return { code: "invalid_trigger", message: "target_mode workspace requires target_workspace_id or target_workspace_path (this session has no cwd to derive one)." };
        }
        const resolved = await resolveWorkspaceByPath(deps, deps.sessionCwd, (p) => "no workspace is registered for this session's directory (" + p + "); pass target_workspace_id or target_workspace_path.");
        if ("code" in resolved)
            return resolved;
        workspace = resolved;
    }
    const next = { ...args };
    delete next["target_workspace_path"];
    next["target_workspace_id"] = workspace.id;
    return next;
}
/**
 * Session-list metadata fold, mirrored from the host's session.list
 * projection (dsh-api-session-controller applySessionListMetadata): blank
 * flips to false on the first turn/start; lastPromptAt tracks the latest
 * human-authored user/message. The event `time` lives at the TOP level of a
 * SessionEvent (`{type, seq, time, data}`) — `data` carries only
 * `{content, id, role, source}` — and the host folds last-wins (not max).
 * Wake framing is a plugin-source notice, so a proactive wake never moves
 * lastPromptAt.
 */
export function listMetadataOf(events) {
    let blank = true;
    let lastPromptAt = null;
    for (const event of events) {
        if (!isRecord(event))
            continue;
        if (event["type"] === "turn/start")
            blank = false;
        if (event["type"] === "user/message") {
            const data = event["data"];
            const source = isRecord(data) ? data["source"] : undefined;
            const time = event["time"];
            if (isRecord(source) && source["kind"] === "user" && typeof time === "number") {
                lastPromptAt = time;
            }
        }
    }
    return { blank, lastPromptAt };
}
/** The sidebar's updatedAt: the later of creation and the latest human prompt. */
export function updatedAtOf(createdAt, metadata) {
    return Math.max(createdAt, metadata?.lastPromptAt ?? 0);
}
/** Deterministic recency comparison: updatedAt, then createdAt, then id. */
function moreRecent(left, right) {
    if (left.updatedAt !== right.updatedAt)
        return left.updatedAt - right.updatedAt;
    if (left.createdAt !== right.createdAt)
        return left.createdAt - right.createdAt;
    return left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0;
}
/**
 * The fire-time destination, mirroring the GUI workspace tree + New Session:
 * the topmost VISIBLE (non-blank, non-subagent) row by recency; else the
 * newest blank row (the New Session slot, connectWorkspace-style); else
 * "none" (the caller skips the fire — it never creates).
 */
export function pickWorkspaceTarget(candidates) {
    const eligible = candidates.filter((candidate) => !candidate.subagent);
    const visible = eligible.filter((candidate) => !candidate.blank);
    let best;
    for (const candidate of visible.length > 0 ? visible : eligible) {
        if (best === undefined || moreRecent(candidate, best) > 0)
            best = candidate;
    }
    return best === undefined ? { kind: "none" } : { kind: "session", sessionId: best.sessionId };
}
/**
 * Whether one plugin-created session stays a legal wake destination. A
 * target_mode-new product the user has ADOPTED (typed in — positive
 * evidence, lastPromptAt !== null) follows the user's activity again;
 * everything else the plugin created (new products nobody typed in, fork
 * children whose human history is inherited) is never eligible.
 */
export function createdSessionEligible(kind, lastPromptAt) {
    return kind === "new" && lastPromptAt != null;
}
/** Resolve the workspace itself; a closed error string when it vanished. */
async function requireWorkspace(deps, workspaceId) {
    const workspace = deps.registry.get(workspaceId);
    if (workspace === undefined) {
        return { error: "workspace " + workspaceId + " no longer exists (deleted in the GUI?); cancel or edit this alarm" };
    }
    return workspace;
}
/**
 * Fire-time destination: rank the workspace's sessions (live fold first,
 * cold projection-cache row second — both are the exact sources the GUI's
 * session.list uses), excluding plugin-created products (see
 * {@link createdSessionEligible}), and pick per {@link pickWorkspaceTarget}.
 * "none" means nothing is eligible — the caller skips the fire.
 */
export async function resolveWorkspaceWakeTarget(deps, workspaceId) {
    const workspace = await requireWorkspace(deps, workspaceId);
    if ("error" in workspace)
        return workspace;
    const archived = new Set(deps.registry.archivedSessionIds);
    const liveById = new Map();
    for (const session of deps.liveSessions())
        liveById.set(session.id, session);
    const coldById = new Map();
    let coldListFailed = false;
    if (deps.coldHeaders !== undefined) {
        try {
            for (const header of await deps.coldHeaders())
                coldById.set(header.id, header);
        }
        catch (error) {
            // A persistence listing failure must not turn into "no sessions":
            // rank from the live store only — but remember it, so an empty result
            // below can fail loudly instead of skipping a wake it could not see.
            coldListFailed = true;
            deps.log("warn", "workspace wake: cold session listing failed: " + (error instanceof Error ? error.message : String(error)));
        }
    }
    const candidates = [];
    for (const sessionId of workspace.sessionIds) {
        if (archived.has(sessionId))
            continue;
        const created = deps.createdSessionKind?.(sessionId);
        const live = liveById.get(sessionId);
        if (live !== undefined) {
            const header = live.header;
            const metadata = listMetadataOf(liveEventsOf(live));
            if (created !== undefined && !createdSessionEligible(created, metadata.lastPromptAt))
                continue;
            candidates.push({
                sessionId,
                updatedAt: updatedAtOf(header?.createdAt ?? 0, metadata),
                createdAt: header?.createdAt ?? 0,
                blank: metadata.blank,
                subagent: header?.origin === "subagent"
            });
            continue;
        }
        const header = coldById.get(sessionId);
        if (header === undefined)
            continue; // neither live nor materialized: not a real destination
        // The sidebar fold's cold read (projectionsFor): seeded (fork) headers
        // carry no cache row on the current host; a missing row stays
        // conservatively visible.
        const metadata = header.isSeeded === true
            ? undefined
            : deps.projectionCache?.cachedSnapshot(header)?.values?.sessionListMetadata;
        if (created !== undefined && !createdSessionEligible(created, metadata?.lastPromptAt))
            continue;
        candidates.push({
            sessionId,
            updatedAt: updatedAtOf(header.createdAt, metadata),
            createdAt: header.createdAt,
            // No cache row (checkpoint never written / host without the cache):
            // conservatively visible — never skip a real conversation.
            blank: metadata?.blank === true,
            subagent: header.origin === "subagent"
        });
    }
    const pick = pickWorkspaceTarget(candidates);
    if (pick.kind === "session")
        return pick;
    if (coldListFailed) {
        // All-cold workspace + transient persistence failure: "no candidates"
        // is unproven here — fail into the retry path rather than skipping a
        // wake aimed at a session we could not see.
        return { error: "cold session listing failed; cannot safely pick a destination (will retry)" };
    }
    return { kind: "none" };
}
/** Assemble the driver-facing port from host-level deps (index.ts wiring). */
export function createWorkspaceWakePort(deps) {
    return {
        resolveTarget: (workspaceId) => resolveWorkspaceWakeTarget(deps, workspaceId),
        async attach(workspaceId, sessionId) {
            const workspace = await requireWorkspace(deps, workspaceId);
            if ("error" in workspace)
                throw new Error(workspace.error);
            if (typeof workspace.attachSession !== "function") {
                throw new Error("workspace " + workspaceId + " exposes no attachSession (registry contract drift)");
            }
            await workspace.attachSession(sessionId);
        },
        async cwdOf(workspaceId) {
            const workspace = await requireWorkspace(deps, workspaceId);
            if ("error" in workspace)
                return workspace;
            if (typeof workspace.status === "function") {
                const status = await workspace.status();
                if (status === "missing-dir") {
                    return { error: "workspace directory is missing: " + workspace.path + " (restore the directory or edit this alarm)" };
                }
            }
            return workspace.path;
        }
    };
}
/**
 * Rank every session running the preset and pick the same way the workspace
 * resolver does (visible first, sidebar recency, subagent/archived/
 * plugin-created never).
 *
 * Preset matching: a LIVE session folds its effective preset (latest
 * `agent-preset/selected` event, header stamp second — the exact fold the
 * wake composition uses); a COLD session only carries its creation-time
 * header stamp, the same limitation the sidebar's cold rows have.
 */
export async function resolvePresetWakeTarget(deps, presetId) {
    const archived = new Set(deps.archivedSessionIds?.() ?? []);
    const liveById = new Map();
    for (const session of deps.liveSessions())
        liveById.set(session.id, session);
    const coldById = new Map();
    let coldListFailed = false;
    if (deps.coldHeaders !== undefined) {
        try {
            for (const header of await deps.coldHeaders())
                coldById.set(header.id, header);
        }
        catch (error) {
            // Same conservative rule as the workspace resolver: a failed cold
            // listing must not fold into "no sessions" — remember it so an empty
            // result fails into the retry path instead of a wrong decision.
            coldListFailed = true;
            deps.log("warn", "preset wake: cold session listing failed: " + (error instanceof Error ? error.message : String(error)));
        }
    }
    const candidates = [];
    for (const live of liveById.values()) {
        if (archived.has(live.id))
            continue;
        const header = live.header;
        if (header?.origin === "subagent")
            continue;
        const events = liveEventsOf(live);
        if (resolveSessionPresetOf({ header: header ?? {}, events }) !== presetId)
            continue;
        const metadata = listMetadataOf(events);
        const created = deps.createdSessionKind?.(live.id);
        if (created !== undefined && !createdSessionEligible(created, metadata.lastPromptAt))
            continue;
        candidates.push({
            sessionId: live.id,
            updatedAt: updatedAtOf(header?.createdAt ?? 0, metadata),
            createdAt: header?.createdAt ?? 0,
            blank: metadata.blank,
            subagent: false
        });
    }
    for (const header of coldById.values()) {
        if (liveById.has(header.id))
            continue;
        if (archived.has(header.id))
            continue;
        if (header.origin === "subagent")
            continue;
        if (header.agentPreset !== presetId)
            continue;
        // The sidebar fold's cold read: seeded (fork) headers carry no cache row;
        // a missing row is conservatively visible.
        const metadata = header.isSeeded === true
            ? undefined
            : deps.projectionCache?.cachedSnapshot(header)?.values?.sessionListMetadata;
        const created = deps.createdSessionKind?.(header.id);
        if (created !== undefined && !createdSessionEligible(created, metadata?.lastPromptAt))
            continue;
        candidates.push({
            sessionId: header.id,
            updatedAt: updatedAtOf(header.createdAt, metadata),
            createdAt: header.createdAt,
            blank: metadata?.blank === true,
            subagent: false
        });
    }
    if (candidates.length === 0) {
        if (coldListFailed) {
            return { error: "cold session listing failed; cannot safely pick a preset destination (will retry)" };
        }
        return { kind: "none" };
    }
    const pick = pickWorkspaceTarget(candidates);
    return pick.kind === "session" ? pick : { kind: "none" };
}
/** Assemble the preset-source port from host-level deps (index.ts wiring). */
export function createPresetWakePort(deps) {
    return {
        resolveTarget: (presetId) => resolvePresetWakeTarget(deps, presetId)
    };
}
