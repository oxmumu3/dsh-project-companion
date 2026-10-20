# Google 普通用户授权与只读 REST 接入提案

状态：**内部设计快照。Calendar 子集已在 `feat/google-consumer-calendar` 实现并做合成验证；其余分期仍是提案，产品方 Google 应用尚未注册，不能作为普通用户已可登录功能发布。**

日期：2026-10-20（America/Mexico_City）。工作树：`dsh-dot-experience`。本文件只设计下一步 Google 接入，不改当前微信修复、包审计和安装优先级；没有登录 Google、复制既有客户端配置、读取私人资料或建立云服务。

## 目标与首个可验收闭环

让用户点击「连接 Google 日历」，在 Google 官方页面选择自己的账号并同意，然后返回 Dot，以自然语言读取主日历未来 24 小时的有界安排。普通用户不再自己创建 Cloud 项目或粘贴 Client ID / Secret。

首个自用试点只包含 Calendar REST、主日历、按需只读。OAuth 应用由产品方注册，使用系统浏览器、PKCE 和本机 loopback 回调，不增加代理服务器或 SaaS。代码与合成验证可以自主推进；产品方 Cloud 注册和本人账号同意是尚需完成的真实外部步骤，不得用测试记录替代。

首轮完成条件：

- 原生设置能进入真实的 Google 登录与授权，首次只申请 Calendar 对应权限。
- 回调后保存本插件自己的凭据；重启可恢复，换账号、清空配置、换绑、暂停及关闭时都按当前权限停止。
- 用户明确问安排后，只请求选定日历和时间范围，返回时间、来源链接和截断状态。
- 能在电脑端真实读到用户同意的少量材料；微信送达与显示另由用户本人确认。安装通过、授权成功、API 读取和手机收到分别记录。
- 安装、刷新状态、登录成功均不自动读取日历、不创建定时计划，也不自动写项目记忆。

## 当前缺口与路线选择

现有 `src/context-google-auth.js` 已有 Google 浏览器授权、S256 PKCE、随机本机端口、换码和 refresh token 保存。缺口是产品方默认 OAuth 应用与普通用户接入路径：Config 默认 Client ID / Secret 为空，Google 按钮因此禁用；当前授权还一次申请七项 scope，换码校验要求全部七项。

另有需在新路线一起修正的边界：旧 Google `start()` 不使用设置路由传入的 `authorizeMutation`，旧 refresh token 保存不经过 flomo / 滴答已有的原生 revision CAS writer。新路线必须复用已有权限门禁、绑定检查与凭据写入协议，不能只替换按钮文字。

| 方案 | 取舍 | 本提案决定 |
| --- | --- | --- |
| 产品方 Desktop OAuth + 常规只读 REST | 无新服务，去掉 Workspace MCP 预览资格；需产品方注册应用和 REST 字段适配 | 首选，先 Calendar 自用试点 |
| 继续 Google 官方 remote MCP | 能复用现有协议适配，但仍受 MCP Developer Preview、启用 MCP 服务等条件限制 | 仅保留明确的高级兼容入口，不自动回退 |
| Web-server OAuth + 后端 | 可使用 Web 应用支持的授权方式；新增服务器、私密 Web client secret、运维和数据责任 | 当前不做 |

Google 官方 installed-app 文档明确不支持 incremental authorization。因此这里的「按服务连接」指独立服务授权记录及明确重新授权，**不使用 `include_granted_scopes` 自动拼接已授予权限，不承诺六种授权可透明合并**。实际 Google 同意页可能显示此前的授权；以本次令牌的实际 scope 和本地读取合同共同限制行为。

## 权限与分期

所有 scope 以下均省略前缀 `https://www.googleapis.com/auth/`。每个服务具有独立连接槽，不把日历用户强制绑到 Gmail 或全盘 Drive 权限。

| 服务 / 授权档位 | 请求的完整后缀集合 | 首次操作与边界 | 官方敏感分类证据 |
| --- | --- | --- | --- |
| Calendar `primary-events` | `calendar.events.readonly` | 仅 `primary` 的未来 24 小时事件 | Calendar 文档确认 scope；该说明页未标分类，发布前在 Google Auth Platform 核实审批要求 |
| Calendar `calendar-selection` | `calendar.events.readonly`、`calendar.calendarlist.readonly` | 用户明确要选择其他日历时，重新请求此完整档位，之后方可列日历 | 同上；不把主日历结果当全部日历 |
| Docs `document-read` | `documents.readonly` | 用户指定或在已获准结果中选定文档 ID 后读取 | Docs 官方表列为 Sensitive |
| Sheets `spreadsheet-read` | `spreadsheets.readonly` | 明确表格及 A1 范围，沿用当前 200 行 / 26 列 / 2000 格上限 | Sheets 官方表列为 Sensitive |
| Slides `presentation-read` | `presentations.readonly` | 明确演示 ID，仅取有界文字与必要结构 | Slides 官方表列为 Sensitive |
| Drive `drive-read` | `drive.readonly` | 后续可选：标题检索与明确文件读取，初版不请求 | Drive 官方表列为 Restricted |
| Gmail `mail-read` | `gmail.readonly` | 最后可选：明确查询及选择邮件，不默认扫描收件箱 | Gmail 官方表列为 Restricted |

顺序：Calendar 主日历 → 可选 Docs / Sheets / Slides 按资源读取 → 按需求评估全盘 Drive → 可选 Gmail。Docs 等可直接按用户提供的 Google 文档链接提取 ID，不要求先取得全盘 Drive 权限。

`drive.file` 是 Google 推荐的非敏感、用户选定文件路线，但它的服务端权限含编辑。若以后选择它，须另做 Google Picker / 文件选择体验，并说明「令牌权限不等于插件只读合同」；本试点不为省审核而偷偷改成这个权限，也不将它宣传为只读 OAuth。

Restricted scope 不等于所有场景都必须同一套审核。公开分发、个人测试、是否保存或传输受限数据的适用要求不同；Drive / Gmail 进入开发前需按官方分类和实际数据路径核对。当前结果会进入用户配置的 Harness 模型与会话日志，不能把「没有新增服务器」表述成「数据绝不离开电脑」。

## 产品方注册与凭据隔离

产品方自己的 OAuth client registration 与作者的 Google 用户登录令牌不是同一种东西。普通用户应共用本产品注册的应用身份，再分别同意并获得自己的令牌；不能复制 Codex、Gemini、gws 或其他产品的 client / 用户凭据来冒充本产品。

Google 官方将 Desktop app 视为 public client，不能依赖客户端保密，必须使用 PKCE。产品方发布的 Desktop 客户端配置可以按该类型的协议要求分发；若凭据 JSON 中有命名为 `client_secret` 的 Desktop 配置值，不将其当作能保护账户的服务器秘密。**Web application secret、服务账号私钥、作者 access / refresh token 均不得打包。**

无产品方应用配置时，普通入口显示「Google 连接准备中」，不生成不可用授权链接；高级 BYOC 入口可保留现状并标明用途。不虚构 Client ID，不把某个已登录用户的客户端配置当作产品默认值。

## 拟修改模块与责任

这是建议的文件边界，实际实现前由 owner 作 scope 审读；不在本提案中生成运行代码。

| 文件 | 拟承担责任 |
| --- | --- |
| 新建 `src/google-publisher.js` | 固定产品方 Desktop 应用身份及来源；无用户令牌。公开状态只有是否已配置。测试使用合成注册值。 |
| 修改 `src/context-google-auth.js` | 按服务 / 档位启动 OAuth、稳定连接 ID、刷新、关闭；复用现有 loopback / PKCE，补完整 mutation 门禁与单次授权码约束。 |
| 修改 `src/context-config.js` | 新增本插件 secret 字段 `googleOAuthCredentials`，保存版本化六源记录；继续保留旧 BYOC 字段，不默认导入旧授权。 |
| 修改 `src/context-credential-writer.js` | 为 Google 记录提供相同的原字段比较、owner / 绑定校验及原生 revision CAS；不降级成不带 revision 的写入。 |
| 新建 `src/google-rest.js` | 固定官方来源、GET 白名单、参数生成、响应边界与业务投影；先只实现 Calendar。无任意 URL / method / header 输入。 |
| 新建 `src/context-provider.js` | 显式路由：新 Google 连接走 REST；flomo / 滴答继续原 MCP；旧 Google MCP 仅在高级配置明确选择时走原入口，无失败回退。 |
| 修改 `src/context-service.js` | 读取 source 对应的稳定 credential key；区分本地声明的 REST 能力与真实接口发现；保存 / 连接不冒称已验证私人 API。 |
| 修改 `src/context-route.js`、`src/client.js` | 原生按钮按服务传档位，展示该服务授权和读取状态；系统浏览器登录，不在微信接收令牌。 |
| 修改 `index.js` | 装配、生命周期、暂停和固定服务路由；不另起会话或定时器。 |
| 新增 / 修改 `test/google-rest.test.mjs`、`test/context-google-auth.test.mjs`、`test/context-credential-writer.test.mjs`、`test/context-host.test.mjs`、`test/context-client.test.mjs` | 分层 TDD；现有微信、记忆和提醒回归仍需通过。 |
| 更新 `docs/context-sources.md`、README、验证记录和安装审计 | 区分提案、普通入口、测试应用限制、真授权与私人读取证据；包含新模块，不包含真实凭据。 |

### 授权记录与控制器合同

建议新 secret 字段 JSON 总上限 64 KiB，单条 refresh token 上限 8 KiB，最多六个服务。读取器只增加这个已知字段，不枚举宿主其他配置；不把 access token 默认持久化。

```ts
type GoogleSource = 'calendar' | 'drive' | 'docs' | 'sheets' | 'slides' | 'gmail';
type GoogleCredentialRecord = {
  version: 1;
  connections: Partial<Record<GoogleSource, {
    connectionId: string;       // 每次本人重新授权生成；自动刷新不变
    profile: string;            // 上述固定档位，不能由聊天自造
    clientId: string;
    requestedScopes: string[];
    grantedScopes: string[];
    refreshToken: string;
    authorizedAt: string;
  }>>;
};

createGoogleConsumerAuth({publisher, readConfig, saveCredentials, fetch, clock}) => ({
  status(source), // 仅布尔状态 / 档位 / 到期信息，不返回令牌或回调 state
  start({source, profile, authorizeMutation, signal}), // => {url, expiresAt}
  getToken(source, {signal, authorizeMutation}),       // 仅内部适配器使用
  credentialState(source), // => {configured, key}，key 基于连接 ID / client / 档位
  close()
});
```

接口名可沿用现有构造器导出，但上述 source 参数与含义不能丢失。首次换码须校验实际授予 scope 足以覆盖此档位；若初次响应无法核实 scope，不声称完整授权。刷新响应不带 scope 时沿用该记录已核实的 scope；scope 缩小或刷新被拒绝则要求重新连接。服务端给出的其他权限不自动启用来源或扩展 GET 白名单。

一个 profile 只允许一个未完成 Google 授权流程。开始、回调、换码、保存和刷新都检查原对话、当前微信绑定、暂停状态、旧凭据与 client fingerprint。登录开始后用户清空 / 替换配置必须获胜；迟到回调不能覆盖。不同 source 的连接记录按当前最新 JSON 合并并用 revision CAS 保存，冲突失败明确要求重试，不盲目覆盖。

自动刷新不改变 `connectionId` 或当前 source lease；本人重新授权、变更产品 client 或切换档位会改变 key，须重新启用该来源。Google 服务可能共用同一应用授权，服务商撤销该应用可能影响多个槽；这些槽不代表服务端严格独立账户。

### REST 与现有 context 服务的接缝

现有 `personal_context` 业务输入继续保持 `source / operation / query / id / range / from / to / calendarId / limit`，不把 REST 参数交给模型任意填写。建议 provider 接缝：

```ts
capabilities(source) => {
  provenance: 'bundled-contract' | 'remote-discovery';
  tools: Array<{name: string; inputSchema: object}>;
};
read(source, normalizedOperation, {
  signal,
  authorize,     // 取得令牌后 await 当前绑定和运行门禁
  authorizeSync  // 紧靠 HTTP 前同步复查连接 key / generation / 取消
}) => {
  items: Array<{id, title, text, url?, updatedAt?, start?, end?}>;
  fetchedAt: string;
  truncated: boolean;
  coverage: {source, calendarId?, from?, to?, returned, hasMore};
};
```

Google REST 能力表是本地声明，不是联网 `tools/list` 的结果。启用时只能说「授权已保存，来源已启用；尚未验证读取」，真实首次读取成功后再记录 `lastReadAt / accessValidatedAt`。不能把静态能力表写成“读取接口已验证”。flomo / 滴答的 MCP 目录发现仍沿用现有状态语义。

HTTP 规则延续现有有界适配器：固定官方 HTTPS origins、GET 白名单、拒绝重定向、总预算 20 秒（包含取令牌和权限门禁）、响应最多 1 MiB、取消 / 关闭可中断、固定脱敏错误、不自动重试。401 只允许明确的到期刷新路径至多一次；非到期或二次 401 不在多种授权 / MCP / 账号之间回退。429 不做睡眠重试，只报告本次未完成。

### Calendar 首个可直接实现的请求

`calendar / upcoming` 默认范围为现在至 24 小时后，最多 7 天、最多 10 条；未授予 `calendar-selection` 时仅接受 `primary`，明确指定其他日历则拒绝并引导选择对应档位，不偷偷忽略限定条件。

```text
GET https://www.googleapis.com/calendar/v3/calendars/primary/events
  ?timeMin=<带时区 RFC3339>
  &timeMax=<带时区 RFC3339>
  &singleEvents=true
  &orderBy=startTime
  &showDeleted=false
  &maxResults=<1..10>
  &fields=summary,timeZone,updated,nextPageToken,items(id,status,summary,htmlLink,updated,start,end)
```

取得 `items` 后只投影上述字段。`nextPageToken` 非空即 `hasMore / truncated=true`，首个试点不自动翻页；「没返回事件」只代表此日历此范围。保留 all-day 的 `start.date / end.date` 及结束日期排他语义，不把 date-only 当 UTC 再转换而错一天。`dateTime` 保留来源偏移及 timeZone，输出按用户 / 电脑时区说明。`htmlLink` 只接受 Google Calendar 官方链接，不跟随外部附件或描述链接。

Calendar list 后续使用 `GET https://www.googleapis.com/calendar/v3/users/me/calendarList`，只在已授予两个 Calendar scopes 的档位中启用；最多 10 项并标注分页。MCP 的 `startTime / endTime / events` 必须在适配边界换成 REST 的 `timeMin / timeMax / items`，不能直接沿用旧响应投影。

### 后续来源的确定适配方向

- Drive：`GET /drive/v3/files` 使用 `name contains ...` 及 `trashed=false`、有界 `pageSize / fields`；REST 的 `name / webViewLink` 不能套用 MCP 的 `title / viewUrl`。只有用户明确要整盘检索才评估 `drive.readonly`。
- Docs：`GET https://docs.googleapis.com/v1/documents/{id}`；明确处理正文与 tabs，保留截断，不能把 MCP `content` verbalization 当 REST 输出。
- Sheets：`GET https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{encodedRange}`；先验证当前有界 A1 合同，保留返回 range 与缺省空格，不把缺省值当数值零。
- Slides：`GET https://slides.googleapis.com/v1/presentations/{id}`，固定所需文字 / 页结构 fields；不是旧 MCP `content` 包装。
- Gmail：`GET /gmail/v1/users/me/threads` 仅用明确查询；必要的 metadata 补读有独立数量预算。全文 `GET /gmail/v1/users/me/messages/{id}?format=full` 需要有界 MIME / base64url 解析，不能套用 MCP `plaintextBody`。附件不自动下载。此项不阻塞 Calendar 试点。

## 最小 TDD 执行切片

以下是下一轮实施输入，所有项目前未执行；不是本轮测试通过声明。

1. **产品身份与档位**：先写断言：publisher 缺失不返回登录链接；Calendar URL 只含事件只读 scope，不含 Gmail / Drive / `include_granted_scopes`；授权页为固定 Google origin，S256，系统浏览器 loopback。
2. **稳定记录与 CAS**：合成首次授权生成 Calendar `connectionId`；自动刷新保持 lease；重新授权只使该槽失效；用户清空、换绑、暂停或 revision 竞争时不落盘。损坏 JSON、超限 scope / token 及不同 source 记录均 fail closed。
3. **Calendar REST**：合成 fetch 断言固定 GET URL、`timeMin/timeMax/singleEvents/orderBy/maxResults/fields`；返回一般事件、跨时区、全天事件和分页均保留正确范围。恶意 htmlLink、不支持 calendarId、超过七天、响应超限与重定向均拒绝。
4. **派发时门禁**：让取 Token 挂起后更换绑定 / 清空凭据，恢复后 HTTP 计数必须为 0；异步 gate 结束后改连接 key，最后同步门禁仍阻止派发。关闭时中断取令牌、HTTP 和 body，旧响应不更新读取状态。
5. **宿主与 UI**：安装 / 页面 GET 不启 OAuth、不读资料；连接成功不自动 query；只在原认证来源会话处理明确操作；默认普通入口不再要求用户填 Client ID。原生 secrets 只写不回显，Google 配置保存沿用已核实的 `project-companion` 局部 namespace 与 revision。
6. **兼容与打包**：旧 Google MCP 授权不自动迁移或复用；微信绑定、项目计划、Dida / flomo OAuth 和 3＋7 资讯功能不变。局部通过后跑既有双 SDK 矩阵、独立审读、固定包审计及官方安装，最后由本人完成真实授权与有限读取。

可独立实现并验证 1–5 的合成层；没有真实 publisher client 时，到授权准备状态即为明确未完成，不能虚构外部步骤成功。每个切片均先写失败测试，再写最小实现。

## 尚需本人 / 产品方完成的 Cloud 步骤

1. 用产品方有权管理的 Google 账号创建专属于 DSH Dot 的 Cloud 项目与 OAuth 应用。先检查是否已有明确登记给本项目的应用；不搜索或提取其他客户端 / 用户凭据。
2. 自用试点先仅启用 Calendar API，设置真实应用名称、联系邮箱和 Audience。若使用 External / Testing，将本人账号列为授权测试用户，按 Console 显示的用户与令牌有效期限制试用，不冒称已面向所有公众。
3. 创建 **Desktop app** client；下载产品方自己的安装型应用配置，用于此项目的受控发布。该流程不创建 Web 应用 secret，也不需要新后端。
4. Data Access 先选择 `calendar.events.readonly`；确认 Console 对此范围的分类、测试及发布要求。加其他服务时分别确认，不一次塞入当前七项权限。
5. 将经人工核对的产品 client 配置接入版本化 publisher 元数据。注册条款、Google 账号登录和同意必须由有权账号的本人完成；实现者不能假装已取得许可。
6. 本人在 Dot 点击 Calendar 登录，确认显示的应用名与权限，再在现有微信 / 原生会话明确要求一次主日历查询。记录授权、读取范围及返回条数，手机显示由本人确认。只做自用试点时不把私人事件正文放进公开审计包。
7. 公共发行前准备适用的品牌 / 域名、隐私说明、数据使用说明及 Google 所要求的验证材料；只对实际使用的 scopes 处理。Gmail / 全 Drive 的 Restricted 范围在完成自身数据路径评估前保持不请求、不对外承诺。

这些是实际外部依赖，不是要求每位终端用户重复 Cloud 设置。若产品方尚未注册，继续完成本地代码、测试和其他主线；最终报告明确 Google 真实连接尚差哪一步。

## 一手依据

以下公开说明于 2026-10-20 只读核对；没有访问账号：

- [Google installed-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)：Desktop public client、PKCE、loopback，以及 installed apps 不支持 incremental authorization。
- [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth)：事件与日历列表的独立只读权限。
- [Calendar Events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)：REST 参数、时间范围、事件展开和分页。
- [Calendar CalendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)：可选择日历的只读列表。
- [Drive 授权与 scope 分类](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)：`drive.file` 的用户选定文件路线与 `drive.readonly` Restricted 分类。
- [Docs scopes](https://developers.google.com/workspace/docs/api/auth)、[Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes)、[Slides scopes](https://developers.google.com/workspace/slides/api/scopes)：相应 readonly 为 Sensitive，Drive readonly 为 Restricted；不能将所有 Google API 一概称为同一种审核。
- [Gmail scope 分类](https://developers.google.com/workspace/gmail/api/auth/scopes)：`gmail.readonly` 为 Restricted。
- [Google OAuth 概览与刷新令牌有效期](https://developers.google.com/identity/protocols/oauth2#expiration)：测试与生产条件需要按实际应用状态核对，不能承诺刷新令牌永久有效。
- [Google 官方 remote MCP 配置](https://developers.google.com/workspace/guides/configure-mcp-servers)：当前 MCP 的 Developer Preview 及客户端前置要求；它不是常规 REST OAuth 的通用强制路径。
