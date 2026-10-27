# Personal context to project outcome

User approved implementation on 2026-10-26: reuse existing components, connect personal context, briefs, WeChat delegation and proactive follow-up; phone testing follows computer-side completion.

## Outcome

One user-selected project and objective, with explicitly bounded source queries, produces a sourced numbered brief. The user can refer to an item naturally and request work. Its durable identity points to the existing native task-results ledger. Later checks compare actual content and execution state; unchanged information stays quiet. Suggestions never become authoritative TickTick task status.

## Existing components to reuse

- PersonalContext query, provider contracts and credential guards (no new connector).
- ProjectUpdateModel summary validation (no new model runtime).
- Coordinator and TaskResults admission, result delivery and passive inspection (no second outbox).
- ProjectFollowup ProactiveStore/Scheduler/WakeDriver (no new scheduler).
- Current WeChat bridge 0.11.1-dot.2. Upstream 0.13.3 compatibility and admission changes remain a separate audit.

## Implementation

1. Add durable context authorization grant fingerprints; reconnect must invalidate an old follow-up grant.
2. Add bounded context-loop storage, citations, revisions, stable item identities and item-to-job association. Save excerpts/summaries only, never tokens or full source responses.
3. Expose the existing taskResults jobId from coordinator admission; repeated item requests use a durable idempotency key.
4. Add one scoped context_check action to the existing follow-up guard, prompt and successful-read watermark. Only the saved manifest can be read autonomously.
5. Integrate natural-language tools and existing workbench drafts. Keep UI navigation unchanged. No automatic account scanning at connection, no automatic handoff from a source instruction.
6. Test synthetic end-to-end flow, partial source failure, source revocation/reconnect, stale item revision, duplicate handoff, cancellation and no-change silence. Run supported SDK checks and independent review.

## Acceptance boundary

No private source read, real schedule or WeChat message is needed for development. Current daily installation, account bindings and external public assets remain untouched. Produce an installable local candidate after validation; record phone receipt/rendering and genuine mixed-source usefulness as pending later user testing.
