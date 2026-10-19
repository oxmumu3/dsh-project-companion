# Native Dot Workbench Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement and independently review the scoped host and client changes.

**Goal:** Deliver a native Dot sidebar entry and project workbench backed by the existing authorized project data.

**Architecture:** A read-only owner-authenticated host snapshot feeds a client main-panel plugin. Existing stores, binding checks and source readers remain authoritative. Official additive layout/sidebar slots preserve the default conversation surface.

**Tech Stack:** Harness 0.2.0/0.2.1 Cordis host services, React via ModuleLoader, same-origin fetch, Node built-in tests.

## Task 1: Host snapshot and route

Files: `src/workbench.js`, `test/workbench.test.mjs`, `index.js`.

- [x] Write and run failing tests for watched-only scope, unavailable bindings, source failures, output bounds, no mutation, binding changes and route method rejection.
- [x] Implement `createWorkbench` and `registerWorkbenchRoute` using `service`, `taskResults`, `readSetup`, the fixed-file reader and the official `connection.fetch.register` boundary.
- [x] Register and close the adapter in `installCompanion`; return the adapter for integration testing.
- [x] Run `node --test test/workbench.test.mjs test/host.test.mjs`.

## Task 2: Native client panel

Files: `src/client.js`, `package.json`, `test/workbench-ui.test.mjs`.

- [x] Verify installed SDK registration and navigation contracts; record exact supported service use.
- [x] Write and run failing behavior tests for additive slots, GET-only mount, escaped/untrusted content, refreshing and failures, selected-project state, explicit navigation and cleanup.
- [x] Register owned main/sidebar entries with the official layout service and optional compatibility guard.
- [x] Implement bounded fetch with cancellation, project/detail layout, source provenance, true handoff/reminder status labels and explicit navigation.
- [x] Run new UI tests and existing onboarding/context UI tests. Preserve the existing settings and configuration behavior.

## Task 3: Package and review

Files: `README.md`, `docs/quickstart.md`, `docs/verification.md`, release metadata.

- [x] Document the desktop entry, reads performed on opening, default-off behavior and evidence boundaries.
- [x] Independently review spec compliance, then code quality; repair concrete findings.
- [x] Run complete supported SDK matrices and existing artifact audit; version candidate `0.7.0-preview.1`.

## Task 4: Native verification

- [x] Read current host task activity and installation state without exposing credentials or altering jobs.
- [x] Use the official local plugin installer; preserve existing state and binding.
- [x] Inspect the actual sidebar entry, project data/detail rendering, navigation, empty/error states and no unintended output/plans. Capture Harness-only evidence.
- [x] Record runtime-byte comparison, automated results and separate phone acceptance status; present the user a concrete result.

## Execution record

Both SDK matrices passed 485/485. Spec and quality reviewers independently passed after unknown-state and active-reminder-window repairs. Official CLI installed 0.7.0-preview.1; 58 runtime files match the tested candidate. Native sidebar, workbench, provenance expansion, settings modal and both explicit navigation paths passed. Three existing state/ledger/onboarding files were byte-identical before upgrade and after UI checks. No WeChat UI automation, messages, model submission or new plans. Candidate remains unpublished; original public 0.6 release stays available.
