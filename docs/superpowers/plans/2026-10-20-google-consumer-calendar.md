# Google Calendar consumer connection implementation plan

Goal: deliver the Calendar-only ordinary-user OAuth and REST path with a truthful preparation state until this product registers its own Desktop OAuth client. No real account authorization or private reads in this implementation.

Architecture: a separate Calendar OAuth record and controller use a product-owned public client, PKCE and a random loopback callback. Revision-CAS native storage and current owner/binding/pause checks gate mutations. Calendar uses a fixed read-only REST provider; other Google sources keep the explicitly advanced MCP route. No automatic fallback, scan or schedule.

Tech stack: Node built-ins, existing DeepSeek SDK and native Config Forms. Zero new dependencies.

1. RED: synthetic OAuth tests for publisher-missing/no IO, Calendar-only scope, callback/refresh, scope validation, stale owner/config/CAS and close cancellation. Extend credential-writer tests for the Calendar secret field.
2. GREEN: add `google-publisher.js`, `google-calendar-auth.js`; extend only named Config fields and CAS writer.
3. RED/GREEN: add provider dispatch and service tests proving local catalog is not an API read, Calendar credential identity is separate, coverage/all-day caveats retained. REST adapter/tests owned by root in this worktree.
4. RED/GREEN: route, host and native UI wiring for Calendar authorization/state/preparation; no install-time IO. Keep advanced Google MCP visibly separate.
5. Verify focused suites and inspect diff. Update source/proof boundaries, commit this branch, return SHA. Root owns full SDK matrix, integration, installation and release.

External final steps: product publisher registers its own Google Desktop OAuth application, enables Calendar API and appropriate testing/production consent settings; the user then explicitly authorizes their own Google account. Neither step is replaced by synthetic test success.

Implementation checkpoint: Calendar subset and focused synthetic integration implemented; no real publisher registration, account authorization, private read, native installation or phone confirmation. Root-owned REST adapter is included in this branch. Full SDK/release integration remains root responsibility.
