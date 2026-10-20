# DSH Dot Personal Agent UX Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development; shared worktree with exclusive file ownership, independent spec and quality review.

**Goal:** Implement the approved local HTML interaction in the real Harness plugin, including first-phone-value, actionable attention, explicit follow-up and correctable project memory.
**Architecture:** Preserve Harness native sessions, existing exact WeChat binding, community memory/scheduler and official owner-authenticated connection routes. GET remains passive. Every write requires explicit intent, exact watched project and checked original binding; no automatic external send or new schedule on mount. Phone delivery remains a user confirmation.
**Tech Stack:** Node ESM, official 0.2.0/0.2.1 SDK, React ModuleLoader, existing SQLite memory and proactive libraries; bounded real-material host/UI verification.

## Baseline
- Existing feat/dot-experience worktree, HEAD ca17b25; 518/518 baseline tests passed.
- Approved visual target: ../../output/dsh-dot-design-2026-10-19/DeepSeek-Dot-交互方案.html.

## Tasks and file ownership
- [x] Memory: src/project-memory.js, src/guidance.js and memory-specific tests. Add revise/forget operations on exact stored record, requiring explicit user request and preserving project scope/provenance. Remember returns a bounded receipt. Fail tests first for foreign ID/root, unauthorized write, dedupe, persisted correction/deletion and safe read-only inspection.
- [x] Actions/follow-up: new src/workbench-actions.js, src/workbench.js, src/project-followup.js and focused tests. Authenticated /api/project_companion/workbench/actions supports task_detail, followup_status/configure/cancel, check_once/cancel_once and memory_update/forget; opaque project IDs map only watched projects. Recheck binding around awaits; no arbitrary root/session transport. Add explicit dueAt one-off checks within seven days while keeping delaySeconds existing range. Return true next-run metadata and separate execution/delivery states. Do not start any plan in tests against real state.
- [x] First brief: src/onboarding.js, new src/onboarding-outcome.js and focused tests. Preserve existing complete/idempotency behavior, expose read-only bounded reply observation tied to original message+binding, and add explicit user confirmation of mobile receipt. Never derive receipt from admission/reply/send; never auto-resend on failure or refresh. Root wires dependencies and row schema in index.js.
- [x] Integration/UI (root): index.js, src/client.js, package metadata and UI/host tests. Reproduce the approved primary WeChat CTA and conversation-centered home. Native one-session draft initialization preserves drafts and never auto-sends. Attention prioritizes blocked/running/replied jobs with human labels and full result detail. Project drawer has overview/memory/sources tabs; follow-up confirmation specifies project/time/channel and offers cancel; memory edit/delete requires explicit confirmation. Desktop fallback remains available. Settings/appearance/account connections stay secondary.
- [x] Verification/release candidate: full supported SDK matrices once final changes settle; spec review then independent quality review, resolve findings; package 0.9.0-preview.2, verify files/licenses, install through official CLI without touching bridge pairing, review the native dsh-app UI through targeted CUA (no browser or Chrome needed). Confirm previous binding/state hashes. No new WeChat sends or schedules without the agreed bounded phone test; batch any unavoidable user phone confirmations.

## Explicit contracts
- memory.revise({root,sessionId,id,text,userRequested:true}) and memory.forget({root,sessionId,id,userRequested:true}); receipts contain exact id/kind/text and project-scoped provenance.
- createWorkbenchActions({service,memory,followup,taskResults,readConnection,resolveOwner,activateOwner,isClosed,clock}) exposes action(input), close(); registerWorkbenchActionsRoute(ctx,adapter) owns the exact authenticated route above.
- createOnboarding accepts optional readWelcome({sessionId,messageId}); snapshot welcome carries outcome without raw session logs; action confirm_received stores user receipt separately from completed/accepted.
- Root owns index.js and client.js; implementers must not edit those files. Integration snippets supplied in their handoffs.

## Acceptance
- New installation visibly connects WeChat, selects projects and submits first brief; UI does not call admission or channel receipt mobile delivery.
- Page navigation/refresh has no model/send/schedule/memory mutation side effects.
- Result and task always retain project association; executing and sending are distinct states.
- Follow-up needs confirmation, has visible next due time and cancel, pauses on revoked binding/unwatched project; quiet on no meaningful changes.
- Memory receipt and correction/deletion survive restart, cannot affect another project, and preserve source identity.
- Original bridge version, pairing, existing schedules and active sessions retained. Unsupported SDK surfaces fail clearly instead of shell/GUI hacks.

## Final evidence

Installed0.9.0-preview.2 through official CLI; SDK matrices614/614each; backend and UI independent reviews PASS. Actual native exact-session draft/preservation test passed and test drafts cleared. Four existing state fingerprints unchanged. First-use phone receipt remains user confirmation; no new WeChat message/schedule created. Current publicdownload0.6.0-preview.1.
