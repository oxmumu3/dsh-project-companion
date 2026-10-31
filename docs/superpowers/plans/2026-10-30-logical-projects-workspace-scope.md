# Logical projects and workspace scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Execute independent bounded tasks against the shared contract; integrate and independently review before packaging.

**Goal:** Deliver the approved logical-project board and first/later workspace access selection in the real plugin, with native conversation and real bounded recognition.

**Architecture:** Two new strict storage domains separate profile-owned workspace scope from logical objectives. Reuse the official registry/history API, guarded file reader, configured model adapter and native conversation controller; existing Family/Google/news/plans remain untouched. HTTP endpoints are specified in docs/design/logical-projects-workspace-access.md.

**Tech Stack:** Node ESM, Zod, official Cordis storage/session/connection APIs, existing React ModuleLoader client, node:test.

## Tasks and ownership

- [ ] Scope backend (primary): create src/workspace-access.js, src/workspace-access-route.js, src/goal-board-collect.js and tests; integrate new domains/routes in index.js. Start with failing assertions that an unselected file/session is never read, stale root/CAS fails, and revoked in-flight scope cannot reach model/commit. Run `node --max-old-space-size=128 --test --test-concurrency=1 test/workspace-access*.test.mjs test/goal-board-collect*.test.mjs`.
- [ ] Logical objectives (implementer): create src/goal-board-store.js, src/goal-board-service.js, src/goal-board-model.js, focused tests. Use the exact service interfaces in the contract. Prove persistent IDs/vision, two-session proposal threshold, ignored/corrected source locks, partial coverage, no retry after interrupted scan and per-project native conversation reuse with no submit. Run `node --max-old-space-size=128 --test --test-concurrency=1 test/goal-board-*.test.mjs`.
- [ ] Native frontend (implementer after contract): modify src/client.js and add src/client-goal-board.js (and focused client tests). Reuse DesktopConversation/SessionProvider/renderSlot and existing context APIs. Exact endpoints/shapes are in the contract. Prove first/append/remove/cancel/pagination and one active native composer, per-project draft survival, unbound first use, empty/error rendering, no fake examples. Run focused `test/client*.test.mjs` and `test/workbench*.test.mjs`.
- [ ] Integrate and self-review: wire both new strict domains and routes; bounded official history adapter, session creation and trusted goal system context. Run new domain/host integration tests, existing install/Family/context/desktop regressions, then SDK matrix only after runtime freeze. No existing full test repeated without relevant change.
- [ ] Independent spec and security review: review revocation, stale/in-flight writes, exact source IDs, rooted metadata checks, native draft/attachment approval chain and status evidence. Fix actionable findings and re-run affected tests.
- [ ] Official Host/UI: load exact package with synthetic registered workspaces and native sessions in isolated official profile; test grant then real model recognition, reload, correction, ignore, revoke, side-sheet native input and first use before WeChat. No production source reads, sends, plans or personal OAuth.
- [ ] Safe local delivery: version 0.20.0-preview.1, freeze audited exact artifacts, verify other daily tasks idle, fresh0700 backup, normal quit, official installer, reopen, strict all-state audit plus explicit new-empty-domains classification. Never auto-select daily workspaces. Update evidence/progress and give the user minimal real scope-selection verification only after computer checks. Do not push/publish.

## First verification commands

`node --max-old-space-size=128 --test --test-concurrency=1 test/project-catalog.test.mjs test/desktop-conversation.test.mjs` establishes relevant baseline in this isolated tree. New tests must fail due to absent behavior before production code; preserve red/green logs outside distributable runtime. Approved UI and user authority are already settled; do not stop for another plan-choice prompt.
