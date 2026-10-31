# DSH Dot：首页与浮层原生交互实施审计

审计对象：canonical commit `6bf3f13`；其 tree 与 `7f47d97899e5dc7ffd970e40c9b377e71752062f` 一致（`492c4185bb6a6740bcf616703ba816584ce37de6`）。以下为实施蓝图，不是已实现功能。只核对了本地源码及宿主内置包，没有读取私人资料、修改配置或发送消息。

## 决定与范围

本轮先确认可视方案。实施时沿用一个已核验的本机 native Session，保留官方 Conversation Composer、审批与会话权限；不自动创建新会话、不转移授权，也不为追求界面整洁伪装数据为空。首页已有可编辑框时，不再展示会导致“已在工作台打开”的重复浮层入口；其它页面保留入口。

| 层次 | 已证实 | 尚待隔离 Host 验证 |
| --- | --- | --- |
| 首页 / 浮层 | Dot 自己的 `held` 排他会导致第二处显示“对话已在工作台打开”。 | 页间快速切换、焦点、IME、文件和引用附件、单实例全链路。 |
| 原生会话 | `conversation.content` 是 occurrence-local factory，提供 `views` / `widthControls` 位置；输入和审批仍属于 factory。 | 仅替换 `views` 后的可靠消息数据接口、加载、无障碍、滚动与异常展示。 |
| 历史位置 | 官方 Chat 会优先恢复已有阅读位置；没有保存位置时才跟随最新。 | 本次截图是否由旧位置、容器尺寸或异步加载造成，尚不能判定。 |
| 身份与来源 | 记录的本机状态在 15:26 UTC：滴答 configured/enabled，flomo configured/disabled；非远端有效性证明。 | 原 Family 路由为何在本次显示 unknown，需按真实绑定和来源逐项检查，不能推断所有来源失效。 |

## 1. 今天页不显示重复入口

实施点：`src/client.js:226` 的 `DotOverlay`、`:280` 的 `registerDotOverlay`、`:650` 左右 `OverlayDesktopConversation`，和 `:914` 的 `createDotOverlay` 注册。左侧 Dot 主面板 key 为 `dotPanel`；可通过 Host 注入的 `usePanelInfo` 读取 `activePanelId`。本机官方 `app.asar!/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js:57` 的 `DocumentTitle` 也使用这一 hook 判定主面板。

最小做法是传入本插件的 `dotPanel`，并通过插件内部可订阅状态同步工作台当前 tab 与原生编辑器占用；仅当 Host 选中 `dotPanel` 且 tab 是“今天”并且原生输入框实际可用时隐藏 launcher。`activePanelId` 本身只能判断 Dot 工作台，不能区分“今天 / 项目 / 记忆 / 连接”；其它 tab 仍应保留入口。所有 hooks 保持稳定调用顺序；不要在已打开浮层后只隐藏容器而保留第二个 editor。切换到今天页时先卸载浮层编辑器并确认 controller 的 release 完成，随后首页才能 acquire；外部切页回其它页面后恢复 launcher。首页无法获得官方输入框时，保留可用的主入口或给出简洁的错误恢复，不做“空浮层”。

注意 `src/client.js:162` 的 controller 当前在第二处 acquire 失败时直接报 held；若首页先尝试 acquire、浮层稍后才释放，现有 component 不会自动重试。切页竞态需要明确的串行所有权交接或 release 通知，不能只加 CSS `display:none`，也不能用两个隐形可编辑根。官方明确说明一个 Session 不支持同时存在两个可编辑根（`app.asar!/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/README.md:79`）。

焦点方案：默认优先隐藏冗余入口；除非隔离 Host 找到受支持且能精确指向现有 Composer 的 focus API，否则不要通过 querySelector、模拟点击或复制文本来“聚焦”。

## 2. 精简历史，同时保留原生 Composer 和审批

当前 `src/client.js:301` 的 `DesktopConversationContent` 直接调用：

```js
renderFactorySlot('conversation.content', {
  variant: 'embedded', phase: 'active', hero: false,
});
```

官方 `app.asar!/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js:19921` 将 `conversation.content` 注册为 factory，定义 occurrence-local `views`（session scope）和 `widthControls`（root scope）；`:17808` 的 `ConversationContent` 使用 `useFactorySlot('views', ConversationSessionView)`，`:17913` 通过 `renderSlotChain('conversation.composer', ...)` 组装输入与审批接管。官方 subagent 自己的用法在 `app.asar!/dsh/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js:782`：第三参数 `slots.views` 替换本次内容视图。

最小接口草案，**`DotCompactHistory` 的数据读取仍须先核验，并非现成可直接发布的实现**：

```js
function DesktopConversationContent({ renderFactorySlot }) {
  return renderFactorySlot(
    'conversation.content',
    { variant: 'embedded', phase: 'active', hero: false },
    { slots: { views: DotCompactHistory } },
  );
}

// DotCompactHistory 必须使用经官方验证的当前 Session 只读事件投影；
// 显示有界、按时间排序的真实对话，提供“查看完整历史”。
// 数据尚未就绪时显示加载或不可用，不生成示例记录或误称空历史。
```

优先限定一屏真实、最近的用户消息和最终回复；更早内容由用户打开完整历史。正在运行、等待审批、工具失败等状态必须保留真实可见入口，不能将未完成工作画成已完成。任何 Markdown、附件和引用展示应采用宿主正式组件或经单独验证的安全渲染，不能把消息正文拼成不可信 HTML。

**不要单独调用 `conversation.composer.bar` 充当完整输入框**：该 seat 虽然存在（官方源码 `:17887`、`:19921`），但会绕过 `conversation.composer` chain；宿主审批接管和只读会话规则正是注册在该 chain 上。直接嵌入内部 `InputBar`、更改 DOM/CSS 隐藏轨迹或用双根共享输入均不作为方案。

官方 `ui-chat.performanceUsage=compact` 能去掉每轮 token 明细和统计弹窗，但可能仍显示速度/缓存，且为全局偏好；`transcriptView` 的 compact/standard/detailed 同样是全局，不能为 Dot 静默改变用户所有会话。官方确有替换 `conversation.composer.dock` 的 activity/usage 插槽合同，但尚无证据证明可限制在 Dot 单个 occurrence，因此不贸然全局替换。来源：`app.asar!/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/README.md:69-71`。

滚动：官方 `app.asar!/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js:2497` 等待会话 ready 后调用 `reading.restore()`；`:1072` 有保存位置时恢复，否则才跟随底部。精简视图若引入自己的历史，仅在明确的“最近对话”视图首次打开或用户点“最新”时定位最新，不覆盖用户主动浏览的位置；不要将此次“看见旧历史”的成因当成已确认。

## 3. 旧桌面会话与授权兼容

现状：`index.js:598` 将原 `readSetup` 传给 `readDesktopConnection`；`src/workbench.js:37-47` 只投影一个验证通过的本机会话 id 和 revision。`src/client.js:652-663` 先尝试本插件生命周期缓存，再尝试已保存的 desktop session 指针，最后才取这个旧 Dot route；今天页也按 `localConversation ?? desktopTargetOf(snapshot)` 选择。它们证明会话存在和绑定未在读取时变化，**不证明旧会话是用户想要的主对话，也不证明该会话属于当前 Family Owner**。

- 旧记录保留在原生历史；首屏不自动把尚未经用户选择的旧微信验收会话当成新 Dot 的默认主对话，也不将它删除、清空或改名。
- 本轮只提供明确的“继续已有对话 / 查看完整历史”选择；在可视方案获得确认前，不因打开首页、浮层或显示空态调用 `sessions.create`。如果以后引入新会话，其创建必须属于明确的用户动作，而不是默认副作用。
- `desktopConversationSessionId` 需要区分“用户明确选择”与过去代码自动记录；现存只有字符串，没有足够证据反推出用户意图。可设计一个向后兼容的单独标记，未确认时显示为旧会话候选；状态存储和迁移方式须经单独实现与验证。
- 老 session 如被明确选择，继续使用它原来的身份与既有权限；显示它不等于激活新来源。Family Owner 的消息、目标项目、绑定代际和原 session 私源授权各自验证，不从已展示的桌面 session 复制、扩大或继承授权。

## 4. 把多个未知收敛为可操作的一处

建议首页只放主对话和真实有内容的跟进；连接问题集中为一条状态摘要，例如“部分连接需要核对”及“查看连接”，点开后逐项说明。原始状态缺失时仍标记“暂无法确认”，不变成“没有事项”“全部已连接”或“账号已失效”。没有真实任务时隐藏空的交办/跟进卡片，而不是用多段功能教程填满首页；后台是否运行、是否有未确认任务仍可在状态详情中核对。

数据边界：

- `src/workbench.js:50-57, 130-160` 的 `availability.projects/jobs/plans` 与实际绑定分别独立；不能因为 `jobs` 未读到而断言没有交办，也不能把 `readOnly` 导致的计划隐藏说成计划为零。
- `index.js:598-618` 的 `personalReview.available=false` 汇总了会话、绑定、授权及状态读取失败，现有结构不能从它判断究竟哪一项失效；界面只能提示“个人回顾暂未确认”。
- `src/family-workbench-route.js:9-27` 的 Family 工作台 route 依赖 `scopeFor/current/recheck`，而 `context.delegationLeases()` 会对**全部**原来源检查当前配置及签名。单个来源异常可能使整个 Family projection 为 unknown；多个 unknown 可能是一个共同上游问题，并非多个服务均故障。
- 家庭入口 disabled / offline / changed / unknown、来源撤权或重绑仍须按原权限保护处理。单靠前端合并文字不会解除错误的全来源耦合；真正改善必须在服务端为公开资讯、桌面会话、各个私人来源与项目分别设计最小权限与可解释状态，并保持末端校验。
- `account-runtime-status.json` 是历史时间点的本机配置投影：dida enabled、flomo disabled；没有请求 provider，不能证明授权远端有效，不能自动启用 flomo 或判断旧新账号相同。

## 5. 必要验收

1. 主界面已有原生编辑器时，重复浮动入口不可见；从其它页面打开能直接输入，不出现空浮层。打开/关闭/切页/快速连点期间，同一 session 的可编辑根始终最多一个。
2. 未发送草稿、光标、引用 chips 在首页和浮层切换后保留；不自动发送、不覆盖用户输入。用真实 Host 检查 IME、附件上传、审批接管和页面重启；浏览器 File 对象不承诺跨重启持久化。
3. 旧测试会话保留可查看，但未选择前不自动成为新主对话；两次打开不会自行增加 session，不迁移任何来源 grant。
4. 人为合成一个来源配置失效：本地对话、无关项目和授权允许的公开资讯不被无关私源误判；该来源本身保持 unknown/需核对；撤权、换绑、离线和 Family 成员身份均 fail closed。
5. 校验历史加载、空态、长对话、错误、待审批和滚动；Host 截图分别覆盖首次、已存在旧记录、已有草稿与窄屏。VM 组件测试、接口成功和用户真实手机回执分别记录，不能相互替代。

## 官方证据索引

以下为安装包内成员路径（`!` 表示 `app.asar` 内路径），行号与本机当前版本绑定；未来宿主更新需重新核对。

- `app.asar!/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js:17808,17887,17913,19921`：内容 factory、Composer seat 和 chain。
- `app.asar!/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/README.md:79`：单 Session 不支持同时多个 editable roots；草稿保留边界。
- `app.asar!/dsh/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/client.js:782`：occurrence-local `views` 调用样例。
- `app.asar!/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js:1072,2497`：阅读位置恢复和滚动策略。
- `app.asar!/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/README.md:69-71`：全局使用量偏好与可替换 dock 条目。
- `app.asar!/dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js:57`：`usePanelInfo` 和主区 session 显示判定。

内部源码内容哈希（SHA-256，便于未来对比）：conversation client `cfd9ab6e1b38e89ac9859940bce8b407240e33902d5e231fca76fc68de598bcc`；chat client `ca94683197d4439a8307608b7493038753d1d4122fed7b53f58ce1cd1cf48f29`；subagent client `9c9153d540389871220033bb001948faeb666cb4c96dff641f1748287856c90d`。
