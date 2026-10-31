# Logical projects and workspace access — approved implementation contract

The user approved the integrated prototype and desktop screenshots on 2026-10-30 and explicitly said to implement. Visual source: /Users/shan/Library/Mobile Documents/com~apple~CloudDocs/Agent/output/dsh-dot-ux-reset-2026-10-30/prototype.html (SHA256 226cfde561d9d03730e454ad1645437220364deeb58edba1731fb6f60f6a3983). Keep QR-first, desktop natural conversation, four tabs, blue global Dot launcher. Do not introduce a new design approval gate.

## Objects and authority

A logical project is a persistent objective shared across conversations/workspaces. A workspace is a registered local folder; a session is discussion/execution; source fragments can be associated independently. Never relabel all folders as business projects. New associations are proposed until kept; ignored suggestions stay ignored. Existing confirmed vision cannot be rewritten by a model.

New profile-owned domains: project_companion_workspace_access and project_companion_goals. Existing Dot/Family/context/news/permissions/plans remain unchanged. Access begins empty; do not inherit recent-session history permission from legacy watch or select all. Desktop metadata selection works before WeChat pairing. Only the host-authenticated native connection route exposes changes; no Family member or model tool can grant workspace access.

Access records bind public catalog ID + actual workspace ID + exact canonical registered root. Changing/removing/replacing a workspace invalidates the old content grant. New registrations are not auto-granted. Saving selections reads no contents or models, starts no schedules and does not widen existing follow-up ranges. Revoke or root change invalidates in-flight collection/model commit, hides unavailable evidence and marks derived progress stale; saved confirmed goals/history are retained.

## HTTP contracts (POST JSON, no-store, bounded bodies, no arbitrary paths)

/api/project_companion/workspaces:
- {action:'list',query?,offset?,limit?,expectedCatalogRevision?} returns {version:1,revision:string,catalogRevision:string,total:number,matchedTotal:number,offset:number,limit:number,hasMore:boolean,nextOffset:number|null,items:[{id,label,sessionCount,selected,available:true,disambiguator?}],selectedIds:string[],selectedCount:number}. Pagination is complete metadata, no global 100-item truncation.
- {action:'save',expectedRevision:string,expectedCatalogRevision:string,workspaceIds:string[]} validates every selected ID against the current registry, atomically replaces only this new access scope, then returns the list shape. Stale revisions fail 409, with no writes.

/api/project_companion/goals:
- {action:'status'} returns {version:1,revision:string,accessRevision:string|null,projects:[Project],scan:Scan,standaloneCount:number,uncertainCount:number}.
- {action:'detail',projectId} adds evidence:[Evidence], conversation:{sessionId,revision}|null to the project response.
- {action:'recognize',expectedRevision,expectedAccessRevision} explicitly starts ONE bounded analysis, returns status immediately (scan.phase='running'). The service owns the promise; status polling does not restart it. Concurrent starts coalesce; no automatic retry after failures/restart.
- {action:'accept'|'ignore',projectId,expectedRevision}, {action:'correct',projectId,evidenceId,targetProjectId:string|null,expectedRevision}, {action:'vision',projectId,title,goal,constraints:string[],expectedRevision}. All are serialized, revision-checked and persistent. Correction or revoked sources invalidates old progress.
- {action:'conversation',projectId,expectedRevision} returns {version:1,projectId,conversation:{sessionId,revision:'native:'+sessionId}}. Only explicit click creates a dedicated native conversation, reused per logical project. Never steals the global Dot conversation or a historical user's session. Native input, approval and attachment chain are retained; creating/bringing a draft does not send it.

Project={id,title,goal,constraints:string[],state:'proposed'|'confirmed',lane:'mine'|'active'|'waiting'|'unknown',progress:string|null,nextStep:string|null,evidenceCount:number,sessionCount:number,workspaceCount:number,stale:boolean,updatedAt:string}. Omit ignored projects from visible lists. Model suggestions and source claims are not independently verified business completion.
Scan={phase:'idle'|'running'|'complete'|'failed',at:string|null,coverage:[{workspaceId,label,status:'ok'|'partial'|'unavailable',filesRead:number,sessionsRead:number,truncated:boolean}],code?:string}. No fake percentages or unavailable-as-empty.
Evidence={id,workspaceId,workspaceLabel,sessionId:string|null,kind:'file'|'user'|'assistant',reference,text,at:string|null,truncated:boolean,available:boolean}. Revoked evidence contains no text. Only selected source snippets enter the model; credentials are filtered.

## Dependency contracts for independent implementation

createWorkspaceAccess({store,catalog,clock,isClosed}) exports list(args),save(args),capture(),assertCurrent(snapshot),authorizeSync(snapshot),close(). capture() returns {revision,grants:[{id,workspaceId,root,label,sessionIds}]}; assertCurrent throws if revision or identity/root membership changes. list/save include public paginated metadata only. Store uses get('profile')/put('profile',row).

createGoalBoard({store,access,collect,model,clock,createId,isClosed}) exports status(),detail({projectId}),startRecognition({expectedRevision,expectedAccessRevision,signal?}),accept(args),ignore(args),correct(args),vision(args),conversation(args,{create,verify}),getContextForSession(sessionId),close(),waitForIdle(). Export goalBoardRowSchema for official storage. Board revision is opaque string. Provider collect(snapshot,{signal}) returns {fragments,coverage}, with at most 40 fragments, each at most 3000 chars. Each fragment {id,workspaceId,workspaceLabel,sessionId:null|string,kind,reference,text,at:null|string,truncated}. The main adapter reads only fixed project files and bounded recent ordinary native session records, without activating/cold-resuming agents. No Family/subagent session content.

createGoalBoardModel(ctx) exports recognize({fragments,existingProjects,signal,guard,authorizeSync}),close(). Reuse runNewsModel and the configured native default model; no new key/account/provider. Return validated {groups:[{key,projectId:null|string,title,goal,evidenceIds:string[],lane,progress:null|string,nextStep:null|string}],standaloneIds,uncertainIds}. Enforce exact known source partition, canonical confirmed vision, limited output, no tool calls. New objective needs at least two distinct conversations OR user-created confirmed vision; files alone may add context but must not make invented projects. Existing source association corrections have final authority. Progress is source-derived, never an execution or acceptance proof.

## Desktop UI implementation

First-use home has QR + workspace CTA + usable native global input. Connections has workspace chips/count and same management dialog. Search/pagination preserve all selected IDs across pages; apply sends all selected IDs once, cancellation makes no request. Show exact added/removed delta; do not call recognize as a side effect of grant. After selection, expose one clear '整理这些工作区的项目' action on Projects.

Projects renders three lanes 待我推进 / 推进中 / 等回复／确认, objective/progress/next step, and blue proposed cards. Clicking opens a visible side sheet with objective, constraints, progress, evidence and a native per-project conversation. Uncertain/no-data states explain next action. Do not silently fill an off-screen global composer. Drafts/attachments survive switching surfaces using the existing native controller and one active editable conversation instance. Network failures preserve scope selection and drafts. No synthetic sample cards, fake replies or production data generated on install.

## Verification and delivery

TDD for scope default-empty/persistence/CAS/search>100/reassignment/revocation races, known-source model result validation, stable project IDs/corrections/ignored grouping, native dedicated conversation reuse and no send. UI tests include cancel, incremental selection, stale network, side-sheet focus and draft retention. Use synthetic files/sessions/accounts only in tests. Run relevant regressions across the three official SDK carriers; exact official Host and desktop UI before safe daily upgrade. New domains remain empty in daily until the user chooses; never impersonate this choice. Preserve all original bindings/accounts/family permissions/plans/other plugins. No public release or GitHub push. Existing natural diagnosis/Google review remain independent.
