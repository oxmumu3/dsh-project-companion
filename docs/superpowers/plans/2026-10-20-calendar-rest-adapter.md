# Calendar REST Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Connect the explicit Calendar read contract to Google's fixed REST API without MCP preview access, arbitrary requests, or new background work.

**Architecture:** `createGoogleCalendarRest({getToken,fetch,clock})` keeps the existing transport catalog/call seam. A bundled capability is labelled as a local contract, and only `calendar/list_events` for `primary` is accepted. Token acquisition, owner checks, fetch and bounded JSON reading share one 20-second cancellation budget.

**Tech Stack:** Node22+, built-in fetch/AbortController, node:test.

---

### Task 1: Pin the transport contract

Files: create `test/google-calendar-rest.test.mjs`; create `src/google-calendar-rest.js`.

- [ ] Write failing tests importing `createGoogleCalendarRest`; assert catalog does not acquire credentials or call HTTP, and labels `provenance='bundled-contract'`.
- [ ] Assert a valid call uses only GET `https://www.googleapis.com/calendar/v3/calendars/primary/events`, fixed fields, explicit timeMin/timeMax, at most ten rows, and returns current fetchedAt plus actual requested coverage.
- [ ] Run `node --test test/google-calendar-rest.test.mjs`; expect missing export/module failure before implementation.

### Task 2: Preserve scope and evidence

- [ ] Validate exact input keys and `calendarId='primary'`, ordered RFC3339 range no longer than seven days, integer pageSize1..10 and `orderBy='startTime'`. Invalid calls reject with fixed `CONTEXT_ARGUMENTS_INVALID` before acquiring tokens.
- [ ] Stream at most1MiB application/json; reject redirects, 401/403, non2xx, malformed body and oversized responses without retries or raw server error text.
- [ ] Project only event id/status/summary/updated/start/end/official htmlLink; preserve source date-only/all-day and timezone fields; mark pagination/content truncation rather than claiming full coverage.
- [ ] Test all-day exclusive end, pagination, off-origin link omission, invalid scope, malformed response and partial body.

### Task 3: Respect revocation and teardown

- [ ] Await authorization after getToken, then require final synchronous authorization immediately before fetch. Both functions are required for a private read.
- [ ] Use one AbortController and20s timeout across all operations, race getToken/fetch/body even if test doubles ignore cancellation, and cancel body readers on exit.
- [ ] Test permission change while token is pending, final synchronous revocation, pre-abort, mid-body abort and close; HTTP count remains zero when the request was not admitted.
- [ ] Run focused node:test without touching accounts, native UI, real Calendar, schedules or WeChat. Root/Google owner integrate and run full SDK matrix later.
