# DSH Dot approved native UX implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Install the user-approved four-page Dot interaction in the actual Harness plugin while retaining all existing bindings, credentials, native approvals, drafts and saved plans.

**Architecture:** Retain the official conversation.content factory and composer chain. Replace only its occurrence-local views with bounded real text or the official full view when running, pending, rich or unknown. A lifetime native reference and separate exclusive editor lease transfer between Today and floating surfaces. Backend projects stored review state only after current owner, binding and grant validation; unproven legacy items remain unknown. No new source scans, plans or messages occur from mounting the UI.

**Tech Stack:** Existing vanilla ModuleLoader React client, official Harness session/renderer hooks, Cordis/Zod backend, node:test, isolated official Host and Ego Lite.

**Approved visual input:** output/dsh-dot-ux-reset-2026-10-30/prototype.html SHA256 5008524c34f274ea29f3e416ce0bc2536b58b36cb5622ceac5ad3b69fc3e7108. Paper, ink and restrained blue; WHITE main input; first-screen QR; Today/Projects/Memory/Connections; history secondary. Preserve existing dark-mode preference rather than forcing a global mode.

**Isolation:** /Users/shan/.config/superpowers/worktrees/dsh-project-companion/native-ux-20261030, branch codex/dot-native-ux-20261030, base ba3ee03. Canonical unrelated docs/comparison.md and research file stay untouched. Evidence output/dsh-dot-native-ux-2026-10-30. Baseline targeted suite 197 passed, 0 failed/skipped.

## Ownership

- Session implementer: new src/client-conversation.js and dedicated session/view tests. No direct client.js writes; provide exact factory strings and integration contract.
- Frontend implementer: src/client.js render/styles/Surface/Workbench, src/client-overlay.js when synchronized factory changes are necessary, UI tests. Do not edit backend or the session factory implementation owned above.
- Backend implementer: index.js wrapper, src/review-workbench-projection.js, src/personal-review-ledger.js, narrow generate seam in src/personal-review.js, backend tests. Do not edit client.js or context-config.
- Root: context-config optional selection marker, module synchronization and integration, version metadata, verification/package/install/docs. All independent implementers use explicit disjoint files.

## Task 1: Guarded real attention and schedule projection

- [ ] Add tests first for unconfirmed or mismatched owner/binding/grant returning no private card fields; valid current items remain bounded to five; malicious URL/path/token-like material is absent; archived/dismissed or another scope is excluded; source coverage unknown is retained.
- [ ] Add optional grantScopeKey to review item schema. In generate, stamp only actual current candidates using hashReview(JSON.stringify({key:run.key,grant:run.grant})). Do not stamp all old items, backfill rows, or import prior-grant evidence into a newly tagged item.
- [ ] Implement pure projection with contract personalReview.attentionItems={available,items,truncated,coverage,note} and personalReview.schedules={available,items,truncated,note}. Each item has bounded id/title/kind/summary/why/action/unknown/status/real date fields and metadata-only sources. Safe URLs are provider-allowlisted https with no credentials/query. No raw body, root, caller, hash or opaque evidence locator goes to cards.
- [ ] Read raw stored rows in the workbench wrapper, bracketed by current owner/route/grant checks. Do not use act(status) to repair state while projecting, resume agents, fetch sources or run the model. Keep existing fail-closed private guards and legacy readOnly plan separation. Never borrow public-news identity to read private data.
- [ ] Tests include this negative contract with the helper's declared final export (exact export saved in backend-contract.md):

```js
assert.equal(projection.attentionItems.available, false);
assert.deepEqual(projection.attentionItems.items, []);
assert.equal(JSON.stringify(projection).includes('synthetic-private-body'), false);
assert.equal(sourceReads, 0);
assert.equal(modelCalls, 0);
assert.equal(stateWrites, 0);
```

- [ ] Run node --max-old-space-size=128 --test --test-concurrency=1 test/workbench*.test.mjs test/personal-review*.test.mjs test/family-personal-review*.test.mjs. Preserve any genuine baseline failure logs.

## Task 2: Single native editor and compact real conversation

- [ ] Extend/create controller in src/client-conversation.js. One lifetime session retain survives editor moves; acquire/release own the visible editor separately; release failure closes the controller fail-safe; wait/subscription prevents the new surface losing a race with prior cleanup. Invalid, family, missing and subagent targets remain denied.
- [ ] Preserve acquire, release, resolve, restore, remember, close signatures. Add candidate() for a valid legacy pointer, focus() via verified native binding.ctx conversation input, and subscription for ownership changes. Do not query host DOM or write input HTML.
- [ ] Root adds desktopConversationSelectionVersion: z.union([0,1]).default(0).volatile() in src/context-config.js. restore() only selects pointer when this is 1. remember(id), called only on explicit new/continue action, writes pointer plus marker atomically. Old pointer stays as candidate and old records are not deleted/renamed.
- [ ] Pass CompactViews as renderFactorySlot('conversation.content',{variant:'embedded',phase:'active',hero:false},{slots:{views:CompactViews}}). Session-standard useChat/useSession/useSessionStatus/useInput are injected by the official occurrence renderer. Preview only settled plain-text last user/final assistant as React text nodes. Use renderSlot('conversation.session',{view:'chat'}) for ongoing, error, pendingInteraction, attachment or uncertain/rich cases, and explicit full-history mode. Never bypass conversation.composer chain.
- [ ] Write/execute tests before integration: zero auto session creations; explicit click creates once; one editor during delayed readiness/rapid transfer; draft and attachment references retain the lifetime owner; failed release blocks another root; wrong session rejected; pending approval/error/rich data selects full native view.
- [ ] Keep this invariant during integration:

```js
assert.equal(activeEditableRoots, 1);
assert.equal(createdSessions, 0); // mount without user action
assert.equal(restoredLegacyByDefault, false);
assert.equal(nativeApprovalChainUsed, true);
```

## Task 3: Approved four-page frontend and inline QR

- [ ] Recompose Today around white main conversation, guarded real attention items, compact saved schedule rail, and secondary history. Omit duplicate unknown blocks; one banner explains affected data and links to Connections. Unknown never becomes empty, finished or connected.
- [ ] Empty desktop conversation has an explicit start interaction in the white input region; only that user action creates a native session. Existing legacy conversation can be explicitly continued. Keep a single editor and native history record; no fake editable box that pretends to submit to the model.
- [ ] First use places real available QR directly in the first screen, with expiry/refresh state and desktop alternative. Reuse existing passive onboarding connection snapshot/QR viewer. Existing Family binding is never reset; unknown/revoked/offline route is a recovery state, not first use. Do not issue pairing/reset requests during mount just to obtain a code.
- [ ] Projects, Memory and Connections take the approved shared type/spacing/controls. Preserve all real query/edit/forget/catalog functions and scoped drafts; no new tabs or demo records in production.
- [ ] Sidebar remains full workbench entry. Global in-Harness launcher focuses Today when its native editor is active; other pages open a real conversation panel. On inactive panel/unmount, release editor ownership before another surface takes it, retain draft and approvals.
- [ ] Ensure 375px touch targets, no horizontal overflow, keyboard focus/Escape and reduced motion. Do not style internal host chat DOM, modify all-host message performance settings or set global model/theme preferences.
- [ ] Run targeted UI/controller/onboarding tests, then genuine isolated Host screenshots for first use, existing Family, legacy candidate, daily real synthetic fixture, source failure, pending approval, drafts, narrow and floating states. Cross-check against approved screenshot, not only DOM assertions.

## Task 4: Integrated verification and local package

- [ ] Two-stage independent review: spec/interaction contract then code/security quality. Resolve actual issues, no test skips/assertion weakening.
- [ ] Full appropriate three SDK matrix using existing pure code dependency carriers. Keep first failure evidence; do not label capacity/runner trouble as code failure. Freeze exact source and package.
- [ ] Version Dot candidate 0.19.0-preview.1; bridge 0.11.1-dot.3 and Family review.3 unchanged. Pack deterministic tgz, compare every runtime file against isolated official Host and delivery manifest.
- [ ] Do not call production source/model/WeChat or create real test plans. Synthetic Host data and already-authorized existing natural run metadata only. Native UI screenshot verification is not phone receipt.

## Task 5: Safe daily install and handoff

- [ ] Check all official App/Host tasks idle. If another task owns them, preserve it and checkpoint; do not force stop or bypass installer. User previously authorized normal backup, exit, upgrade and reopen, so no routine reapproval.
- [ ] Fresh 0700 private backup; preserve original four WeChat bindings, five-source authorizations, independent family permissions, existing plans, drafts, other plugins and travel state. Apply exact verified Dot package only and reopen official App.
- [ ] Verify before/after package hashes and state invariants, new optional selection marker only after explicit action, all native four pages/QR/floating and guarded unavailable state. Never use WeChat client UI.
- [ ] Update checkpoint/progress and canonical docs without overwriting unrelated dirty files. Public Release/push is not authorized in this iteration. Report actual installed state separately from candidate/prototype. Batch only genuinely necessary phone acceptance; do not ask user to replay whole loop for a visual change.

## Out of scope / truthful boundary

Google review remains separately UNDER_REVIEW; do not resubmit or change dot-flomo. Natural 09:00 empty-model and 11:00 preflight failures remain diagnostic work, not proven repaired by this UI. No new context providers, subscriptions, remote sends, public publishing or copied private credentials. User has approved this implementation; do not ask them to reconfirm the design, worktree location or execution mode.
