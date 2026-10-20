# Context 来源与验证边界

Dot 将用户明确连接的来源作为按需、只读材料。连接不代表已读取，测试连接不代表已完整覆盖账号，材料里的文字也不构成执行授权。此页记录 2026-10-19 核对的一手来源；工具实际可用性仍以用户独立授权后的 `tools/list` 与真实读取为准。

## 怎么连接和使用

1. 打开 Harness 设置 → DeepSeek Dot，在资料来源点「登录 flomo」或「登录滴答清单」，打开官方账号授权页。用自己的账号登录并同意授权；无需创建、复制或粘贴 Token。flomo MCP 仍需 MAX 会员。
2. 授权页面回到本机后，返回 Dot 刷新连接状态。逐项点击要使用的来源「启用读取」，或在对应会话明确要求启用。此步验证工具目录，不读取私人正文，也不创建扫描计划。
3. Google 当前仍是开发者接入：需满足下述官方预览条件，再在高级配置填写自己的 Desktop OAuth Client ID 与 Client Secret 并完成 Google 授权。旧版个人 Token 也仅保留为高级兼容配置，不是 flomo、滴答的默认连接方式。
4. 回到原微信对话自然提问，例如「搜 flomo 中关于插件生态的笔记」「查看未来 24 小时 Google 日历」「先列滴答项目，再查看这个项目未完成任务」。首次没有返回资料、授权不足或工具字段不兼容时，会明确失败，不改用写工具。
5. Docs、Sheets、Slides 正文读取需指定资源 ID；Sheets 还需明确有界范围，例如 `A1:F30`。Drive、Gmail 搜索先返回有限资料，再由你明确选择全文。来源输出会保留资源 ID、更新时间、读取时间、官方链接和截断状态。

Gmail、Drive 和 flomo 可按同一个明确搜索词汇总；日历和滴答项目可以不带搜索词汇总。最多四个来源，每源有限条目；需要各自不同范围时分别查询，接口不支持的限定条件会拒绝，不静默忽略。日历时间范围默认未来 24 小时、最多 7 天；flomo 单次最多 5 条、其他来源最多 10 条；Sheets 最多 200 行、26 列、2000 格。当前不自动把私人来源塞入项目日报，不把正文写进项目记忆，也不修改任务、邮件、文档或笔记。

启用绑定原对话、原微信连接和当前账号；更换账号、重新授权或绑定后需重新启用。flomo 自动刷新同一连接的令牌不会改变原有启用状态。停用立即中断待返回读取；停用来源不会替你撤销服务商的 OAuth 许可，彻底撤销需到服务商授权页操作。凭据由 Harness 原生 profile 配置保存，秘密表单遮蔽和文件权限不等同系统钥匙串加密。读取结果会进入当前宿主会话，并可能发给你配置的模型；模型与日志保留由宿主配置决定。

## Google 官方 remote MCP

采用 Google 托管的 Streamable HTTP 服务，无需将社区 Google 服务端或作者的账户配置打包给用户：

| 来源 | 固定端点 | 首版只读工具示例 |
| --- | --- | --- |
| Gmail | `https://gmailmcp.googleapis.com/mcp/v1` | `search_threads`、`get_message` |
| Calendar | `https://calendarmcp.googleapis.com/mcp/v1` | `list_events` |
| Drive | `https://drivemcp.googleapis.com/mcp/v1` | `search_files`、`read_file_content` |
| Docs | `https://docsmcp.googleapis.com/mcp/v1` | `read_doc` |
| Sheets | `https://sheetsmcp.googleapis.com/mcp/v1` | `get_values` |
| Slides | `https://slidesmcp.googleapis.com/mcp/v1` | `read_presentation` |

官方仍将这些服务标为 Developer Preview。用户需要加入 Google Workspace Developer Preview Program，有自己的 Google Cloud 项目并启用产品 API 和 MCP API。OAuth 客户端需要勾选 `Use this client for an AI-powered agent`。这不是装完 Dot 就自动完成的 Google 授权。

官方 Gemini CLI 教程创建 Desktop app OAuth client；Claude 与 Antigravity 示例使用各自回调 URL 的 Web application client。Dot 必须使用为自身配置的客户端和用户同意流程，不能复用作者的 Codex、Gemini、Chrome、gws 或其他客户端凭据。产品 OAuth 与 Google 模型订阅 OAuth 也不是同一件事。

Google 授权页一次申请以下七个只读 scope；实际来源仍须逐项启用，不代表允许扫描整个账号：

- Gmail：`https://www.googleapis.com/auth/gmail.readonly`
- Calendar：`https://www.googleapis.com/auth/calendar.calendarlist.readonly` 与 `https://www.googleapis.com/auth/calendar.events.readonly`
- Drive：`https://www.googleapis.com/auth/drive.readonly`
- Docs：`https://www.googleapis.com/auth/documents.readonly`
- Sheets：`https://www.googleapis.com/auth/spreadsheets.readonly`
- Slides：`https://www.googleapis.com/auth/presentations.readonly`

官方配置教程同时展示读写功能，不应把其中的 `gmail.compose`、`drive.file` 或文档写权限直接加入只读版本。读取共享日历需要日历列表 scope；只读到主日历不能声明覆盖了所有日历。

Google 刷新授权要求 `access_type=offline`，已同意的用户重新取得 refresh token 还可能需要 `prompt=consent`。公有 OAuth metadata 支持 S256 PKCE，没有发布可发现的动态客户端注册端点。`gmailmcp.googleapis.com/.well-known/oauth-protected-resource/mcp/v1` 的 metadata 可公开读取；这不代表任何私人邮箱已经连接。

字段须遵循 MCP 版本，不能套用原 REST API 参数：

- `search_threads` 使用 `query/pageSize/pageToken/includeTrash/view`，返回 `threads[].messages[]`；Message 正文是 `plaintextBody`，不是 REST 的 `payload.body.data`。
- `list_events` 使用 `startTime/endTime/timeZone/calendarId/pageSize`；不是 REST 的 `timeMin/timeMax`。
- `search_files` 的查询字段使用 `title`；返回文件的 `title/viewUrl/contentSnippet`。
- `read_file_content` 返回 `fileContent` 和 `textFormattingNotSupported`，不支持转文本不能当作空文档。
- `read_doc` 使用 `documentId/commentsIncluded`，返回 `content` 对象。
- `get_values` 使用 `spreadsheetId/range`。
- `read_presentation` 使用 `presentationId/fields/commentsIncluded`，返回 `content` 对象。`fields` 应限定必要字段，例如 `title` 与 `slides.pageElements(objectId,shape.text)`。

一手说明与 schema：

- [配置 Google Workspace MCP](https://developers.google.com/workspace/guides/configure-mcp-servers)
- [Gemini CLI 官方 codelab](https://codelabs.developers.google.com/google-workspace-mcp-gemini-cli)
- [Gmail search_threads](https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/search_threads)
- [Gmail get_message](https://developers.google.com/workspace/gmail/api/reference/mcp/tools_list/get_message)
- [Calendar list_events](https://developers.google.com/workspace/calendar/api/v3/reference/mcp/tools_list/list_events)
- [Calendar list_calendars](https://developers.google.com/workspace/calendar/api/v3/reference/mcp/tools_list/list_calendars)
- [Drive search_files](https://developers.google.com/workspace/drive/api/reference/mcp/tools_list/search_files)
- [Drive read_file_content](https://developers.google.com/workspace/drive/api/reference/mcp/tools_list/read_file_content)
- [Docs read_doc](https://developers.google.com/workspace/docs/api/reference/mcp/tools_list/read_doc)
- [Sheets get_values](https://developers.google.com/workspace/sheets/api/reference/mcp/tools_list/get_values)
- [Slides read_presentation](https://developers.google.com/workspace/slides/api/reference/mcp/tools_list/read_presentation)

## 滴答与 flomo

- 滴答官方 MCP 固定使用 `https://mcp.dida365.com`，不猜测或追加 `/mcp` 路径。[官方 OAuth metadata](https://dida365.com/.well-known/oauth-authorization-server) 发布动态客户端注册与 S256 PKCE；[MCP 资源 metadata](https://mcp.dida365.com/.well-known/oauth-protected-resource)发布 `tasks:read` 与 `tasks:write`，Dot 只申请 `tasks:read`。[官方 Open API 授权文档](https://developer.dida365.com/docs/index.html#/openapi?id=authorization)也说明账号同意流程与上述权限。metadata 仅声明 `authorization_code`，因此 Dot 不猜测滴答支持刷新授权，过期后需重新连接。
- flomo 官方端点为 `https://flomoapp.com/mcp`。[官方自动授权教程](https://help.flomoapp.com/advance/mcp/connect-chatgpt-web.html)明确支持 OAuth 且无需个人 Token；[官方 OAuth metadata](https://flomoapp.com/.well-known/oauth-authorization-server)发布动态客户端注册、S256 PKCE 和刷新授权；[MCP 资源 metadata](https://flomoapp.com/.well-known/oauth-protected-resource)发布 `mcp` scope。flomo 当前没有公开更细的只读 OAuth scope，因此 Dot 的只读边界由下述工具白名单继续强制执行，不把账号授权范围描述成服务端只读许可。仍需 flomo MAX。
- 默认连接由用户点击后才注册此客户端、生成一次性授权链接，再由用户亲自在官方页面登录与同意。Dot 不接收账号密码，不复用作者或其他客户端的令牌；页面挂载和状态刷新不会注册客户端、开始登录或查询账号。
- 本机回调仅绑定 `127.0.0.1` 随机端口，授权有效期五分钟；校验原始 Host、回调路径、单值 state、可选 issuer 与 PKCE，授权码只交换一次。固定官方 HTTPS 端点拒绝重定向；HTTP、响应体与关闭取消均有上限。配置变化后的旧回调与旧刷新响应不能保存；关闭会中断请求并关闭回调监听。
- 授权流程绑定开始时的原对话、微信绑定和暂停状态，在注册、换码、保存及原生写入前重新验证。凭据写入同时核对原 OAuth 字段、兼容 Token 字段与原生配置 revision；授权期间清空、更换凭据不会被迟到回调覆盖；已换绑后到达的回调会被拒绝。原绑定检查以派发原生保存请求为界，不能原子撤销已进入其他插件事务的操作。刷新授权也使用相同的配置比较与当前来源授权检查。
- OAuth 凭据保存在本插件的原生 secret 配置中，连接状态仅返回布尔值和授权链接失效时间。flomo 刷新令牌轮换会保存新值；滴答仅保存有界访问令牌。服务端未提供过期秒数时，Dot 最多复用一小时；令牌不会因缺少到期字段无限期有效。
- 个人 Token 仍可按[官方 Token 教程](https://help.flomoapp.com/advance/mcp/token.html)作为高级兼容方式使用。存在 OAuth 凭据时，授权失效会明确要求重新连接，不悄悄回退到另一个账号的 Token。清除本机凭据与撤销服务商许可是两项操作；flomo 可在「设置 → MCP / API → MCP → OAuth 授权模式 → 应用列表」断开。
- 这两个端点都可能发布写工具。连接后也必须 exact-name 白名单与输入校验，不能因为工具描述声称只读就执行，不能在找不到工具时回退至第一项工具。
- flomo 搜索摘要与全文读取有不同截断边界；读取结果需要保留 `content_truncated/omitted_ids/truncated` 等标记。
- 不默认调用外部 AI 画像工具；来源内容不会自动升级为个人稳定事实或项目记忆。

## 传输层与当前验证范围

`src/context-transport.js` 是独立编写的有界 MCP 薄传输层，无新增依赖，没有复制社区连接器代码。

- 固定来源与 HTTPS 端点，只发送协议规定的 POST；不接受聊天提供的 URL、认证 header 或 HTTP method。
- 每个来源串行处理，首次执行 `initialize → notifications/initialized`；会话 ID 仅留在传输对象私有内存，关闭时清空。
- 每次 HTTP 重新从秘密配置适配层取得 Token；凭据变化重置会话，流程中变化即拒绝，不自动重试。
- 固定 MCP `2025-03-26` 协议，严格核对 JSON-RPC request ID；接受 JSON 或 SSE，响应累计上限 1 MiB，工具目录最多 3 页、每页 200 项。
- 完整操作含等待、授权读取与响应解码的总预算 20 秒，支持取消及插件关闭。不会建立订阅或新的常驻进程。
- 拒绝重定向；错误只返回固定 code/message，不回传服务器原始错误正文、Token 或会话 ID。
- 忽略服务器通知与初始化说明，目录只投影 `name/inputSchema`。真正的业务调用仍须经过 Dot 的只读合同白名单和输出投影。

合成测试覆盖协议协商、流式响应、分页上限、错误脱敏、取消、总超时、凭据切换和同来源排队；账号授权还覆盖按点击注册、PKCE、本机回调、重复授权码、到期、保存失败、配置轮换、刷新轮换及连接身份稳定性。2026-10-19 实际核对了上述公开文档和 metadata，并对两源各做一次公开 DCR 注册：flomo 返回201，滴答返回200，均生成本机回调及S256授权链接后立即关闭监听；未登录账号、同意授权、交换令牌或读取私人材料。滴答注册响应的scope与申请值不一致，授权链接仍仅申请tasks:read，最终同意及令牌权限尚待本人登录验证。公开 metadata 或未授权 HTTP 401 仅验证端点存在和鉴权边界，不能冒充用户已授权、私人材料已读或微信已送达。

## 可选复用路线与许可证

未将以下项目代码加入传输层：

- [googleworkspace/cli v0.22.5](https://github.com/googleworkspace/cli/releases/tag/v0.22.5)，Apache-2.0。统一 Workspace CLI，但 README 明确非受官方支持的 Google 产品；仍需自有 GCP client。若后续启用，必须隔离配置目录及环境，不能继承作者的 gws 凭据或当前项目 `.env`。
- [taylorwilsdon/google_workspace_mcp v2.1.0](https://github.com/taylorwilsdon/google_workspace_mcp/releases/tag/v2.1.0)，MIT。支持只读与 OAuth，但会增加 Python 服务，且同样需要自己的 OAuth client。
- [PerryLink/dsh-ticktick](https://github.com/PerryLink/dsh-ticktick/tree/6c922556e66e9bd235a266ad82fef352b3f6339a)，Apache-2.0。参考了其公开协议接入方向，没有复制实现。当前 Dot 的 JSON/SSE 和会话实现为独立编写。

官方文档链接是协议与服务出处，不表示本项目为官方插件、获得平台背书或取得第三方代码的版权。
