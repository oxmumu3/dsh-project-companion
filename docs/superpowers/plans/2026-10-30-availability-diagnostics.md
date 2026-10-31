# Natural Availability Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Record the exact safe failure category from existing natural admission calls, without relaxing authority or triggering additional reads/sends.

**Architecture:** Keep Family delegation's string route API and all revocation rules unchanged. Add an optional fail-isolated observer emitting only closed route/reason enums. Personal review adds an optional diagnostic field to its existing recovery observation, storing availability state and an allowlisted guard code. Index passes the result of the already-required route call; no second production probe. No raw error text, session, account, source label, path, grant, fingerprint or token enters the new diagnostic. Old stored rows remain parseable; changed diagnostic cause is persisted even within the existing five-minute cadence. Public-news behavior stays unchanged.

**Tech Stack:** Node ESM, Zod, existing in-memory test fixtures and SDK carriers.

### Task 1: Family route observer
- [ ] Extend test/family-owner-delegation.test.mjs first: closed allowlist reason for unavailable bridge, bridge unknown/offline/changed, credential/lease failures, current; no extra bridge or credential reads, no secret/canary leak; throwing observer cannot alter gate or revocation.
- [ ] Run tests red, preserve original failure output.
- [ ] Add optional onRouteDiagnostic observer in src/family-owner-delegation.js. Emit only {state, reason}; no error objects. Do not modify current/recheck/news semantics or relax select.
- [ ] Run focused tests green; commit.

### Task 2: Pre-job review diagnosis
- [ ] Write test/personal-review-availability-diagnostic.test.mjs for route unknown/changed/offline, route throw, fixed guard authorization/binding/pause codes; no jobs/collect/model/send under blocked states; legacy rows load; changing reason persists immediately; normal repetition throttled; clearing diagnostic on current; private canaries stripped.
- [ ] Run red; preserve output.
- [ ] Add optional on-route metadata via readAvailability returning string (legacy) or strict {state,reason}. Persist only closed enums under optional recovery.diagnostic. Guard error code must come from existing safe personalReviewFailure, with other mapped to REVIEW_FAILED. Preserve all cancellation, scheduling, budget, guard, key and quiet semantics.
- [ ] Index integration captures only one existing Family routeState call plus observer result. No source/bridge extra calls, no production API or status probes.
- [ ] Run focused suite green; independent spec and quality review before any packaging.

### Delivery boundary
No production state edits, new tasks, source reads, model probes, WeChat sends or runtime installation in these tasks. Version stays 0.19.0-preview.1 until root freezes/reviews a candidate. Daily installation is a separate guarded step. This diagnostic does not fix a stale source grant or establish phone receipt.

### Current evidence
Pure current credential metadata proves flomo's saved account identity differs from the old enabled lease, while dida matches. The old Family scope cannot adopt the new identity automatically. This establishes a current private-source admission obstacle, not the historical 09:00/09:10/11:00 causes or the separate public-news route.
