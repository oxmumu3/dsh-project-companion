# 对照与复用

社区公开来源核查保留在2026-10-18的范围，本轮没有重新研究竞品。本项目说明更新于2026-10-21，面向正在准备、尚未安装到本机或公开发布的 `0.11.0-preview.2`。旧 `0.6.0-preview.1` 仅作历史归档。以下用于说明复用关系与本项目范围，不代表社区方案的持续使用率、稳定性或功能全貌。

| 能力 | 现成供给 | 本项目如何组合 |
|---|---|---|
| 微信扫码、收发、权限问答 | pan17/dsh-wechat、NattoCB/dsh-plugin-wechat-bridge 等已有实现 | 基于 pan17/dsh-wechat 0.11.0 的独立维护 bundle `0.11.1-dot.2`，保留原作者版权与 MIT；不把微信通路算作原创 |
| 工作区、会话切换与任务通知 | 微信桥接已有相关能力 | 按项目选择目标，把明确任务和对应执行回复串回原微信入口 |
| 定时与主动唤醒 | dsh-proactive 已有 | 复用 0.3.1 的 Store、Scheduler、WakeDriver 及校验库，按项目和原来源会话隔离；不同时启用上游整包 |
| 项目记忆 | dsh-yolo 已有事项整理、事件存储与 scope 机制 | 选取 0.5.0 的 SQLite schema、事务、事件仓库和身份库；不加载全局扫描、自动抽取、提醒引擎或 UI |
| 项目资料与近期会话 | 相邻模块可提供部分输入 | 有界读取选定项目，保留文件、用户请求与助手记录的角色和时间，区分分析材料与手机短摘录 |
| 首次使用 | 各插件分别安装配置 | macOS 统一安装入口与原生引导，沿用绑定、选项目、预览及首份只读简报 |
| 可选个人资料来源 | 社区有不同连接器 | flomo/滴答有官方账号授权入口，真实账号读取待验；Google 普通日历入口准备中，其他 Google 来源仍有开发者与预览资格门槛；Slack/Notion 未集成 |
| iMessage | 已有 dsh-on-imessage | 需要额外权限和运行组件，本版未集成 |

本项目为已有官方 Harness 增加一条「选定项目 → 明确交办 → 对应执行回复 → 缓存恢复」流程，并保存有限项目上下文。当前优先验收准确项目、单份结果和恢复不重复。项目变化卡正在实现、待验，不作为已完成能力。它依托社区基础能力，增加产品流程与范围约束；尚未进行同任务体验对照，不宣称与官方 Dot 功能等价、唯一或普遍更好用。

## 复用与许可

微信桥接仍是独立 bundle；维护差异、固定来源与复建方法见[桥接来源说明](https://github.com/oxmumu3/dsh-project-companion/blob/d389852e3aebfab061325d72b8286ba40de319ee/docs/../bridge-maintenance/README.md)，维护责任归本项目，不代表原作者背书。YOLO 与 proactive 采用固定版本库模块组合；YOLO 去除 TypeScript 类型并调整导入后缀，proactive 使用完整性验证后的 npm 编译文件，未修改其运行逻辑。完整 MIT 许可、版权、来源与逐文件 hash 见[第三方声明](../THIRD_PARTY_NOTICES.md)及 vendor 中的 `SOURCE.json`。项目署名不代表 DeepSeek 或上游作者背书。

项目记忆只操作已关注根目录下的独立数据库，不导入全部历史。主动跟进默认关闭；用户明确安排后绑定项目和原来源会话，只允许该项目的记忆、资料读取与静默结束。写入、派工、直接微信发送及任意代码执行在自主回合中被拒绝，后续普通用户回合恢复原权限。

历史版本已有本机一次性唤醒、准确摘要和第二次无变化静默证据，也有用户手机收件记录；之后仍出现过延迟与恢复后复述，不能合并为稳定性已通过。本轮 `0.11.0-preview.2` 尚未安装或手机验收，准确交办、单份结果和恢复防重复需重新核对。陌生用户开箱、长期运行、休眠重连、多用户及与上游整包同时启用的互操作仍待验证。按版本与层次查看[验证记录](https://github.com/oxmumu3/dsh-project-companion/blob/d389852e3aebfab061325d72b8286ba40de319ee/docs/verification.md)。

来源：

- [pan17/dsh-wechat](https://github.com/pan17/dsh-wechat)
- [NattoCB/dsh-plugin-wechat-bridge](https://github.com/NattoCB/dsh-plugin-wechat-bridge)
- [john-walks-slow/dsh-proactive](https://github.com/john-walks-slow/dsh-proactive)
- [hanshanyike/dsh-yolo](https://github.com/hanshanyike/dsh-yolo)
- [yuunnn/dsh-on-imessage](https://github.com/yuunnn/dsh-on-imessage)
