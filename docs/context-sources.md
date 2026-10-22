# 连接邮箱、日历、云盘、笔记和清单

当前 `0.12.0-preview.3` 已在日常 App 安装，原生界面确认启用、一个组件运行，尚未公开发布；原微信绑定与 Google 三来源保留。本人完成两家授权后，本版已通过原生会话读取滴答两项清单及 flomo 两条关键词结果，再恢复两家在日常 Dot 的启用状态。滴答使用官方只读 Open API，保留 `tasks:read`，未扩大至 MCP 要求的写权限。Google 有限读取在升级前的 `preview.1` 完成，范围见下表。滴答任务正文、Drive 正文、非空日程、长期令牌刷新和新版手机展示仍待验。先登录，再启用要使用的来源，最后用自然语言查询；登录和状态刷新不会自动读取私人资料、写项目记忆或创建推送。仓库迁移仍待接收，公开入口未核验。

## 普通使用

1. 在「DSH Dot → 连接与设置」点击「连接 Google」，前往 Google 官方页面登录并同意只读权限。无需创建 Cloud 项目或填写 Token、Client ID、密钥。
2. 返回 Dot，授权状态会自动更新；如果关闭过页面，可以手动刷新。只同意部分权限时，页面只显示真正已获授权的来源。
3. 启用需要的 Gmail、日历、Drive。可以说「查未来 24 小时的安排」「搜索关于项目的邮件」「在云盘找季度计划」。首次启用只核对读取合同，真实查询成功才证明 API 可以读取。
4. 日历读取主日历，默认未来 24 小时、最多七天十项。邮件与文件搜索每次最多十项，不自动翻页；再明确选择想读的内容。文档与幻灯片取纯文本，表格读取指定范围，最多 200 行、26 列、2000 格。图片/PDF 等不支持的文件格式会明确说明，不能当作空文档。
5. flomo、滴答清单分别点官方登录；flomo 需要 MAX。本版已完成 flomo 两条关键词搜索及滴答两项清单的真实读取；滴答普通账号走只读 API，不增加原 MCP 要求的写权限。任务正文与其他操作的证据范围见验证记录。

Google 仍为 **External / Testing**，仅登记的测试账号可用；授权可能在七天后失效，需要重新登录。当前已登记账号为 experts@finvo.ai。未登记的公开新用户不能直接登录，它不是已面向任意读者开放的正式接入。

## 三件套权限与数据去向

普通连接申请三项只读 scope：`gmail.readonly`、`calendar.events.readonly`、`drive.readonly`。Docs/Sheets/Slides 的有限读取复用 Drive 权限，不另外申请写权限。Google 的 scope 范围比一次查询范围广，Dot 在代码里继续限制请求数量、文件/时间范围和只读操作。

目前连接后仅按需读取，没有私人资料持续扫描或主动订阅。项目日报与AI资讯日报不等于私人邮箱/清单监控。

用户授权令牌保存在自己的 Harness 原生 profile secret 配置中，没有 Dot 中央服务器集中代存；文件权限与隐藏表单不等同系统钥匙串加密。明确读取的结果会进入 Harness 会话，可能发给所配置的模型并进入宿主日志；通过微信回复还会经过微信通道。不能承诺所有资料永不离开电脑。`personal_context` 不自动写入长期项目记忆；但若会话所属项目已被关注，用户/助手摘要可被收为项目近期记录。连接启用关系只保存会话与凭据指纹，最近读取时间为进程内状态。

已保存的 Calendar-only 连接独立保留并优先使用，升级不会静默换成三件套账号。重新授权或更换微信绑定后需重新启用相应来源；同一连接自动刷新令牌不要求重新启用。存在三件套记录时，即使失效或缺少某项权限，也不会偷用旧 MCP 账号补读。

停用来源会中断当前待返回读取。清除本机授权和撤销 Google 账号里的 OAuth 许可是不同操作。外部材料只作资料，不作为新的操作指令。

## 当前证据

| 环节 | 已验证范围 |
| --- | --- |
| 独立项目 | 专用 dsh-dot，Desktop 客户端；没有复用 Finvo 既有生产配置。 |
| 日历真实授权 | 本人已在官方页面同意；生产 OAuth 控制器在独立官方 Web Host 保存成功。 |
| 日历真实读取 | primary 主日历，2026-10-22T07:50:17.056Z 至 2026-10-29T07:50:17.056Z，最多十项，返回零项。仅证明该窗口成功返回，不代表账号没有日程。 |
| 冷启动刷新 | 重启同一独立宿主后，无新同意即可读同一窗口。 |
| 日常 App | 0.12.0-preview.3 已通过官方安装器升级并重开，官方管理页显示启用、一组件运行。安装后七个状态文件字节不变，cordis/patch/workspace 配置、其他插件依赖及启用列表保留；Google 三来源保留，flomo/滴答已恢复日常 Dot 启用，微信已连接，零待触发提醒、项目日报关闭。实读后五个状态文件仍字节不变，项目仅更新观察记录与会话ID，Context租约按临时启停及恢复而变化，计划未变。 |
| 三件套新路径 | 本人在日常 App 完成三项只读同意。Gmail 搜索三封、读取一封限长正文；日历七天返回零项；Drive 搜索十个匹配项。Drive 文档正文、非空日程与手机展示仍未实测。 |
| flomo / 滴答 | 本人已完成两家官方登录。preview.3 原生 personal_context 实读：滴答 projects limit2 返回两项来源并有裁剪提示；flomo 搜索 DeepSeek limit2 返回两条、无裁剪提示。本轮仅一次会话、该工具，无微信发送或新计划；临时会话断开两来源后，原生页面恢复日常 Dot 启用。滴答仅验证清单元数据，任务正文未验；flomo 未读取 AI 画像。 |
| 公开可用 | Testing 状态未变，没有以本机测试代替公众授权审核或公开下载。 |

早期日历独立宿主使用明确 fixture owner，真实微信桥接禁用，未发微信或创建计划。其私有授权没有迁入日常 App；日常 App 已另外完成本人三件套登录。滴答任务正文、Drive 文档正文、非空事件呈现、长期令牌刷新、真实撤销/清除与手机展示仍分别待验；已验过一次日历冷启动刷新不等于长期可靠性通过。完整证据见[验证记录](verification.md)。

## 实现与官方协议

三件套与单独日历分别保存授权记录。均使用 Desktop public client、S256 PKCE、随机 127.0.0.1 回调、一次性 state/code、五分钟有效期、当前 owner/绑定/暂停检查及原生 revision CAS。刷新不扩大 scope。installed apps 不使用 incremental authorization 自动合并权限。

REST 只访问代码固定的 Google HTTPS 地址，拒绝重定向，设超时和响应字节上限，不跟随消息、文档里的链接。Gmail 搜索只读有限元数据，正文读取不下载附件、不执行 HTML；无可用纯文本时保留摘要并标注不完整。Drive 仅查标题与读取明确文件，Docs/Slides 通过纯文本导出，Sheets 通过指定 range 读取。取得令牌、发送请求和交付返回前都复查来源仍被启用。

一手来源（2026-10-22 核对）：[Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、[Gmail list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)、[Gmail get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)、[Drive get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get)、[Drive export](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export)、[Sheets values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get)、[Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)、[Google Testing 受众](https://support.google.com/cloud/answer/15549945)。

## Google 官方 remote MCP（高级兼容）

采用 Google 托管的 Streamable HTTP 服务，无需将社区 Google 服务端或作者的账户配置打包给用户：

| 来源 | 固定端点 | 首版只读工具示例 |
| --- | --- | --- |
| Gmail | `https://gmailmcp.googleapis.com/mcp/v1` | `search_threads`、`get_message` |
| Calendar（保留协议研究，当前普通入口不走此路） | `https://calendarmcp.googleapis.com/mcp/v1` | `list_events` |
| Drive | `https://drivemcp.googleapis.com/mcp/v1` | `search_files`、`read_file_content` |
| Docs | `https://docsmcp.googleapis.com/mcp/v1` | `read_doc` |
| Sheets | `https://sheetsmcp.googleapis.com/mcp/v1` | `get_values` |
| Slides | `https://slidesmcp.googleapis.com/mcp/v1` | `read_presentation` |

官方仍将这些服务标为 Developer Preview。用户需要加入 Google Workspace Developer Preview Program，有自己的 Google Cloud 项目并启用产品 API 和 MCP API。OAuth 客户端需要勾选 `Use this client for an AI-powered agent`。这不是装完 Dot 就自动完成的 Google 授权。

官方 Gemini CLI 教程创建 Desktop app OAuth client；Claude 与 Antigravity 示例使用各自回调 URL 的 Web application client。Dot 必须使用为自身配置的客户端和用户同意流程，不能复用作者的 Codex、Gemini、Chrome、gws 或其他客户端凭据。产品 OAuth 与 Google 模型订阅 OAuth 也不是同一件事。

旧高级 Google 授权页仍一次申请以下七个只读 scope（普通三件套仅申请前文的三项，不使用旧记录）；实际来源仍须逐项启用，不代表允许扫描整个账号：

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

- 滴答普通 OAuth 从 preview.3 起使用[官方 Open API](https://developer.dida365.com/docs/openapi.md)的只读 GET，已用现有 tasks:read 在实际安装版读取两项清单。旧手填 Token 的官方 MCP 固定使用 `https://mcp.dida365.com`，不猜测或追加 `/mcp` 路径。[官方 OAuth metadata](https://dida365.com/.well-known/oauth-authorization-server) 发布动态客户端注册与 S256 PKCE；[MCP 资源 metadata](https://mcp.dida365.com/.well-known/oauth-protected-resource)发布 `tasks:read` 与 `tasks:write`，Dot 只申请 `tasks:read`。[官方 Open API 授权文档](https://developer.dida365.com/docs/index.html#/openapi?id=authorization)也说明账号同意流程与上述权限。metadata 仅声明 `authorization_code`，因此 Dot 不猜测滴答支持刷新授权，过期后需重新连接。
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

Google 普通连接与滴答普通 OAuth 走固定官方只读 REST；flomo、手填滴答 Token 及旧 Google 高级兼容走固定官方 MCP。所有来源都经过 exact-name 白名单、有界输入、owner/绑定/启用状态检查；资料内容不能改变工具权限。

三件套的合成测试覆盖部分授权、无 scope、拒绝后重试、一次性回调、并发 CAS、刷新、暂停/换绑/关闭，以及 Gmail/Drive/Sheets 读取的超时、字节与条数边界。这些合成测试只验证代码控制流。本人另已完成 Gmail/日历/Drive 真实同意、邮件搜索及限长正文、日历空窗口、云盘文件名搜索；日历独立宿主也完成过冷启动刷新。Drive正文、非空日历与公众账号接入未由此证明，具体范围见上表。

## 可选复用路线与许可证

未将以下项目代码加入传输层：

- [googleworkspace/cli v0.22.5](https://github.com/googleworkspace/cli/releases/tag/v0.22.5)，Apache-2.0。统一 Workspace CLI，但 README 明确非受官方支持的 Google 产品；仍需自有 GCP client。若后续启用，必须隔离配置目录及环境，不能继承作者的 gws 凭据或当前项目 `.env`。
- [taylorwilsdon/google_workspace_mcp v2.1.0](https://github.com/taylorwilsdon/google_workspace_mcp/releases/tag/v2.1.0)，MIT。支持只读与 OAuth，但会增加 Python 服务，且同样需要自己的 OAuth client。
- [PerryLink/dsh-ticktick](https://github.com/PerryLink/dsh-ticktick/tree/6c922556e66e9bd235a266ad82fef352b3f6339a)，Apache-2.0。参考了其公开协议接入方向，没有复制实现。当前 Dot 的 JSON/SSE 和会话实现为独立编写。

官方文档链接是协议与服务出处，不表示本项目为官方插件、获得平台背书或取得第三方代码的版权。

### 滴答普通登录的读取范围

普通 OAuth 使用官方 Open API，保留 `tasks:read`。清单只取首批（最多10项），指定单个清单后读取其中任务（最多展示10条，响应上限1MiB），或者指定清单和任务读取一条。暂不支持跨全账号关键词搜索，不自动翻页或扫描其他清单。手填旧 token 的高级 MCP 路径保留；普通 OAuth 失败不会改用它。
