/**
 * The core bridge: WeChat iLink ⇄ DSH agents.
 *
 * Ported design from wechat-opencode (MIT) — https://github.com/pan17/wechat-opencode
 * The OpenCode Server half is replaced by direct in-process DSH service
 * calls: agents are created/resumed through the `agents` registry, WeChat
 * messages enter via `agent.followup`, assistant output leaves via the
 * `session/event` feed, and approval/question cards are MIRRORED to WeChat
 * from the Host `approval/request` and `user-questions/request` waterfalls
 * — the decision point and trigger policy stay exactly as in the GUI
 * (`approval.request` from sandbox escalation, `userQuestions.ask` from
 * the native ask tool). The bridge races `next()` (GUI / other answerers)
 * against the WeChat reply. Whoever answers first wins; there is no
 * custom approval list.
 */
import type { AssistantStreamFrame } from "../dsh/types.js";
import { type BridgeContext } from "../dsh/sessions.js";
import type { Agent, AskUserQuestionAnswer, AskUserQuestionItem } from "../dsh/types.js";
import { type UserState } from "../state.js";
import type { WeChatDSHConfig } from "../config.js";
import { type ConfigStore, type EditableConfig } from "../config-store.js";
export interface LoginState {
    phase: "idle" | "waiting-qr" | "scaned" | "logged-in" | "failed";
    qrUrl?: string;
    error?: string;
    botId?: string;
}
/** Closed approval outcomes the Host waterfall accepts. */
export type ApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";
/**
 * Host `approval/request` waterfall payload (structural). `agent.id` is the
 * live session id; `callId` correlates the GUI tool card when present.
 */
export interface ApprovalRequestLike {
    readonly agent?: {
        readonly id?: string;
        session?: {
            header?: {
                id?: string;
            };
        };
    };
    readonly toolName?: string;
    readonly callId?: string;
    readonly reason?: string;
    readonly signal?: AbortSignal;
}
/**
 * Host `user-questions/request` waterfall payload (structural).
 */
export interface QuestionRequestLike {
    readonly agent?: {
        readonly id?: string;
        session?: {
            header?: {
                id?: string;
            };
        };
    };
    readonly questions?: AskUserQuestionItem[];
    readonly signal?: AbortSignal;
}
/**
 * Structural surface of the DSH `ctx.commands` plugin-owned human command
 * registry (host side). Mirrors only the minimum the bridge consumes:
 *
 * - `find(agent, name)` — name-presence check; the bridge uses this to
 *   decide whether to dispatch natively or fall through to the local
 *   whitelist. Returns `undefined` when the name is not registered for
 *   this agent.
 * - `execute(agent, line, signal)` — full parse + dispatch; returns the
 *   settled `CommandExecution` (`{ commandId, result: CommandResult }`)
 *   or `undefined` for invalid syntax / unknown names. The bridge reads
 *   `result.kind` / `result.text` and renders to WeChat. Per the host
 *   type contract, `CommandResult` is `{ kind: 'success', text? }` or
 *   `{ kind: 'error', text }` — the success text is optional (some
 *   commands reply through `sourceEventSeq` instead), the error text
 *   is required.
 * - `list(agent)` — name-sorted descriptors for discovery; used by
 *   `/help` to surface whatever the host has registered so users can
 *   discover commands that have no entry in this plugin's local docs.
 *
 * No `@deepseek-ai/*` runtime dep — the registry lives in the host
 * process; the bridge reaches it via `ctx.inject(['commands'], ...)`
 * through the cordis injection pattern already used for `tools` /
 * `systemPrompt`.
 */
export interface NativeCommandsSurface {
    find(agent: Agent, name: string): {
        name: string;
        description?: string;
        input?: {
            hint?: string;
        };
    } | undefined;
    /**
     * Mirrors `@deepseek-ai/dsh-commands.CommandRuntime.execute`. The host
     * signature is `(agent, line, images, signal)` — `images` is the composer
     * attachment batch (base64-encoded), and `signal` is the UI request's
     * cancellation signal. WeChat has no composer attachment surface, so the
     * bridge always passes `[]`; the previous 3-arg call placed the signal
     * in `images`'s slot, leaving `signal` undefined inside the host handler
     * and triggering `Cannot read properties of undefined (reading
     * 'aborted')` on every native command.
     */
    execute(agent: Agent, line: string, images: readonly unknown[], signal: AbortSignal): Promise<{
        commandId: string;
        result: {
            kind: "success";
            text?: string;
            sourceEventSeq?: number;
        } | {
            kind: "error";
            text: string;
        };
    } | undefined>;
    list(agent: Agent): Array<{
        name: string;
        description?: string;
        input?: {
            hint?: string;
        };
    }>;
}
export declare class WeChatDSHBridge {
    private readonly ctx;
    private config;
    private readonly configStore?;
    private readonly state;
    private readonly agents;
    private readonly ops;
    private token;
    /**
     * Gateway rejected the current bot session (`-14` / session timeout).
     * Distinct from `token === null` (never logged in / mid re-login).
     * While invalid and not given up, outbound is parked and flushed on recover.
     * Cleared when getUpdates succeeds again or a fresh QR login lands.
     */
    private tokenInvalid;
    /**
     * `-14` recovery exhausted (re-scan hint). Further outbound is dropped,
     * and any parked items are discarded.
     */
    private tokenGiveUp;
    /**
     * Single WeChat peer. First inbound user wins; later distinct
     * `from_user_id`s are ignored. Single-user deployments only.
     */
    private peerUserId;
    /**
     * Latest inbound iLink `context_token` for the peer. Wired into the
     * send payload when present; never used as a send gate.
     */
    private wireContextToken;
    /** Per-run monitor cancellation; recreated on every reconnect. */
    private monitorAbort;
    private monitorRunning;
    private monitorTask;
    private readonly seenInbound;
    private loginState;
    /** Pending question cards per user (rpcId-keyed, first = active). */
    private readonly pendingQuestions;
    /** Pending approval cards per user (rpcId-keyed). */
    private readonly pendingApprovals;
    /**
     * Card rpcIds already pushed to WeChat in full, per user. Prevents a
     * re-send when the user switches into the card's session after it was
     * already delivered (the card is always re-viewable via /history).
     */
    private readonly pushedCardRpcIds;
    private readonly silentBuffers;
    /** Desktop-style process group for the currently bound conversation. */
    private readonly processes;
    private readonly assistantStreams;
    private readonly streamedReasoning;
    /** Bounded dedup of committed output records (not transient stream chunks). */
    private readonly seenOutputEvents;
    /** Invalidates queued sends across logout / re-login, even for the same peer. */
    private outboundGeneration;
    private dotOutbox;
    /**
     * 结论模式 (final-only) hold table, keyed by session id. While
     * `config.finalOnly` is on, neither the bound session's assistant text nor
     * a cross-session task notice is pushed as it happens: each is folded into
     * the entry for its session and the whole entry is delivered ONCE, after
     * the task has been quiet for `finalOnlyIdleMs` (or at the
     * `finalOnlyCeilingMs` hard ceiling). This is what collapses a goal that
     * auto-continues over N rounds — each round is a separate DSH turn, so the
     * per-turn `silent` mode still emits one message per round — into a single
     * conclusion.
     */
    private readonly pendingFinal;
    /** One global queue and budget: dsh-wechat intentionally serves one peer. */
    private outboundCache;
    private wechatMsgCount;
    private cacheNoticeSent;
    private outboundRetryTimer?;
    private outboundRetryHead?;
    private outboundRetryAttempt;
    private outboundRetryAt;
    private lastOutboundError;
    private lastOutboundSentAt;
    /** Sliding-window limiter for agent-initiated `send_wechat` pushes. */
    private readonly pushRate;
    /** Serializes all outbound budget/queue mutations across assistant and tool sends. */
    private outboundSerial;
    /** Per-agent model overrides set by `/model switch` / `/reasoning` (applied via agent/request). */
    private readonly modelOverrides;
    /** Dedup for cross-session turn/end notifications (userId -> sessionIds already notified this turn). */
    private readonly notifiedCrossSessionTurns;
    /** Last assistant text per session (for cross-session completion preview). */
    private readonly lastAssistantTextBySession;
    /**
     * Last user-prompt time per session (from `user/message` events with
     * source.kind === "user" — the same activity the GUI sidebar uses). Used
     * for `/s list` ordering and the time column; sessions without a recorded
     * activity (cold after restart) fall back to their creation time.
     */
    private readonly lastActivityBySession;
    /**
     * The most recent numbered session list per WeChat user. Keeping the exact
     * ids (rather than only its scope) lets a following shorthand `/s switch
     * <n>` select the row the user actually saw, even if recency changes before
     * the switch arrives. Explicit `/s switch current <n>` bypasses this
     * ephemeral snapshot and resolves the current scope afresh.
     */
    private readonly lastSessionListByUser;
    /**
     * Per-session message-source tracking for the dynamic WeChat surface
     * prompt: the most recent user-message origin per session ("wechat" when
     * the last user message was injected from WeChat, "gui" when it came from
     * the GUI chat box). The global `dsh-wechat-surface` prompt section
     * consults this via `surfaceSourceFor()` at assembly time, so the WeChat
     * prompt follows the message source — present exactly while WeChat
     * messages drive the session, absent while GUI messages do. Entries are
     * lazily dropped after SURFACE_TTL_MS without a touch.
     */
    private readonly sourceBySession;
    /**
     * Ids of user messages this bridge injected from WeChat (pending their
     * `user/message` echo), so `handleSessionEvent` can tell WeChat-injected
     * messages apart from GUI-typed ones. One-shot consumption with a TTL.
     */
    private readonly wechatMessageIds;
    /** True after plugin dispose; pending waterfall waiters must not settle to WeChat. */
    private interactionStopped;
    /**
     * DSH native command registry (ctx.commands) when present in the host.
     * Set late by `attachCommands` once the cordis commands child has
     * resolved (host's own injection pattern). When `null` the bridge
     * silently skips the native command layer and the local whitelist
     * keeps full ownership — every `/xxx` either hits a hard-coded branch
     * or is forwarded as text to the agent.
     */
    private commandsCtx;
    /**
     * Per-user typing_ticket cache: the iLink `sendtyping` ticket is short-lived
     * and tied to the user's current context. We re-fetch via getconfig only on
     * miss / TTL expiry; otherwise the same ticket is reused across multiple
     * status changes of the same turn.
     */
    private readonly typingTickets;
    /**
     * Per-user active typing indicator. Tracks which user/session is currently
     * shown as "正在输入", so we can (a) suppress duplicate TYPING sends on
     * re-entry, (b) periodically refresh the indicator (TYPING is fire-and-
     * forget and the WeChat client auto-hides after a few seconds), and
     * (c) cancel cleanly on turn end / agent error / plugin stop. The
     * `safetyTimer` is the TTL fallback — it is refreshed by every keepalive
     * tick and only fires if the keepalive loop itself stops running.
     */
    private readonly typingActive;
    constructor(ctx: BridgeContext, config: WeChatDSHConfig, commandsCtx?: NativeCommandsSurface | null, configStore?: ConfigStore);
    /**
     * Pre-global-silent installs stored the toggle only on the WeChat user.
     * Copy it into config.json once so the settings page and a later re-scan
     * still see the same value.
     */
    private migrateSilentFromUsers;
    /** Bind or create the WeChat user, inheriting the global silent default. */
    private ensureBoundUser;
    /** Hydrate the one peer's persisted budget and queue without auto-flushing. */
    private restoreOutboundState;
    /** Persist the one peer's budget/queue; empty state needs no snapshot. */
    private persistOutboundState;
    /** Serialize remote sends with budget and durable queue mutations. */
    private serializeOutbound;
    private retireDotOutbox;
    /**
     * Late-bind the native command registry (`ctx.commands`).
     *
     * Called from `src/index.ts` after the host's commands child has
     * resolved via `ctx.inject(['commands'], ...)`. Idempotent: a second
     * call with the same surface is a no-op, a `null` is recorded as the
     * "unavailable" state.
     */
    attachCommands(commandsCtx: NativeCommandsSurface | null): void;
    /**
     * True when the line shape is a candidate for native command bypass
     * of a pending approval/question card. Used by `bypassCard` so a card
     * does not silently swallow a `/plan off` while waiting for the user.
     *
     * Two-gate:
     *   1. The host's `ctx.commands` registry is composed — without it
     *      the native dispatch layer is dormant and we must not bypass.
     *   2. The shape parses as a leading-slash lowercase command name
     *      (`parseCommandName`).
     *
     * `find(agent, name)` is NOT called here: at the bypass-card decision
     * point the bound agent may not be ensured yet (cost reasons) and
     * "shape-not-registered" is correctly re-detected inside
     * `tryNativeCommand` — a name that parses but is unregistered simply
     * falls through. The cost is that dsh-wechat-owned commands whose
     * shape parses as a slash name (today: `/rp`, `/rq`, `/stop`) would
     * bypass the card if matched here; those names are explicitly excluded
     * below so the card handler keeps full ownership of their semantics.
     */
    private isBypassableNativeCommand;
    /**
     * Probe the host's `ctx.commands` registry for the leading-slash name
     * in `text`; if registered, run the native handler and render its
     * settled result as a single WeChat reply. Returns `true` iff the
     * reply was sent (the caller should stop processing); returns `false`
     * for every "not ours" case so the local whitelist / forwarding
     * pipeline continues unchanged.
     *
     * Failure isolation: a thrown native handler is caught and rendered as
     * a friendly "command execution exception" reply; the message is never
     * silently forwarded to the agent (a malformed command must not look
     * like a real user prompt).
     *
     * The agent is ensured lazily on first hit so cold sessions without a
     * cached DSH session still resolve cleanly. We do NOT call
     * `agents.ensure` for unmatched names — the call would be wasted work
     * on the (very common) "user typed `/foo bar`" path.
     */
    private tryNativeCommand;
    /**
     * Resolve the host's native command descriptors for `/help` discovery.
     *
     * Returns the name-sorted `ctx.commands.list(agent)` snapshot when
     * the registry is composed AND an agent is bound; returns an empty
     * array otherwise. The host registry may legitimately list commands
     * that are not yet defined for the bound agent — `formatHelp` then
     * falls back to those entries; the bridge never re-filters by the
     * local whitelist (de-duplication is `formatHelp`'s job). A failed
     * `list` is logged once and treated as "no native commands" so
     * `/help` still works for users with a degraded registry.
     */
    private listNativeCommandsForHelp;
    getLoginState(): LoginState;
    /** Current effective config (for the settings page). */
    getConfig(): WeChatDSHConfig;
    /** Full status snapshot for the settings page / QR page. */
    getStatus(): Record<string, unknown>;
    /**
     * Message-source marker for one session, consulted by the global
     * `dsh-wechat-surface` prompt section at assembly time. "wechat" means
     * the most recent user message came from WeChat (the WeChat prompt is
     * shown); "gui" (or undefined) means it did not (the prompt is hidden).
     * Stale markers are dropped lazily.
     */
    surfaceSourceFor(sessionId: string): "wechat" | "gui" | undefined;
    /** Remember one WeChat-injected message id for echo matching. */
    private markWechatMessage;
    /** Record that the last user message in `sessionId` came from WeChat. */
    private markSessionSource;
    /**
     * Resolve a usable typing_ticket for the given user, caching the result
     * for `TYPING_TICKET_TTL_MS`. Returns undefined when the bot is not
     * logged in or the iLink call fails (caller treats this as "skip").
     */
    /** Bot can talk to WeChat: logged in and the gateway has not rejected the session. */
    private botReady;
    private markTokenInvalid;
    private markTokenRecovered;
    private markTokenGiveUp;
    private dropOutboundReason;
    private logDropOutbound;
    private getTypingTicket;
    /**
     * Best-effort iLink sendtyping call. Swallows all errors so a transient
     * iLink failure never breaks the surrounding message flow.
     */
    private sendTypingStatus;
    /**
     * Show the typing indicator for `userId` on the bound session. Idempotent:
     * a second call while the indicator is already active is a no-op. Starts
     * a periodic refresh (`TYPING_KEEPALIVE_MS`) so the WeChat client does
     * not auto-hide the indicator during long turns, and a safety timer
     * (`TYPING_SAFETY_TIMEOUT_MS`) refreshed on every keepalive tick so a
     * stuck keepalive loop doesn't leave a phantom "正在输入" forever. The
     * indicator is removed by `endTyping` on turn end, agent error, plugin
     * stop, or (as a safety net) when the keepalive loop itself stops.
     */
    private beginTyping;
    /**
     * Clear the typing indicator for `userId`. Idempotent: no-op when nothing
     * is active. `reason` names the call site (safety-timeout / plugin-stop /
     * turn-end, …) and is not logged.
     */
    private endTyping;
    /** Start the bridge: resume with a stored token or begin QR login. */
    start(): Promise<void>;
    /** First persisted user is the single peer (legacy multi-user files keep only the first). */
    private lockPeerFromState;
    /**
     * Plugin dispose: stop the iLink monitor AND abandon pending WeChat
     * waterfall waiters. WeChat reconnect/logout must NOT use this — they
     * only bounce the gateway long-poll (`stopIlink`). Host answerers stay
     * registered for the plugin lifetime and survive QR re-login.
     */
    stop(): Promise<void>;
    /** Stop the WeChat long-poll and typing indicators; leave Host answerers running. */
    private stopIlink;
    /**
     * Restart the iLink long-poll with the current token (or begin QR login
     * when no token exists). Used after gateway config changes, not as a
     * user-facing "reconnect" action — that duplicated 重新扫码.
     */
    reconnect(): Promise<{
        ok: boolean;
        message: string;
    }>;
    /**
     * Force re-login: drop the stored token and start a fresh QR flow.
     */
    relogin(): Promise<{
        ok: boolean;
        message: string;
    }>;
    /** Log out: stop the monitor and remove the stored token. */
    logout(): Promise<{
        ok: boolean;
        message: string;
    }>;
    /**
     * A new QR login is a new bot session. Forget the previous WeChat peer
     * (memory + `state.json`) and the old long-poll cursor, otherwise the
     * first inbound from a different account is dropped as
     * `ignore inbound … (single-user peer is <old>)`.
     */
    private resetPeerBinding;
    /**
     * Drop every not-yet-sent WeChat payload. Logout / re-login must not
     * keep GUI replies from the logged-out window and then flush them on
     * the next inbound ping.
     */
    private discardQueuedOutbound;
    private deleteToken;
    private startLoginFlow;
    private startMonitor;
    /**
     * Apply a config patch. Returns the updated editable values. When the
     * gateway connection fields change while logged in, the monitor is
     * restarted automatically.
     */
    updateConfig(patch: Partial<EditableConfig>): Promise<{
        config: Record<string, unknown>;
        message: string;
    }>;
    /**
     * Update per-user settings from the WebUI (silent / crossSessionNotify).
     * Returns the updated user snapshot or null when user not found.
     */
    updateUserConfig(userId: string, patch: {
        silent?: boolean;
        crossSessionNotify?: "inherit" | "on" | "off";
    }): {
        ok: boolean;
        message: string;
        user?: UserState;
    };
    /** Resolve the bound WeChat user for a DSH agent id. */
    userForAgent(agentId: string): UserState | undefined;
    private inboundKey;
    private handleMessage;
    private processMessage;
    private persistSessionBinding;
    private forwardToAgent;
    /**
     * Handle one session event for a WeChat-bound session.
     * Assistant prose stays separate; reasoning and tool events accumulate in
     * one process group until prose, a decision card, or turn/end.
     * Silent mode buffers only the last assistant prose.
     * (Approval/question cards are frame-driven via handleMuxFrame, not
     * session events — this listener only carries agent output.)
     *
     * NOTE: SessionEvent is the wrapped `{ type, seq, time, data }` shape —
     * the message lives in `event.data.message`, NOT at the top level.
     */
    handleSessionEvent(sessionId: string, event: {
        type: string;
        [k: string]: unknown;
    }): void;
    /** Whether 结论模式 (per-task hold) is on. Supersedes `silent`. */
    private finalOnlyEnabled;
    private finalOnlyIdleMs;
    private finalOnlyCeilingMs;
    private ensurePendingFinal;
    /** (Re)arm the quiescence timer: every activity event pushes delivery back. */
    private armFinalSettle;
    /** A turn started (or a new round was queued): stop the countdown. */
    private cancelFinalSettle;
    /**
     * Hold one assistant text. Returns true when the caller must NOT deliver it
     * now (the hold owns delivery from here on).
     */
    private holdFinalText;
    /**
     * Fold a cross-session completion notice into the hold. A real assistant
     * body always wins over the 80-char preview, so a bound session keeps its
     * full conclusion while an unbound one still collapses to one message.
     */
    private holdFinalNotice;
    /** Count a finished turn into the hold's round tally (for the digest header). */
    private foldFinalRound;
    /** True when this session currently has something held back. */
    hasPendingFinal(sessionId: string): boolean;
    /**
     * Deliver the held conclusion for one session, if any. Delivery goes
     * through `sendReply`, so chunking, the outbound budget and the offline
     * park/queue behaviour are exactly the same as a normal reply.
     */
    private flushPendingFinal;
    /** Deliver everything currently held (the `/flush` escape hatch). */
    private flushAllPendingFinal;
    /** Throw the held conclusions away without delivering (stop / re-bind). */
    private discardPendingFinal;
    /**
     * Drop one session's hold without delivering it. Used on error: the error
     * notice IS the outcome, so a stale "conclusion" must not follow it.
     */
    private dropPendingFinal;
    /**
     * `agent/status` mirror: a running agent means a round is in flight, so the
     * countdown stops; going idle arms it. `agent.id` IS the session id in DSH
     * (`Agent.id: SessionId`), so no extra mapping is needed.
     */
    handleAgentStatus(sessionId: string, status: string): void;
    /** Flush accumulated process on the FIRST prose chunk, before the response commits. */
    handleAssistantStream(sessionId: string, frame: AssistantStreamFrame): void;
    private processFor;
    private flushProcess;
    private pushOutput;
    /** Drop unfinished process / silent prose when its conversation leaves the live feed. */
    clearSessionOutput(sessionId: string): void;
    /** Notify the bound user of an agent error. */
    handleAgentError(agentId: string, error: unknown): void;
    /**
     * Plugin dispose only — abandon pending WeChat waiters so `next()` (GUI)
     * can still settle. WeChat reconnect/logout must NOT call this.
     */
    stopInteraction(): void;
    private sessionIdOfRequest;
    /**
     * DSH 0.1.2 Web cards dismiss only when the waterfall `request.signal`
     * aborts (Gateway then pushes a `cancel` frame). The tool's own
     * `exec.signal` must stay live so the turn can continue after a WeChat
     * answer — so we replace `req.signal` with a fork for `next()` (GUI)
     * and abort only that fork when this answerer returns. The original
     * turn abort is forwarded onto the fork so a GUI Stop still withdraws
     * the Web card.
     */
    private forkGuiCardSignal;
    private abortGuiCard;
    /**
     * Host `approval/request` waterfall answerer. Races the GUI (`next()`)
     * against a WeChat reply so whoever answers first wins. No WeChat peer
     * → immediately `next()`. Soft timeout withdraws the WeChat waiter
     * without deciding, leaving the GUI card live.
     */
    answerApprovalRequest(req: ApprovalRequestLike, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>;
    /**
     * Host `user-questions/request` waterfall answerer. Same race as
     * approvals: WeChat vs GUI, first settle wins. Soft timeout withdraws
     * the WeChat waiter without answering.
     */
    answerQuestionRequest(req: QuestionRequestLike, next: () => Promise<AskUserQuestionAnswer>): Promise<AskUserQuestionAnswer>;
    /**
     * Test / replay helper: register a card without holding a live waterfall.
     * Production cards come from {@link answerApprovalRequest} /
     * {@link answerQuestionRequest}. Kept so existing unit tests can seed
     * pending tables without spinning a Host waterfall.
     */
    handleMuxFrame(frame: {
        type: "server-request";
        rpcId: string;
        method: string;
        payload: {
            type: string;
            [k: string]: unknown;
        };
    }): void;
    /**
     * Session provenance label for a card: which workspace and which session
     * the request belongs to (`📂 <工作区> · 💬 <会话标题>`), so a card for a
     * non-current session is identifiable without switching.
     */
    private sessionContextLabel;
    /**
     * Block-quoted preview of a session's last assistant text for a
     * cross-session notice, or "" when there is nothing to quote.
     *
     * Two deliberate properties:
     *   - the TAIL, not the head — an assistant message opens with preamble
     *     and closes with the conclusion, and the notice exists to convey
     *     the conclusion;
     *   - `maskSecrets` — assistant prose can echo a token or hash it was
     *     shown. Only this excerpt is masked; a normal reply body never is
     *     (the mask's hex/base64 rules would eat its commit SHAs).
     * Measured in code points, so a tail of emoji is not half a surrogate.
     */
    private previewSuffix;
    /**
     * Send one mirrored approval card with its session provenance header.
     * The P{n} number is the card's index across answerable approvals
     * (current session, plus other sessions while the decision gate is on).
     */
    private sendApprovalCard;
    /**
     * Send one mirrored question card with its session provenance header.
     * The P{n} number is the card's index across answerable questions;
     * multi-card replies use `P{n}=` to pick the card.
     */
    private sendQuestionCard;
    /**
     * Whether cross-session notifications are enabled (single-user: global only).
     */
    private shouldNotifyCrossSession;
    private resolveCrossSessionRecipients;
    private notifyCrossSessionTurnEnd;
    private notifyCrossSessionError;
    private clearCrossSessionTurnNotified;
    private trackWatchedSession;
    /**
     * After the user switches into `sessionId`, flush any pending cards for
     * it that were NOT already pushed in full on arrival (a card pushed for
     * a non-current session must not repeat on switch; /history re-shows
     * everything on demand).
     */
    private flushPendingCardsForSession;
    /** Push every still-pending card that has not yet been shown on WeChat. */
    private flushUnseenCardsForUser;
    /**
     * Resolve the WeChat user for a calling DSH agent id. Prefers the user
     * bound to this agent (session) id; otherwise falls back to the first
     * known user (single-user deployments are the norm). Returns undefined
     * only when no user has ever interacted with the bridge.
     */
    private resolveUserForAgent;
    /** The WeChat user a card for `sessionId` goes to: its bound user, else the first known user. */
    private recipientForSession;
    /** Pending cards that belong to the user's *current* bound session. */
    private pendingCardsForCurrentSession;
    /**
     * Cards the user may answer from WeChat right now.
     * Gate off → current session only (unseen background cards stay silent).
     * Gate on  → every pending card (they were / will be pushed in full).
     */
    private answerableApprovals;
    private answerableQuestions;
    /**
     * Global P{n} order: questions first, then approvals. One namespace so a
     * plan card labelled P1 is not intercepted as a permission reply.
     */
    private answerableCards;
    private pnOfCard;
    /**
     * Snapshot `rpcId → P{n}` for every answerable card, taken ONCE at the
     * start of an inbound reply.
     *
     * A receipt must name the number the card was PRINTED with, and `P{n}` is
     * a live position in the pending tables: settling a card removes it from
     * those tables before the receipt is composed (measured — a lookup taken
     * after the removal returns nothing, not a shifted number). Resolving
     * against a map frozen before the batch therefore both preserves the
     * printed number and keeps `P1=1 P2=2` from degrading to a numberless
     * receipt.
     */
    private cardIndices;
    /** Background task completion/error notice gate (decision cards only follow `crossSessionNotify`). */
    private notifyTaskEventsEnabled;
    /** Record that the card's full content was pushed to WeChat for this user. */
    private markCardPushed;
    /** Whether the card's full content was already pushed to WeChat for this user. */
    private isCardPushed;
    /** Drop the pushed marker when the card leaves the pending table. */
    private unmarkCardPushed;
    private isCardCloseCommand;
    /** Route every `P{n}=` in the line onto the globally numbered card. */
    private handlePnReplies;
    private handleApprovalReply;
    private applyApprovalDecisions;
    private respondApproval;
    private removeApprovalCard;
    private rejectOneApproval;
    private handleQuestionReply;
    private answerOneQuestion;
    private respondQuestion;
    /** `/rq` — close pending cards of the current session only. */
    private rejectCurrentSessionCards;
    /** `P{n}=/rq` — close that globally numbered card. */
    private rejectCardByPn;
    private rejectOneQuestion;
    /**
     * Plan-mode `exit_plan_mode` review: dismissing the card is "Keep planning",
     * not an aborted ask. Detect via host intent, else the well-known review id.
     */
    private planKeepPlanningAnswer;
    private removeQuestionCard;
    private handleNotifyCommand;
    /**
     * Write one editable field both in memory and, when a ConfigStore is
     * attached, to `config.json`. Tests that construct the bridge without a
     * store still see the in-memory change for the rest of the process.
     */
    private persistEditable;
    private handleSurfaceCommand;
    private handleSilentCommand;
    /** Global silent switch, mirrored onto the current peer so runtime reads stay consistent. */
    private setSilent;
    private isSilent;
    /**
     * `/final` — view or switch 结论模式. Mirrors `/silent`: the value is
     * persisted to `config.json` (so a re-scan keeps it) and the settings
     * page shows the same switch.
     *
     * Turning the mode OFF flushes whatever is held. A hold is a conclusion
     * the agent has already produced — the user just asked us to stop
     * holding things back, so handing it over now is the only reading that
     * does not silently destroy output. (Dispose does the same; only
     * logout / re-bind discard.)
     */
    private handleFinalCommand;
    /**
     * `/enter` — view or switch the busy-time delivery behavior. Reads and
     * writes the DSH settings document (`ui-conversation.busyEnter`), the same
     * field the GUI General Settings 「繁忙时 Enter 键行为」 row edits, so both
     * ends always share one value. The behavior applies at delivery time: while
     * the agent is running, `queue` waits for a follow-up turn and `steer`
     * splices into the running turn.
     */
    private handleEnterCommand;
    private handleStopCommand;
    private handleWorkspaceCommand;
    /**
     * Rebind the user to the workspace's most recent visible session.
     * Returns the restored session id, or "" when the workspace has none
     * (the next user message will create one — this method does not mint).
     */
    private switchUserWorkspace;
    /** Two-line workspace switch/add reply: workspace row + restored session. */
    private formatWorkspaceSwitchReply;
    /**
     * WeChat-facing session label: cleaned title (id prefix fallback) + full id.
     */
    private formatSessionLabel;
    /**
     * Resolve the same recency-ordered session set for both `/s list` and
     * `/s switch`. `scope` is explicit on the command so `list current` cannot
     * accidentally be paired with the unfiltered switch list.
     *
     * Pinned sessions come first, then everything else. Each group keeps the
     * recency order, so the pin set is a *partition* marker only — the host's
     * own "most recently pinned first" array order deliberately does not drive
     * the row order, matching the GUI's 「最近更新」 view where the pin time does
     * not affect the sort. This keeps `/s list` numbers stable for unpinned
     * users (no pins = byte-identical order to before).
     */
    private listRecentSessions;
    /**
     * Resolve every distinct path through {@link canonicalPath} once.
     *
     * Callers that compare several directories at the same time (a workspace
     * roster against a session cwd against each user's cwd) share one Map
     * instead of re-resolving the same spelling per comparison.
     */
    private canonicalizePaths;
    /**
     * Sessions whose recorded cwd is the user's current directory, compared
     * through the host's canonical-path rule (see {@link canonicalPath}).
     *
     * A plain `header.cwd === user.cwd` string compare misses the same
     * directory spelled with a trailing separator, a `.` segment, or a
     * different letter case — the host's `workspaceRegistry` resolves all of
     * those to one workspace, so the WeChat side must agree with it.
     *
     * Sessions with no recorded cwd stay excluded, as before.
     */
    private filterByCurrentCwd;
    /**
     * Resolve a shorthand switch against the exact rows from the last list.
     * Return `undefined` when the snapshot is unavailable or no longer valid;
     * the caller then falls back to a fresh all-session list.
     */
    private sessionsFromLastList;
    private handleSessionCommand;
    /**
     * Handle `/s pin [编号]` and `/s unpin [编号]`.
     *
     * The pin set lives in the host registry (`workspaceRegistry.pinnedSessionIds`),
     * so the GUI sidebar and WeChat read and write one durable set. Without a row
     * number the command acts on the user's currently bound session — the common
     * case, needing no list first. With one, the number resolves through the exact
     * rows of the latest `/s list` (same helper `/s switch` uses), so a number the
     * user just read always addresses the row they saw.
     *
     * Pre-checks keep the happy path off the host's exception channel: an
     * already-pinned id is a no-op (the host would also no-op), and an archived
     * session cannot be pinned at all (the host would reject). Both are reported
     * with the state the user asked about, not as a failure.
     */
    private handlePinCommand;
    /** User-facing text for a non-`ok` pin outcome. */
    private pinFailureText;
    /**
     * Re-store the full recency-ordered session list for the user after a pin
     * change, so the numbered snapshot stays aligned with the reordered rows.
     */
    private refreshSessionListSnapshot;
    /**
     * Unbind the current session and mint a fresh one via `agents.ensure`.
     * Used by `/s new` when no reusable blank exists, and when the bound
     * session's log is corrupt.
     */
    private createFreshSession;
    /**
     * Find the newest blank (never-spoken-to) session in `cwd`, mirroring the
     * GUI's "reuse-or-create its blank session" behavior. A blank session is
     * one with no `user/message` event in its log — created by a previous
     * "new session" that the user never used. Archived sessions are already
     * filtered by `listSessions()`. Unreadable / corrupt logs are skipped
     * (they are not blank). `excludeId` skips the caller's current session
     * (the caller handles "already blank" separately).
     */
    private findBlankSession;
    private handlePresetCommand;
    /**
     * `/reasoning` — view or switch the reasoning effort. The effort rides the
     * same model selection as the GUI's model picker: the current session's
     * override or logged config, with the deployment default underneath.
     * Switching persists via `agentDefaultModel.saveSelection` (same settings
     * document the GUI edits) and applies to the live agent through the
     * `agent/request` override.
     */
    private handleReasoningCommand;
    /**
     * `/history [all] [N]` — show the most recent N conversation entries of
     * the current session (default 5, max 20). Default lists only human and
     * assistant turns; `all` also includes synthesized system injections
     * (compaction checkpoints, plugin context, goal rounds). Each entry is
     * Each entry is its own block (`角色 · 时间` then the original body),
     * oldest→newest, so it reads closer to a live WeChat message than a dump.
     */
    private handleHistoryCommand;
    /** After `/history`, re-send every still-answerable card in full. */
    private resendPendingCardsForHistory;
    private handleModelCommand;
    /**
     * `/perm` — permission management over the native permissionPresets
     * service (session-level switches) and the `permission` settings document
     * (the default for new sessions, shared with the GUI settings page).
     */
    private handlePermCommand;
    /**
     * `current()` with a guard. The host reads the Session's `permissions`
     * projection (`current(session: Session)`), so the live Session must be
     * passed; a session without that projection still degrades to `undefined`.
     */
    private safeCurrent;
    /** Resolve a preset target by name or list index. */
    private matchPermission;
    /** Human-readable preset description: name（sandbox + approval）plus detail. */
    private describePermission;
    /**
     * Apply the user's model override to a frozen request config. Called from
     * the `agent/request` waterfall listener (registered in index.ts) for
     * WeChat-bound agents. An override without a reasoning effort leaves the
     * caller's effort untouched (`/model switch` does not clear a set effort).
     *
     * The override itself is preserved by `handleModelCommand` when the user
     * issues `/model switch`: the new selection carries the existing effort
     * (from the override first, then the persisted default) IF the new
     * model supports the same effort id. So in practice this merge is the
     * last-line defense for the live request; the displayed selection (in
     * `/status` via `resolveEffectiveModel`) reads the effort straight off
     * the override.
     */
    applyModelOverride(config: {
        provider: string;
        model: string;
        reasoningEffort?: string;
    }, agentId: string): {
        provider: string;
        model: string;
        reasoningEffort?: string;
    };
    /**
     * Color marker for boolean toggles on /status. Each field has its own
     * semantic — `on` for 静默模式 means "we stop forwarding to WeChat"
     * (warning), `on` for 跨会话决策推送 means "extra delivery is enabled"
     * (good). The colored glyph is field-specific; this helper just
     * annotates an explicit `value` with `🟢` / `🔴`. iLink text items
     * have no `<font color>` support — emoji glyphs are the only
     * colored channel that survives the wire.
     */
    private paintBadge;
    private formatStatus;
    /** `/status` rows for unanswered cards, split into current vs other sessions. */
    private formatPendingStatusLines;
    private formatPendingParts;
    /**
     * `/status` preset rows: deployment default (settings document) and
     * the bound session's live preset (event-aware). Shown as two lines
     * so a switched session is not mistaken for the global default.
     * The default row sits after permission; the session row stays with
     * the session/agent block.
     */
    private formatStatusPresetLines;
    /**
     * Preset id → metadata display name (`/preset list` 同款 `preset.name ?? preset.id`).
     * Used everywhere the bridge shows a preset (session list, /status, /preset status default),
     * so a session actually running `cordis` shows up as "创造模式" rather than the
     * raw id. Returns undefined when the id is missing; returns the id itself when
     * the roster has no matching entry or no `name` field — both edges preserve
     * `/preset list`'s fallback semantics so a deleted/broken preset never produces
     * an empty label.
     */
    private resolvePresetLabel;
    /**
     * Recency value for `/s list` ordering and display: the last recorded
     * user-prompt time, falling back to the session creation time for cold
     * sessions (no activity observed since this process started).
     */
    private sessionActivityTime;
    /** Compact relative time for the `/s list` column (like the GUI sidebar). */
    private formatRelativeTime;
    /**
     * The model the user's session actually runs on: this session's override
     * (`/model switch`) > the session's latest logged request config > the
     * agent's creation options > the deployment default model. Same precedence
     * as the GUI's `selectionFor`.
     *
     * `reasoningEffort` follows the same precedence chain, with one defensive
     * branch: when the override carries a model selection but no effort AND
     * the persisted default has an effort for the SAME model, borrow that
     * effort. This rescues users whose override was written by an older
     * `/model switch` that did not preserve the effort — they see the
     * preserved effort in `/status` immediately on upgrade instead of
     * needing to re-issue `/reasoning switch`. Only triggers when the
     * default's provider/model matches the override; otherwise the default's
     * effort belongs to a different model and must not be applied.
     */
    private resolveEffectiveModel;
    /**
     * Handle the `send_wechat` tool: push text or a local file to a
     * WeChat user. The recipient is the user bound to the calling agent
     * (session), or — when the agent has no binding — the first known
     * WeChat user (single-user deployments are the norm).
     *
     * Delivery goes through `deliverOutbound`, so tool pushes share the same
     * per-user gateway budget as assistant replies, and budget overflow /
     * transient send failures are queued (`/next` or the next inbound
     * message flushes them) instead of being lost. A queued push reports
     * `ok: true` with an explicit "queued" message: the bridge has taken
     * over delivery, and an error result would only tempt the model into
     * retrying (→ duplicate deliveries on flush). Only an unreadable
     * `file_path` returns `ok: false` immediately.
     */
    /** Exact current owner only; no first-user fallback and no exposed secret. */
    private dotIdentity;
    dotProactiveBinding(sessionId: string): {
        bound: true;
        bindingKey: string;
    } | null;
    dotProactiveRouteStatus(input: {
        sessionId: string;
        expectedBinding: string;
    }): 'current' | 'offline' | 'changed' | 'unknown';
    dotProactiveSend(input: {
        sessionId: string;
        expectedBinding: string;
        requestId: string;
        text: string;
        authorize: () => boolean;
    }): Promise<{
        status: 'accepted' | 'uncertain' | 'blocked';
    }>;
    handleSendWeChat(agentId: string, args: {
        text?: string;
        file_path?: string;
    }): Promise<{
        ok: boolean;
        message: string;
    }>;
    private clearOutboundRetry;
    private recordOutboundError;
    /** Retry only a FIFO head proven not to have crossed the remote boundary.
     * Eligibility is memory-only: a restart never guesses whether a persisted
     * item was accepted before a crash. Durable state and pairing stay intact.
     */
    private scheduleOutboundRetry;
    /** Deliver one item, serialized with all other outbound sends and flushes. */
    private deliverOutbound;
    private deliverOutboundLocked;
    /** Append to the durable FIFO. Queue pressure is not permission to replay
     * an ambiguous head or bypass the gateway's ten-message window. The existing
     * hard ceiling still bounds memory and reports the number of evicted items.
     */
    private parkOutbound;
    /** Best-effort notice for transient failures while budget remains. */
    private notifyCachePendingLocked;
    private sendReply;
    /** After -14 recovery, silently flush the one peer's parked outbound. */
    private flushParkedAfterRecover;
    /** Flush the one FIFO (/next, next inbound, -14 recovery or safe retry). */
    private flushPending;
    private flushPendingLocked;
    private log;
    private previewMessage;
}
//# sourceMappingURL=bridge.d.ts.map