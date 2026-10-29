# Personal Review Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent modules and review integration before installation.

**Goal:** Daily/weekly discovery of useful risks, deadlines and progress across explicitly enabled personal context, with persistent AI news interests.

**Architecture:** Add an Owner-level personal-review domain and bounded evidence collector; reuse provider adapters, scheduler utilities, host model, routing, and delivery guards. Shared Family route must validate a real Owner request and preserve independent family permissions. No production scans are enabled by installation.

**Tech Stack:** Node ESM, zod, official DSH Cordis/storage/tools/client SDK, existing node:test suite.

## Execution

- [x] Read accepted scope and current runtime contracts; create isolated worktree at f611a69. Baseline news-service/context-loop: 110/110 pass.
- [x] Core: src/personal-review.js, personal-review-ledger.js, personal-review-model.js and test/personal-review*.test.mjs. Test source-backed unseen risks, citation rejection, deadline escalation despite same content, feedback, per-occurrence delivery, restart ambiguity, cancellation and binding/grant change before implementation.
- [x] News: migrate stored explicit interests safely, set_topics/clear_topics/configure topics, freeze topics per job, reuse in scheduled selection and summary. Tests cover restart, cross-owner exposure, override preview and cancellation.
- [x] Collector: src/personal-review-collect.js. Construct recent-source queries within visible budgets, collect fixed project docs and memory, include coverage and provenance. Add tightly bounded recent Drive/flomo contracts without weakening search/read contracts. Tests use fake transport only.
- [x] Host: register personal_review tool and storage domain, original Owner delegation, timer and shutdown, sources/project scope explanation and UI draft entry. Synthetic official Host tests cover configure without reads, due review, pause/revoke and no duplicate return.
- [x] Family: extend intent routing and tool admission for personal review/news preferences, verify cross-host synthetic Owner/member separation without bypassing existing gates.
- [x] Verification: SDK 020/021/021rc3 each 1676/1676, independent review, immutable candidate package, isolated official Host/UI and normal daily upgrade. Strict restart difference retained and separately classified as two existing reconnect timestamp caches only.
- [x] Delivery: update docs and evidence; four exact phone acceptance sentences passed final parsers and real wrappers. Fresh phone requests and natural multi-day/weekly acceptance remain explicitly pending, not replaced by synthetic delivery.

## Stable interfaces

`createPersonalReviewService({store,readBinding,authorization,canRun,collect,summarize,send,clock})` exposes `ready,act,tick,needsTimer,suspend,close`. `act` supports configure/preview/run_now/status/pause/resume/cancel/feedback. Scope contains sources, registered projects and daily/weekly timeZone schedule. Collection returns evidence and coverage; model returns cited candidates. Ledger owns handled/snoozed/dismissed state, deadline reminders and dispatch receipts.

User approved this design and execution; no further routine design approval is needed. Run tests with `node --max-old-space-size=128 --test --test-concurrency=1 test/<target>.test.mjs`, preserve failures and root causes. Do not relax guards or tests to make acceptance pass.
