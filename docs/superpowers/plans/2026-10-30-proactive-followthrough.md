# Proactive follow-through Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development with isolated branches and independent review.

**Goal:** Complete source closure, bounded recovery, explicit goal/meeting preparation, and standalone delivery using existing Dot components.
**Architecture:** Extend existing review state and adapters; keep scope, binding revision, request id and notification budget guards.
**Tech Stack:** Node.js ESM, zod, Cordis official SDK, node:test.

- [ ] Source completion and stable identity: personal-review-ledger.js, personal-review-collect.js, narrow generate integration; regression for title/key changes, exact completed task, missing/failed/404, independent mail tasks.
- [ ] Recovery: personal-review.js tick and new recovery policy module; regressions for asleep 11:00/resume12:00, repeat resume/restart, quiet hours, revoked/paused, unknown delivery and >7 day boundary.
- [ ] Goal/meeting: personal-review-goals.js, service state/actions, explicit goal intent, tool schema, bounded material integration; tests for explicit scope, pause/complete, ambiguous meeting, cancellation/reschedule and cited evidence.
- [ ] Standalone: bridge serialized atomic guard + durable receipts, index adapter, existing local control; tests across collection/model/send rebind/revoke and no Family dependency.
- [ ] Integrate commits and run relevant regression, full 3 SDK matrix and independent source review. Preserve original failures and fix causes rather than weakening assertions.
- [ ] Freeze exact packages, isolated Host/UI and migration verification. Only then normal daily upgrade if safe, preserving all bindings/grants/plans/other plugin state.
- [ ] Record exact tested boundary, pending phone/real sleep and public release state. No release from this engineering turn unless separately completed against existing release authorization.
