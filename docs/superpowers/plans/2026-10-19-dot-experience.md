# Dot Experience Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the bounded host task and independent reviews.

**Goal:** Deliver an understandable desktop project overview and reversible Dot appearance.

**Architecture:** Extend the passive workbench projection with read-only structured memory, rearrange the owned React page around project context and status, and apply an optional global theme through the public token adapter and existing ConfigForm. Preserve the original app structure and all communication state.

**Tech Stack:** Existing Harness 0.2.0/0.2.1 SDK, React ModuleLoader client, Node built-in tests, SQLite read-only inspection, native ConfigForm.

## Tasks

- [ ] Host memory projection: add read-only `inspect` without DB writes; tests for missing/foreign/symlink/closed states; project overview carries bounded goal/blocker/next-step records and provenance, with unavailable distinct from empty.
- [ ] Client workbench: source-labelled context before details; no inference of completion; meaningful session labels from available native state; no automatic model calls or outgoing messages.
- [ ] Theme: one normal optional config field, lifecycle-safe public-token adapter, native/Dot toggle; tests for initialization, switching, saving failure, read-only configuration, missing theme service and unload restoration. Keep global font preferences unchanged.
- [ ] Review and verify: full supported SDK matrices; independent spec then quality review; repair concrete findings; build `0.8.0-preview.1` candidate with full license/vendor audit.
- [ ] Native acceptance: official idle-host update, real view/toggle/restore/navigation checks, unchanged-state fingerprints, correct-format before/after screenshots, current progress and documentation. Keep human phone acceptance pending.
