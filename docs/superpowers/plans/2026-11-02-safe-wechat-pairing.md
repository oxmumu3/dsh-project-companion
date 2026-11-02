# Safe WeChat pairing implementation plan

> Execute inline using systematic debugging and TDD; request independent security review before integration.

**Goal:** Remove first-message ownership without adding steps to the normal QR flow.

**Architecture:** A pure resolver in `vendor/dsh-wechat/dist/bridge/peer-pairing.js` establishes QR or explicit local allowlist authority and checks old state consistency. The bridge calls it at startup, ingress, config changes and every delivery boundary. Existing failed setup/status UI carries actionable fixed messages without exposing IDs.

**Tech stack:** JavaScript ES modules, Node test runner, exact Harness SDK fixtures and official isolated Host.

- [ ] Add `test/embedded-wechat-pairing.test.mjs`: synthetic scanner/stranger first-message ordering; observe current behavior fail before edits. Use real bridge, temporary local storage and intercepted synthetic-only transport.
- [ ] Implement resolver and bridge initialization/ingress/output checks. Never use persisted first sender as authorization. Run new tests to green.
- [ ] Cover durable restart, conflicts, missing identity, explicit legacy allowlist, live revocation and asynchronous file-read race. Preserve queues and source state on blocked operations.
- [ ] Update setup projection, connection copy, README and Chinese/English first-pairing explanation; add assertions that blocked pairings never project as connected. Update embedded patch/provenance hashes.
- [ ] Run risk-matched supported SDK regressions, independent review and exact final archive official isolated Host install/enable/uninstall/reinstall/restart. Recheck official desktop and SDK live.
- [ ] Only after gates, integrate using the existing trusted public workflow, verify canonical source/npm/Release and update the existing catalog PR. Keep daily private .21.7 and all natural/market/Google monitors.
