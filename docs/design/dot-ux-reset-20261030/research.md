# Dot 交互重做：从入口接通到同一件事自然继续

2026-10-30，只读研究。结论：**以前做过能力研究和局部 UX 审计，但没有充分落实“主对话 → 当前事项 → 可继续结果”的完整交互。用户说粗糙是有依据的，原生组件接上与安全测试通过都不能代替这一层。** 本轮未改生产代码、安装或账户。

## 旧研究到底做过什么

- canonical `docs/research/2026-10-30-personal-agency-and-proactivity.md` 主要比较持续目标、后台任务、权限和通知机制；没有竞品界面操作或首屏截图证据。
- `docs/personal-agent-iteration.md` 记录过来源连接和任务排序的改进，但其共享 Family 路径仍把桌面定位为查看进展，未覆盖用户要在桌面直接交代事情的主任务。
- `docs/research/personal-agent-20261028/UX.md` 确实读了 PAIR、Carbon、WCAG，并审过 Dot 四页截图，指出授权按钮和首份收益被埋。因此不能说“完全没研究 UX”；也不能据此声称实走过这些竞品，或把当时“今天页输入框已清楚”套到后来的共享入口。

## 界面证据和官方介绍分开

| 产品 | 本轮实际看到了什么 | 只能从文档得出的结论 |
| --- | --- | --- |
| OpenAI dots | [官方对话示意截图](</Users/shan/Library/Mobile Documents/com~apple~CloudDocs/Agent/output/dsh-dot-followthrough-2026-10-30/research/ux-20261030/dots-conversation-continuity.png>)：已有消息和底部输入共处一条连续对话，另一设备接着补充条件。是公开示意组件，并非登录态实测。 | [Getting started](https://learn.chatgpt.com/docs/dots/getting-started) 明确可以跳过连接、先聊，任务进行时继续交代；当前官网称 dots，并区分 Codex。旧 developers 路径已转向 ChatGPT Learn。 |
| Grok Bot | [官方内联动作卡截图](</Users/shan/Library/Mobile Documents/com~apple~CloudDocs/Agent/output/dsh-dot-followthrough-2026-10-30/research/ux-20261030/grok-inline-action-final.png>)：邮件内容、待执行状态和发送/放弃在同卡。是官网演示，没有提交邮件。 | [官方设计文](https://x.ai/news/designing-grok-bot) 将对话、Routine 事件、工作对象放进共同时间线；逐层呈现运行状态，减少用户手动调度。其计算机预览侧栏不等于聊天浮层。 |
| Meta Muse | 已在线核实 [Meta 发布文](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/) 及它链接的 [设计文](https://introducing.muse.ai/)；名称有官方依据。**状态/目标图本轮未成功渲染，不能拿文章截图冒充界面图。** | 长期主聊、旁聊、当前活动摘要、目标视图、明确批准卡均为官方设计叙述，未做登录态验证。 |
| ChatGPT Pulse | 读到 [2025-09-25 发布文](https://openai.com/zh-Hans-CN/index/introducing-chatgpt-pulse/)；图片未成功渲染，仅作较早设计样本，不声称是 2026 当前全部界面。 | 有限主动卡可以展开、追问、保存为聊天；反馈影响后续建议。不能据此证明 Dot 应默认自动扫描资料。 |
| Lindy | [官方 Gmail 扩展示意截图](</Users/shan/Library/Mobile Documents/com~apple~CloudDocs/Agent/output/dsh-dot-followthrough-2026-10-30/research/ux-20261030/lindy-extension.png>)：场景和直接收益先于配置。未安装扩展。 | [扩展说明](https://www.lindy.ai/chrome-extension) 支持在 Gmail 就地聊天、调整草稿。没有据此确认跨所有网页的全局浮层能力。 |

没有把这些产品名称当作“最佳体验”或市场地位的证明；官网设计自述与用户实际效果也不同。

## 对当前 Dot 的实图观察

查看了精确 source `7f47d97899e5dc7ffd970e40c9b377e71752062f` 的合成隔离 Host 证据：[首页](</Users/shan/Library/Mobile Documents/com~apple~CloudDocs/Agent/output/dsh-dot-followthrough-2026-10-30/host-final-verified/home-native.png>)、[浮层](</Users/shan/Library/Mobile Documents/com~apple~CloudDocs/Agent/output/dsh-dot-followthrough-2026-10-30/host-final-verified/overlay-native.png>)、[窄屏](</Users/shan/Library/Mobile Documents/com~apple~CloudDocs/Agent/output/dsh-dot-followthrough-2026-10-30/host-final-verified/overlay-narrow.png>)。这些是虚构历史和未发送草稿，没有真实私人查询或发送。

实际可见：原生历史与输入已存在；但宿主导航、Dot 标头、四个 tab、首页提问标题、外层大框与内层聊天一起占用首屏，“当前事项”落在更低处。微信未确认的状态仍在显眼位置，容易让本地聊天看起来也需要先连微信。浮层保留历史与草稿，但主体仍是一个缩窄的完整聊天框。**这些问题不是换配色能解决的；需要减少层级，并把当前事项与同一输入接起来。**

另有已复现的行为边界：home 已持有 Composer 时打开浮层会提示回工作台；随后切 Projects 不会自动获取，须关闭再开。单实例保护正确，但把内部占用状态交给用户理解仍然费力。新原型应验证更自然的入口行为，不撤销单实例和草稿保护。

## 五项具体取舍

| 交互 | 本轮原型要表现什么 | 正式实现复用与验收 |
| --- | --- | --- |
| **1. 主输入优先** | 首屏只有一个清楚的交代入口；最近对话就在它上方。少量示例替代教程，连接配置不阻断开始。当前事项可扫到，不能被空的大聊天框推走。 | 复用原生 Conversation/Composer；未扫码、Family 不可用均可聊。5 秒内找到输入；不复制内容、不二次跳转；新用户模型缺项仍由真实原生能力处理，不假装已发送。 |
| **2. 主动卡接回当前事项** | 一件事只突出“发生了什么、为什么现在、准备了什么、一项下一步”。来源与时间次级展开；“继续处理/稍后/已处理”在卡附近。 | 复用 item/goal/revision 与反馈账本。继续时带精确事项身份进入同会话，不只靠标题相似；处理后无新事实不复活。建议、已执行、等待本人各用真实状态。 |
| **3. 浮层入口即继续** | 在首页点击 launcher 聚焦已有输入；其他页打开同一会话浮层；展开工作台接续同一草稿。不要把“对话被占用”当常态页面。 | 复用单实例 controller，核正式 focus/导航 API，禁止 DOM 越权。首页→其他页→浮层→主区→重开始终 1 个编辑器、同 session、同草稿；未知状态仍失败关闭。 |
| **4. 一条恢复提示，留在原任务** | 只显示受影响来源、已完成部分及一个恢复动作；恢复后回原问题。不要每个区域重复连接警告。 | 复用来源状态与授权代数，保留原意图/范围；取消回原稿，未知回执不重发；单源失败不隐藏聊天。[官方连接说明](https://learn.chatgpt.com/docs/dots/computers-and-apps) 也区分过期、离线与撤权，但竞品真实失败态未实测。 |
| **5. 轻进展，少打扰** | 顶部一行真实工作摘要；需要本人判断的事项优先。例行“已检查无变化”可查，不占主卡；浮层不因后台检查自动展开。 | 复用 quiet/partial、jobs 和共享预算。第二轮同材料不弹；来源失败是未知；看完有终点。状态动效不是完成证据。 |

先以一个合成任务串完上述路径；示例卡须明确是原型，不允许任意输入伪装成已理解或已执行。正式接线后再测授权失败、取消、第二次交代和中断恢复。没有真实用户完成率或无需解释的实走结果之前，不能宣称“体验验收完成”。

## 不照搬

不照搬云端全天候承诺、多 Bot 管理台、额外 tabs 或头像动画；不把主动研究默认授予新用户；不把模型生成 HTML 当执行协议；不为跨入口顺畅而复制会话、覆盖草稿、隐式发送或借用 Family Owner 权限。头部产品的结构可参考，运行能力和权限仍以本项目为准。

## 最终回答可用的三个直接来源

1. [OpenAI dots：先开始对话，连接可稍后补](https://learn.chatgpt.com/docs/dots/getting-started)
2. [Grok Bot：同一对话中的结构化结果与动作](https://x.ai/news/designing-grok-bot#the-shape-of-information)
3. [Muse：长期对话、活动与目标的设计取舍](https://introducing.muse.ai/)

完整来源观察时间、公开文本和截图见 [研究证据目录](</Users/shan/Library/Mobile Documents/com~apple~CloudDocs/Agent/output/dsh-dot-followthrough-2026-10-30/research/ux-20261030/personal-agent-ux-review.md>)。浏览器只使用一个 ego TaskSpace 99，已 finish；未操作日常 Chrome。Ego Lite 提示有更新，本轮未升级。
