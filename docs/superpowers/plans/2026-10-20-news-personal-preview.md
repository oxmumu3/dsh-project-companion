# Explicit Topic News Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add one-request topic-aware AI news previews and rotate the RSS scan start by UTC day without sending messages, reading private context, persisting interests, or changing existing subscriptions.

**Architecture:** Preserve the existing `ai_digest` tool name and two-stage host-model pipeline. Validate `topics` at the service and model boundaries; only preview accepts them, forwards the bounded values as a separate reader-focus field, and labels the result as temporary. Independently rotate the existing fixed source array before the bounded RSS workers, preserving URL validation, source identity, cancellation, scan statistics and once-per-source semantics.

**Tech Stack:** JavaScript ESM, Node.js `node:test`, existing Harness model/tool services and Zod storage. No new runtime dependencies.

---

## File responsibilities and constraints

- Create `src/news-topics.js`: shared pure validation for optional explicit topics, maximum 8 items × 80 UTF-16 characters, 400 total characters; reject wrong types, control characters, blank/duplicate values and oversized input. Trim topic strings; no account/project reads or persistence.
- Modify `src/news-service.js`: reject `topics` on every action except preview before state or external IO; pass validated topics to selection and summarization; label temporary personalized preview output while keeping schedule, delivery ledgers and existing generic behavior unchanged.
- Modify `src/news-model.js`: include optional topic focus in both model requests, update selection/relevance instructions, validate topics independently, preserve exact IDs and no-tool/public-source boundaries.
- Modify `src/news-render.js`: use an optional preview-only preamble within the existing 3,200-character message budget, including zero-result output. The preamble says the focus is for this preview only and no send or schedule was created.
- Modify `src/news-feeds.js`: rotate the validated feed array by stable UTC-day offset. Never mutate the bundled array, change a feed record, add URLs or scan a source twice.
- Modify `index.js`: expose optional `topics` only for preview in the existing `ai_digest` schema/description. Keep name, default-off behavior and all authorization guards.
- Modify `docs/news.md`, `docs/news-feed-provenance.md` and focused tests: accurately describe one-off interests, generic schedules and source scan coverage.
- Do not modify package version, live configuration, other worktrees, publication artifacts or accounts.

## Task 1: Topic contract and safe model inputs

- [x] Write tests for valid one-topic and eight-topic input, trimming, absence, wrong type, blanks, duplicates, control characters, item length 81 and total length above 400. Add model tests that inspect selection and summary request JSON and verify both receive the same explicit focus, without tools or local/private context.
- [x] Run `node --test test/news-topics.test.mjs test/news-model.test.mjs`; confirm the new expectations fail before adding behavior.
- [x] Implement a pure validator with this contract:

```js
export function normalizeNewsTopics(value) {
  const invalid = () => { throw Object.assign(new Error('Invalid news topics'), { code: 'NEWS_INVALID_TOPICS' }); };
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) invalid();
  const topics = [];
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) invalid();
    const item = value[index];
    if (typeof item !== 'string' || item.length > 80 || !item.isWellFormed() || /\p{Cc}/u.test(item)) invalid();
    const topic = item.trim();
    if (!topic || topic.length > 80) invalid();
    topics.push(topic);
  }
  if (new Set(topics).size !== topics.length || topics.reduce((n, item) => n + item.length, 0) > 400) invalid();
  return topics;
}
```

- [x] In both native model entry points accept `{articles, signal, topics}`; normalize before any provider call, then serialize `readerFocus: { topics }` only when present. Add instructions that focus may affect ranking, but cannot justify fabricated links between an article and user interests; `why` should cite an actual matching focus when the supplied evidence supports it. Unrelated candidates may be omitted.
- [x] Rerun topic/model tests until passing. Keep the no-focus request unchanged except non-semantic prompt clarification.

## Task 2: Temporary preview and unchanged subscriptions

- [x] Write service tests proving topics reach both model stages; a topic preview changes no persistent state and calls no send; no-topic preview stays generic; every non-preview action with topics rejects before external calls or state mutation. Include already-configured daily schedule snapshots, invalid types and zero-result output.
- [x] Write renderer tests for a preview preamble with 8 topics and full candidate URLs: text stays at most 3,200 characters, retains complete source URLs, and never adds topic text to scheduled or manual-send outputs.
- [x] Run `node --test test/news-service.test.mjs test/news-render.test.mjs`; confirm new assertions fail.
- [x] In service admission use `Object.hasOwn(input, 'topics') && input.action !== 'preview'` to reject accidental subscription changes. Normalize topics once, forward in `generate(scope, topics)` to both injected model methods, and pass optional preview-topic metadata to the renderer. Do not add topics to the persisted row schema, jobs, history or schedule.
- [x] Renderer adds a plain-text bounded line naming the focus plus `仅本次预览；未发送、未创建或修改推送计划。` before calculating the existing message budget. Optional return metadata may expose the normalized temporary topics; it must never be saved.
- [x] Update the `ai_digest` tool schema with `topics: {type:'array',items:{type:'string'}}` and description `仅 preview；最多8个、每个80字、总计400字；本次有效，不保存、不读取个人账号或项目。` Include an example in docs and describe rejection for other actions.
- [x] Rerun service/renderer tests and a focused host registration test to confirm schema forwarding, keeping all existing pause/binding/cancel behavior.

## Task 3: Fair bounded RSS scan order

- [x] Write a synthetic fetch test capturing source order for two instants within one UTC day and the following UTC day. Assert same-day determinism, daily rotation, exactly one read per requested source, unchanged bundled input and consistent coverage counts; retain existing private-DNS, redirect and cancellation tests.
- [x] Run `node --test test/news-feeds.test.mjs` and confirm the new order assertion fails.
- [x] After validating the source array and timestamp compute `offset = Math.floor(timestamp / 86400000) % feeds.length` (zero sources use offset 0); workers consume `[...feeds.slice(offset), ...feeds.slice(0, offset)]`. Original validation and result array size/statistics remain unchanged.
- [x] Document this as rotating scan priority, not proof of daily full coverage. Keep the 45-second deadline, 8-second source bound, 4-worker cap and public destination checks unchanged.
- [x] Rerun feed tests, including existing transport and parser guards.

## Task 4: Focused verification and isolated handoff

- [x] Run `node --max-old-space-size=128 --test --test-concurrency=1 test/news-topics.test.mjs test/news-model.test.mjs test/news-service.test.mjs test/news-render.test.mjs test/news-feeds.test.mjs` and the focused host case for `ai_digest`. Run `node --check` on changed JavaScript and `git diff --check`.
- [x] Independently inspect the diff: no package version/live config/source list mutations, no private reads or outbound test sends, no topic storage, no new schedule, generic subscription behavior unchanged. Record exact pass counts and any test boundary.
- [x] Commit only this isolated feature and its plan/proposal/docs/tests with message `feat: add explicit-topic news previews and rotate RSS scan priority`. Return the SHA and touched files to root; root owns integration/full SDK matrices and any release/install decisions.

## Spec self-review

The plan covers preview-only topics, independent validation at model/service boundaries, truthful relevance and no fabricated linkage, no private context, no persistent interests or subscription changes, stable UTC rotation, unchanged fetch safety/cancellation/statistics, documentation, focused tests and an isolated commit. Execution is already explicitly authorized by root/user; continue inline without asking another execution-choice question.


## Execution evidence (2026-10-20)

- RED checks were run before topic normalization/model forwarding, preview/render behavior, and UTC rotation were implemented. A further sparse-array/oversized-padding regression failed before the validator was strengthened.
- Focused news command in Task 4: **87/87 PASS**, zero failures (latest run about 22 seconds under concurrent load). All transport/model results were synthetic; no public feed or private account was queried.
- Related host command: `node --max-old-space-size=128 --test --test-concurrency=1 --test-name-pattern='AI digest|failed news cleanup|natural-language guidance' test/host.test.mjs`: **9/9 PASS**.
- All 7 changed JavaScript entry/module files passed `node --check`; `git diff --check` passed. Standard existing MockTimers/SQLite experimental warnings remain.
- Full focused run initially exposed an old deadline test's fixed-first-source assumption (85/86). The test now completes whichever source is attempted first, preserving its deadline, retained-success, skipped-source and failure-statistics assertions; the focused test and full news set then passed.
- Inspected boundaries: unchanged package version, feed list, runtime configuration, live instance, credentials, delivery/schedule persistence, timeout and concurrency limits. Topics reach only this preview's two model calls and output; no inferred interests or external context.
- Independent read-only diff review by `context_host_research` found an existing service-input reference race: a caller could mutate preview into cancel after admission. Added a failing regression, snapshotted input before validation/queueing, then verified cancel/configure/send_now mutations cannot change the admitted preview, plan or send count. Final independent read-only re-review confirmed the snapshot fix closes the reported race; no remaining blocker. Integration/full SDK matrices remain root-owned.
- Not verified by this change: real-model ranking/relevance quality, real RSS or article availability, actual WeChat rendering/receipt, recurring behavior or user acceptance. Existing scheduled content remains generic, because temporary preview topics are intentionally not saved.
