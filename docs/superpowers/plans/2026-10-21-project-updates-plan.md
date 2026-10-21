# Project Update Cards Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. This isolated branch implements the already approved design; no new permission choice is needed.

**Goal:** An explicit single-project preview returns grounded changes/blockers/next steps and suppresses repeated visible content without modifying files, memories, plans or WeChat.

**Architecture:** `project-updates.js` owns safe source projection, content fingerprints, scope gates, bounded summaries and a separate native storage domain. `project-update-model.js` uses the current host model without tools or a new session. `service.fixedProjectAnalysis` reuses the fixed file reader without GitHub or observed history, while `memory.inspect` preserves read-only memory semantics.

**Tech Stack:** Node built-ins, existing Zod/DeepSeek SDK and native model runtime; no new dependencies.

- [ ] Write `test/project-updates.test.mjs` importing missing service. Test `await service.preview(owner,{project:root,userRequested:true})`: first result `overview`; same text with changed modifiedAt yields `{quiet:true,text:''}` with no second model call; changed blocker yields `updated`; source loss remains unknown; denied scope/model/store failure never commits.
- [ ] Run `node --test test/project-updates.test.mjs` and record RED missing export. Implement new service with `projectUpdateRowSchema`, `createProjectUpdateService({store,readScope,authorizeSync,readProject,readMemory,summarize,clock})`, `.preview/.suspend/.close`.
- [ ] Model subagent owns only `src/project-update-model.js` and its synthetic tests, exporting `createProjectUpdateModel` and `validateProjectUpdateSummary`. Validate known source IDs, exact quote/inference/suggestion roles and max3×200 characters per section; no URLs, authority claims, tools or invented verified flags.
- [ ] Add fixed-source seam regression in `test/service.test.mjs`: `fixedProjectAnalysis(root,owner)` reads only `PROJECT_FILES`, never release/events and rejects unwatched roots. Implement using existing `analysisSource` with prior/final watched/paused checks.
- [ ] Add a synthetic host test for `project_companion action=project_update` with explicit project/intent, no sends/timers/dispatch. Wire independent domain/model/service lifecycle, pause/unwatch cancellation and exact current binding in `index.js`; guidance explains quiet and visible-only coverage.
- [ ] Run focused new suites plus service/host regressions, `git diff --check`, inspect original digest/plans unchanged. Commit implementation and plan; root handles full SDK matrix, package version, installation and release.

Preview proof is not real model quality, phone receipt, installation, or proactive scheduling. Existing follow-up plans retain their old guarded memory/digest flow; this action does not migrate or edit them.
