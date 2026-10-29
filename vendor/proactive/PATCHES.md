# DSH Dot maintenance patches

The upstream project is [john-walks-slow/dsh-proactive](https://github.com/john-walks-slow/dsh-proactive), npm 0.3.1. Copyright (c) 2026 dsh-proactive contributors. The original MIT license in `LICENSE` remains byte-for-byte unchanged. This local patch is maintained by 牛村木木山 / oxmumu3; it is not an upstream release or endorsement.

## Scheduler due boundary — 2026-10-29

File: `lib/scheduler.js`.

- Original npm SHA256: `5806724d6b959a568ff8edf35fe040a1a3bb0be10b1d3b34c18dce7fa041f12c`.
- Maintained runtime SHA256: `a30f3beec50e0b63ff4984331e140426452f2de2cce50557593667c1de3694db`.
- `SOURCE.json` retains every original file hash under `upstreamFiles`; `files` describes the shipped runtime and `localPatches` identifies this sole delta.

A deadline can pass between `drive()` selecting due alarms and `arm()` reading the clock. The original `due > now` filter then leaves the scheduled alarm with no timer. The patch lets `arm()` select that already-due alarm and schedules the next asynchronous timer callback with the existing nonnegative bounded delay. It does not call the wake inline or bypass `requestDrive`, `fireOne`, startup overdue/drop, quiet hours, busy/defer, cancellation, or the consuming adapter's authorization and lateness limits.

To reproduce the original failure, let the due-selection clock read deadline minus one millisecond and the arming clock read the deadline or deadline plus one millisecond. `test/proactive-scheduler-boundary.test.mjs` covers both, future deadlines, cancellation, startup drop, quiet hours, busy/defer, one-shot completion, non-firing/invalid alarms and the maximum timer bound. A local synthetic two-minute real-clock acceptance uses a temporary store with no Host, private sources, plans in the user's profile or external messages.

The runtime delta is the removal of `due > now &&` from the nearest-deadline selection, plus an explanatory comment. No other upstream runtime file is modified. License and original distribution provenance remain intact.
