/**
 * WeChat slash-command parsers.
 *
 * Ported and trimmed from wechat-opencode (MIT) —
 * https://github.com/pan17/wechat-opencode (src/adapter/workspace-cmd.ts).
 * Only the commands the DSH bridge handles itself are kept: DSH owns
 * workspace/session/agent/model management in its GUI, so those commands
 * are intentionally absent here.
 */
export type HelpCommand = {
    kind: "help";
};
export type StatusCommand = {
    kind: "status";
};
export type SilentCommand = {
    kind: "silent";
    mode: "on" | "off" | "status";
};
export type FinalCommand = {
    kind: "final";
    mode: "on" | "off" | "status";
};
export type SurfaceCommand = {
    kind: "surface";
    mode: "on" | "off" | "status";
};
export type StopCommand = {
    kind: "stop";
};
export type RejectQuestionCommand = {
    kind: "reject-question";
};
export type RejectPermissionCommand = {
    kind: "reject-permission";
};
export type NotifyCommand = {
    kind: "status";
} | {
    kind: "on";
} | {
    kind: "off";
} | {
    kind: "tasks-on";
} | {
    kind: "tasks-off";
};
export type SlashCommand = HelpCommand | StatusCommand | SilentCommand | FinalCommand | StopCommand | RejectQuestionCommand | RejectPermissionCommand;
/** Parse `/help` (aliases `/h`, `/?`). */
export declare function parseHelpCommand(text: string): boolean;
/** Parse `/status`. */
export declare function parseStatusCommand(text: string): StatusCommand | null;
/**
 * Parse `/silent` (alias `/sl`) — query or toggle silent mode.
 * Bare command defaults to status.
 */
export declare function parseSilentCommand(text: string): SilentCommand | null;
/**
 * Parse `/final` (alias `/fo`) — query or toggle 结论模式 (final-only).
 * Bare command defaults to status.
 *
 * `/f` is deliberately NOT an alias: it already means `/flush`, and
 * "take back what is held" is the opposite of "start holding". `/fo`
 * is the shortest unambiguous prefix.
 */
export declare function parseFinalCommand(text: string): FinalCommand | null;
/**
 * Parse `/surface` (alias `/wxprompt`) — query or toggle the WeChat
 * surface-prompt injection. Bare command defaults to status. The prompt
 * text itself is edited from the settings page, not this command.
 */
export declare function parseSurfaceCommand(text: string): SurfaceCommand | null;
/** Parse `/stop`. */
export declare function parseStopCommand(text: string): StopCommand | null;
/**
 * Parse `/notify` (aliases `/watch`, `/notice`) — cross-session decision
 * push, plus an independent task-event toggle:
 *   /notify                → status
 *   /notify status         → status
 *   /notify on|off         → decision-card gate
 *   /notify tasks on|off   → background turn/end + error notices
 */
export declare function parseNotifyCommand(text: string): NotifyCommand | null;
/**
 * Parse `/next` — the explicit continuation for outbound messages cached by
 * the WeChat per-window send limit (the limit notices tell the user to send
 * this). Any ordinary user message also auto-flushes the cache, but `/next`
 * is recognized so it is not mistaken for an unknown command and forwarded.
 */
export declare function parseNextCommand(text: string): boolean;
/**
 * Parse `/flush` (alias `/f`) — deliver whatever 结论模式 (final-only) is
 * currently holding, without waiting for the quiescence timer. This is the
 * escape hatch for "I can see it is done, tell me now".
 */
export declare function parseFlushCommand(text: string): boolean;
/** Parse `/reject-question` (alias `/rq`). */
export declare function parseRejectQuestionCommand(text: string): RejectQuestionCommand | null;
/**
 * Parse a `P{n}=…` / `P{n}:…` / `P{n}-…` prefix that addresses one pending
 * card by its WeChat number. Used so a lone cross-session card cannot
 * swallow a bare reply meant for the current session, and so `P1=/rq`
 * closes that card instead of being forwarded as chat.
 */
export declare function parsePnCardReply(text: string): {
    index: number;
    rest: string;
} | null;
/** Every `P{n}=` / `P{n}-` segment in the line, in order. */
export declare function parseAllPnCardReplies(text: string): Array<{
    index: number;
    rest: string;
}>;
/** Parse `/reject-permission` (alias `/rp`). */
export declare function parseRejectPermissionCommand(text: string): RejectPermissionCommand | null;
/** Detect an unknown leading-slash command for the hint reply. */
export declare function detectUnknownSlashCommand(text: string): string | null;
/**
 * Parse just the lowercase command name out of a leading-slash line.
 *
 * Mirrors the wire contract of `@deepseek-ai/dsh-commands.parseCommand`:
 * a slash at byte zero, a lowercase name containing letters, digits, `_`,
 * or `-`, followed by either end-of-input or whitespace. Anything that
 * survives the name is the handler's `rawInput` (separator whitespace
 * included — handlers own their own grammar).
 *
 * Returns `null` for: empty input, missing leading slash, name starting
 * with a digit, uppercase letters, or any other shape the registry
 * itself would reject. Callers use the result to look up a definition
 * with `ctx.commands.find(agent, name)` before deciding whether to
 * dispatch natively or fall through to forwarding.
 *
 * @param text The raw inbound WeChat text (untrimmed — leading whitespace
 *   is rejected so an accidental " /plan off" never matches).
 * @returns The lowercase command name, or `null` if the line is not a
 *   recognized native-command shape.
 */
export declare function parseCommandName(text: string): string | null;
/**
 * Rows shown by a numbered list command (`/s list`, `/workspace list`)
 * when the caller does not ask for more. `all` (or an explicit larger
 * number) lifts the window; the default is deliberately small because
 * WeChat splits a long reply into 4000-char messages and only 10 of
 * those fit in one gateway window.
 */
export declare const LIST_DEFAULT = 20;
export type WorkspaceCommand = {
    kind: "list";
    limit?: number;
    all?: boolean;
} | {
    kind: "status";
} | {
    kind: "switch";
    target: string;
} | {
    kind: "add";
    path: string;
};
export type SessionCommand = {
    kind: "list";
    scope?: "current";
    limit?: number;
    all?: boolean;
} | {
    kind: "switch";
    index: number;
    scope?: "current";
} | {
    kind: "new";
} | {
    kind: "status";
} | {
    kind: "pin";
    index?: number;
} | {
    kind: "unpin";
    index?: number;
};
export type PresetCommand = {
    kind: "list";
} | {
    kind: "switch";
    target: string;
} | {
    kind: "status";
};
export type ModelCommand = {
    kind: "list";
    provider?: string;
} | {
    kind: "switch";
    target: string;
} | {
    kind: "status";
};
export type PermCommand = {
    kind: "status";
} | {
    kind: "list";
} | {
    kind: "switch";
    target: string;
} | {
    kind: "default";
    target?: string;
};
export type ReasoningCommand = {
    kind: "status";
} | {
    kind: "list";
} | {
    kind: "switch";
    target: string;
} | {
    kind: "clear";
};
/** Busy-time delivery behavior switch (`/enter`), shared with the DSH setting. */
export type EnterCommand = {
    kind: "status";
} | {
    kind: "switch";
    target: "queue" | "steer";
};
/**
 * Parse `/workspace` (alias `/ws`):
 *   list [all|<数量>] | status | switch <path|n> | add <path>
 */
export declare function parseWorkspaceCommand(text: string): WorkspaceCommand | null;
/**
 * Parse `/session` (alias `/s`):
 *   list [current] [all|<数量>] | switch [current] <n> | new | status
 *   | pin [编号] | unpin [编号]
 *
 * `switch current <n>` selects the same current-working-directory scope as
 * `list current`; the explicit scope keeps the command deterministic instead
 * of relying on a hidden "last list" state. The window tokens may appear on
 * either side of `current` (`list current 50` / `list 50 current`).
 *
 * `pin` / `unpin` carry an optional row number from the latest `/s list`
 * (same numbering `switch` uses). Without one they act on the user's
 * currently bound session, so a bare `/s pin` needs no list first.
 */
export declare function parseSessionCommand(text: string): SessionCommand | null;
/**
 * Parse `/preset` (alias `/p`; legacy aliases `/agent`, `/a` still parse):
 *   list | switch <name|n> | status
 *
 * The preset default lives in the DSH settings document (`agent-presets`
 * namespace), the same one the GUI settings page edits — `/preset switch`
 * writes that document, so GUI and WeChat stay in sync.
 */
export declare function parsePresetCommand(text: string): PresetCommand | null;
/**
 * Parse `/model`:
 *   list [provider] | switch <provider/model> | status
 *
 * `switch` keeps the rest of the line intact — OpenRouter-style model ids
 * contain `/` (`inclusionai/ling-3.0-flash-fin:free`), so the provider
 * split happens later against the known provider list. A missing target
 * still parses so the handler can print usage instead of forwarding.
 */
export declare function parseModelCommand(text: string): ModelCommand | null;
/**
 * Split `provider/model` after a known provider id or name. Model ids may
 * themselves contain `/`, so this is not `split("/")[0]`.
 *
 * Longest matching prefix wins (`foo-bar/x` beats `foo` if both exist).
 * Returns null when no known provider owns the first segment.
 */
export declare function splitProviderModelTarget(target: string, providers: ReadonlyArray<{
    id: string;
    name?: string;
}>): {
    provider: string;
    model: string;
} | null;
/**
 * Parse `/perm` (alias `/permission`):
 *   status | list | switch <名称|编号> | default [名称|编号]
 *
 * Session-level switches (`switch`) go through the native permissionPresets
 * service and take effect on the current session immediately; `default`
 * writes the DSH settings document (`permission` namespace) — the same
 * default the GUI settings page's Permission row edits, so both sides stay
 * in sync and new sessions pick it up natively.
 */
export declare function parsePermCommand(text: string): PermCommand | null;
/**
 * Parse `/reasoning`:
 *   (bare) | list | default | switch <等级>
 *
 * The reasoning effort rides the same selection as the model: `/reasoning`
 * with no argument reports the current/default effort and the current
 * model's supported levels; `default` clears it (provider/model default);
 * `switch <等级>` switches the effort (by id or display name), applying to
 * the current session immediately and persisting as the new default.
 * The explicit `switch` keyword matches the other management commands
 * (`/workspace`, `/session`, `/preset`, `/model`, `/perm`).
 */
export declare function parseReasoningCommand(text: string): ReasoningCommand | null;
/**
 * Parse `/enter` (alias `/busy`) — busy-time delivery behavior, shared with
 * the DSH General Settings 「繁忙时 Enter 键行为」 preference
 * (`ui-conversation.busyEnter`):
 *   /enter              → status
 *   /enter status       → status
 *   /enter queue|q|排队 → switch to queue (running messages wait for a new turn)
 *   /enter steer|s|插话 → switch to steer (splice into the running turn)
 *
 * Returns null for unknown subcommands so the text falls through to the
 * unknown-command hint + agent forwarding.
 */
export declare function parseEnterCommand(text: string): EnterCommand | null;
export declare const HISTORY_DEFAULT = 5;
export declare const HISTORY_MAX = 20;
export type HistoryCommand = {
    kind: "history";
    count: number;
    includeSystem: boolean;
};
/**
 * Parse `/history [all] [N]` — view recent conversation history.
 *   /history            → 5 human+assistant turns (default)
 *   /history 10         → 10
 *   /history all        → 5, including synthesized system injections
 *   /history all 10     → 10, including system
 *   /history 10 all     → same as `all 10`
 *   /history 30         → 20 (clamped to HISTORY_MAX)
 *
 * Returns null for: invalid tokens, non-integer / <=0 counts, extra
 * trailing garbage, or a non-history prefix. The caller detects a
 * leading `/history` with an invalid arg and replies with usage
 * instead of forwarding to the agent.
 */
export declare function parseHistoryCommand(text: string): HistoryCommand | null;
/**
 * True if text looks like a /history attempt (including invalid args),
 * used to decide whether to show usage instead of forwarding to agent.
 */
export declare function isHistoryCommandAttempt(text: string): boolean;
/**
 * True if `text` is a recognized slash command that should BYPASS any
 * pending question/approval card and execute normally.
 *
 * The bridge pre-empts the next user text after a `question/requested` or
 * `approval/requested` frame, treating it as the card's answer. Without
 * this helper, typing a management command (e.g. `/next`) while a card
 * is shown silently submits the command text as the card's custom-text
 * answer (questions) or rejects it as "unrecognized reply" (approvals),
 * dropping the user's real intent.
 *
 * Card-specific commands (`/rq`, leftover `/rp`) are intentionally
 * excluded so they keep card semantics. `/help` is
 * included: its only effect is "print the help text", which
 * `handleMessage` already handles; the card handlers' two duplicate
 * `parseHelpCommand` branches become dead code once `/help` bypasses.
 *
 * Empty text returns false (the empty-text card hint still fires).
 */
export declare function isBypassSlashCommand(text: string): boolean;
/**
 * DSH `ctx.commands` names already documented by the local whitelist
 * below. Used by `formatHelp(nativeCommands)` to de-duplicate the
 * "/xxx — 说明" section so users do not see two rows for the same
 * name (the local row stays the authoritative one because it carries
 * the full subcommand grammar; native rows only describe their
 * discovery-surface description).
 */
export declare const LOCAL_COMMAND_NAMES: ReadonlySet<string>;
/** The /help reply, optionally augmented with native command descriptors. */
export declare function formatHelp(nativeCommands?: ReadonlyArray<{
    name: string;
    description?: string;
    input?: {
        hint?: string;
    };
}>): string;
/**
 * Render one projection value into a WeChat-bounded one-liner.
 *
 * The `ctx.sessionProjections.snapshot(session).values` map is
 * `Record<string, unknown>` — the bridge does not (and intentionally
 * cannot) know each plugin's exact shape. Generic rule:
 *
 * - `null` / `undefined` → literal text `null` / `undefined` so users
 *   can see at a glance whether a key has state (vs. being absent).
 * - `string` / `number` / `boolean` / `bigint` → `String(v)`.
 * - `function` / `symbol` → `undefined` (skip — never legitimate value).
 * - everything else (objects, arrays) → `JSON.stringify(v)` in compact
 *   form. If the result is longer than 120 code units, truncate to 117
 *   and append `…` — WeChat per-message cap is 4 KB but a single
 *   projection line should stay readable on phone screens.
 * - circular references / BigInt / values JSON cannot serialize →
 *   `undefined`; the caller skips the key and logs once. We never
 *   surface an unsanitized shape back to the user.
 *
 * Pure function — no I/O, no side effects, fully testable.
 *
 * @param v The projection's view output (schema-validated host side).
 * @returns A WeChat-ready one-liner, or `undefined` to drop the row.
 */
export declare function renderProjectionValue(v: unknown): string | undefined;
/**
 * Render the full projection section that `/status` appends under the
 * "── 会话级状态 ──" banner.
 *
 * Algorithm:
 *   1. For each key (alphabetically sorted within its group), pick a
 *      smart renderer when known or fall back to `renderProjectionValue`.
 *   2. Group keys into `[模式]`, `[用量与统计]`, `[会话]`, `[其它]`
 *      buckets; emit each non-empty bucket as `[label]` + indented
 *      `• key:` lines (with multi-line continuation indented deeper).
 *   3. Empty buckets are dropped. The caller decides whether the
 *      whole section appears.
 *
 * Smart renderer exceptions are caught and downgraded to the JSON
 * fallback for that single key; other keys still render. The caller
 * does not see exceptions and `/status` stays intact.
 *
 * @param values The `snapshot(session).values` map from
 *   `ctx.sessionProjections`.
 * @returns Pre-formatted lines ready to be appended to `/status`.
 *   Empty when `values` has no keys with renderable output.
 */
export declare function renderProjectionSection(values: Record<string, unknown>): string[];
//# sourceMappingURL=slash.d.ts.map