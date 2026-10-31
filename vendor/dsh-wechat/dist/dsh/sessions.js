/**
 * DSH session mapper: binds a WeChat user to a live DSH agent.
 *
 * Creates fresh agents through `ctx.agents.create` (minting a durable
 * session id) or resumes persisted ones through `ctx.agents.resume` after
 * a DSH restart. All service access goes through `ctx.get(...)` with
 * undefined checks — this plugin has zero runtime coupling to
 * `@deepseek-ai/*` packages.
 */
import crypto from "node:crypto";
import { createUserMessage } from "./messages.js";
/**
 * Mint a durable session id for a WeChat-bound session — the SAME format the
 * GUI uses (`session-<uuid>`, the same mint the session controller uses). Uniform
 * ids keep WeChat-created sessions indistinguishable from GUI-created ones
 * everywhere (lists, workspace accounting, log exports).
 */
export function mintSessionId() {
    return `session-${crypto.randomUUID()}`;
}
export class AgentStore {
    ctx;
    ensuring = new Map();
    constructor(ctx) {
        this.ctx = ctx;
    }
    agents() {
        return this.ctx.get("agents");
    }
    /** The live agent for a bound user state, if any. */
    get(user) {
        if (!user.sessionId)
            return undefined;
        return this.agents()?.get(user.sessionId);
    }
    /**
     * Ensure a live agent for the user state. Creates a fresh session when
     * none is bound yet; resumes the persisted session otherwise.
     * Returns `{ agent }` (agent undefined when the agents service is
     * unavailable or create/resume failed). With `replaceOnResumeFailure`,
     * a corrupt or unreadable bound session is unbound and replaced.
     */
    ensure(user, options) {
        // Serialize check/create for this user. Re-read the mutable binding after
        // the previous call finishes, including its resume-failure replacement.
        const previous = this.ensuring.get(user.userId);
        const run = (previous ?? Promise.resolve()).then(() => this.ensureNow(user, options), () => this.ensureNow(user, options));
        this.ensuring.set(user.userId, run);
        const clear = () => {
            if (this.ensuring.get(user.userId) === run)
                this.ensuring.delete(user.userId);
        };
        void run.then(clear, clear);
        return run;
    }
    async ensureNow(user, options) {
        const agents = this.agents();
        if (!agents)
            return { agent: undefined };
        let replacedSessionId;
        if (user.sessionId) {
            const live = agents.get(user.sessionId);
            if (live)
                return { agent: live };
            try {
                const handle = await agents.resume({
                    resumeSessionId: user.sessionId,
                    setup: agentSetup,
                });
                await this.attachToWorkspace(user.cwd, user.sessionId);
                return { agent: handle.agent };
            }
            catch (err) {
                console.error(`[dsh-wechat] resume session ${user.sessionId} failed: ${String(err)}`);
                if (!options?.replaceOnResumeFailure)
                    return { agent: undefined };
                replacedSessionId = user.sessionId;
                user.sessionId = "";
            }
        }
        try {
            // The preset this session will actually run: the deployment default
            // (settings document first — the same one the GUI edits and /preset
            // switch writes). Recording it in the header (like the GUI's
            // composeAgent does) keeps /session list's Preset column populated and
            // makes a later resume mount the same composition.
            const rosterDefault = this.ctx.get("agentPresets")?.defaultId;
            const presetForSession = rosterDefault;
            const sessionId = mintSessionId();
            const handle = await agents.create({
                sessionId,
                meta: {
                    cwd: user.cwd,
                    ...(presetForSession ? { agentPreset: presetForSession } : {}),
                },
                setup: agentSetup,
            });
            // Persist the binding so a later restart resumes this session.
            user.sessionId = sessionId;
            await this.attachToWorkspace(user.cwd, sessionId);
            return { agent: handle.agent, replacedSessionId };
        }
        catch (err) {
            console.error(`[dsh-wechat] create session failed: ${String(err)}`);
            return { agent: undefined, replacedSessionId };
        }
    }
    /**
     * Account the session to the workspace owning `cwd` (create it on first
     * use), exactly like the GUI's session.create remote does via
     * `workspace.attachSession`. Without this, WeChat-created sessions fall
     * into the sidebar's "ungrouped" bucket: the workspace registry derives
     * membership from its durable `sessionIds` records, which only
     * `attachSession` (or the startup bootstrap) populates.
     */
    async attachToWorkspace(cwd, sessionId) {
        const registry = this.ctx.get("workspaceRegistry");
        if (!registry)
            return;
        try {
            let workspace = await registry.resolveByPath(cwd);
            if (!workspace)
                workspace = await registry.create(cwd);
            await workspace.attachSession(sessionId);
        }
        catch (err) {
            // Non-fatal: the session still works, it just shows ungrouped.
            console.error(`[dsh-wechat] attach session ${sessionId} to workspace failed: ${String(err)}`);
        }
    }
    /**
     * Deliver a user-role message to the agent.
     *
     * `mode` mirrors the DSH `ui-conversation.busyEnter` preference (the GUI's
     * 「繁忙时 Enter 键行为」): `"queue"` routes through `agent.followup` — an
     * ordinary follow-up turn, the behavior while idle and the historical
     * default; `"steer"` routes through `agent.steer` — an idle driver starts a
     * turn, a running driver consumes the message at its nearest step boundary
     * (a closed window degrades to the next waking queue turn, never lost).
     * The caller resolves the mode from agent.status + the shared setting.
     */
    followup(agent, content, mode = "queue", onCreated) {
        const message = createUserMessage({
            content,
            // kind 'user' — identical to messages sent from the GUI chat box, so
            // the WeChat user's messages render as ordinary user messages (a
            // 'plugin' source renders as "context injection" in the GUI).
            source: { kind: "user" },
        });
        // Record the minted id BEFORE followup/steer. Those calls synchronously
        // emit `agent/inbox/spliced`; the surface-prompt marker must already
        // know this id or the splice handler treats the WeChat message as GUI.
        // A synchronous admission hook may consume this transport-only input
        // before waking or steering any agent turn. Existing observers returning
        // void retain the historical forwarding behavior.
        if (onCreated?.(message.id, message) === false)
            return message.id;
        if (mode === "steer") {
            agent.steer(message);
        }
        else {
            agent.followup(message);
        }
        return message.id;
    }
}
/**
 * Agent-scoped composition applied to every WeChat-bound session (fresh
 * create or resume): a preset mount joins the agent to its recorded (or
 * deployment-default) agent preset so the preset's tools and prompt sections
 * cover it — the same composition the GUI's `composeAgent` installs — and a
 * model-selection pair of waterfalls keeps the prompt variables and request
 * routing populated exactly like the GUI does. Registered on the agent's own
 * scoped context so it never leaks into other sessions.
 *
 * NOTE: the WeChat surface prompt ("you are chatting through WeChat") is NOT
 * registered here anymore — it lives in a global dynamic runtime context
 * registered by index.ts (`dsh-wechat-surface`), whose text is evaluated per assembly
 * from the bridge's per-session message-source map. That makes the prompt
 * follow the *message source* (WeChat vs GUI), so any session — old or new,
 * GUI- or WeChat-created — gets the WeChat prompt exactly while WeChat
 * messages drive it, and never while GUI messages drive it.
 */
/**
 * DSH 0.1.5 removed `ctx.agent`; `setup` now receives `(agentCtx, agent)`.
 * Fall back to the legacy context property so a 0.1.2 host still works.
 */
function setupAgent(agentCtx, agent) {
    if (agent)
        return agent;
    const legacy = agentCtx?.agent;
    return legacy;
}
export async function agentSetup(agentCtx, agent) {
    const ctx = agentCtx;
    const live = setupAgent(agentCtx, agent);
    // Preset mount — the GUI's composeAgent equivalent. The session's recorded
    // preset (header.agentPreset, written at creation) decides its tools and
    // prompt; an absent one falls back to the roster default (`mount` with no
    // id). Without this, WeChat-created sessions lack the preset's tools
    // (pwsh, fs, web, skill, …) and prompt sections entirely.
    const presets = ctx.get?.("agentPresets");
    if (presets) {
        try {
            await presets.mount(agentCtx, live?.session?.header?.agentPreset);
        }
        catch (err) {
            console.error(`[dsh-wechat] preset mount failed: ${String(err)}`);
        }
    }
    // Model selection, GUI-equivalent precedence: the session's own latest
    // request wins, otherwise the deployment's default model (agentDefaultModel
    // service — the same fallback the Web surface's `selectionFor` uses).
    // Without it, agents created/resumed outside the GUI have no model route:
    // the persona's `{{model}}` variable fails to render and requests cannot
    // resolve a provider/model. This bridge cannot import `@deepseek-ai/dsh-agent`
    // at runtime, so the two waterfalls replicate `installModelSelection`'s
    // cooperative pattern exactly: snapshot the selection into prompt assembly
    // and apply it to every request config.
    const logged = live?.session?.requestHeader?.()?.config;
    const defaults = ctx.get?.("agentDefaultModel")?.currentSelection();
    const selected = logged?.provider && logged.model
        ? {
            provider: logged.provider,
            model: logged.model,
            ...(logged.reasoningEffort ? { reasoningEffort: logged.reasoningEffort } : {}),
        }
        : defaults;
    if (!selected?.provider || !selected.model)
        return;
    ctx.on?.("system-prompt/assemble", async (_assembly, _context, next) => {
        const assembled = (await next());
        return {
            ...assembled,
            variables: {
                ...assembled.variables,
                provider: selected.provider,
                model: selected.model,
            },
        };
    });
    ctx.on?.("agent/request", async (_payload, next) => {
        const resolved = (await next());
        return {
            ...resolved,
            provider: selected.provider,
            model: selected.model,
            ...(selected.reasoningEffort === undefined
                ? {}
                : { reasoningEffort: selected.reasoningEffort }),
        };
    });
}
//# sourceMappingURL=sessions.js.map