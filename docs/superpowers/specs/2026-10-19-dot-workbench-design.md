# Native Dot workbench

## Accepted direction

Add a persistent Dot entry and an independent native main panel to DeepSeek Harness, alongside the existing conversation interface. Show the user's watched projects, source-backed recent information, pending reminders and handoff status. Opening the interface must not start model work, send WeChat messages, create plans, change project memory or restore idle sessions.

## First slice

- Register `main` and `sidebar.panellist` with the same owned panel ID; navigate with the official layout service. Do not replace root, sidebar, composer or conversation nodes.
- Read a new authenticated GET-only workbench snapshot. It reuses the existing watched-project scope, fixed-file reader, reminder state and current bound source session's handoff ledger. No new state store or external account reads.
- Render a theme-aware, responsive page: concise heading and actions; watched project list; selected project's explicitly sourced details; actionable-state overview; recent handoffs and reminder schedule. Keep observed source content distinct from independently verified business completion.
- Provide explicit refresh, open the bound Dot conversation, and open a known project conversation. Navigation never submits a message. Display cold/missing/unavailable states and never pick a session ambiguously.
- Retain onboarding and connection settings. UI registration and CSS must dispose cleanly when disabled. Do not install another bot implementation.

## Visual direction

Engineering minimalism, using Harness typography and light/dark tokens. One restrained blue accent, fine dividers, clear hierarchy, compact status labels, no decorative gradients or nested card stacks. Project rows and a readable detail pane should carry the information. Responsive single-column layout on narrow panels. Visible keyboard focus and semantic buttons/headings.

## Acceptance

Functional tests cover ownership, scope, escaped content, read-only behavior, late responses and navigation; both supported SDK matrices must pass. Build an audited candidate, install using official tooling only when no active Harness tasks would be interrupted, inspect native sidebar and workbench, compare installed runtime bytes. Keep original binding, plans and data. Phone acceptance remains separate and no WeChat UI automation is permitted.
