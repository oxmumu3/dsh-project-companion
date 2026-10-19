# 对照与复用

公开来源核查：2026-10-18；本项目记录更新：2026-10-19。当前版本 `0.4.0-preview.2`。判断来自公开文档、固定源码与本项目实测，不代表社区方案的持续使用率或稳定性；下载次数也不等于独立用户数。

| 能力 | 现成供给 | 本项目如何组合 |
|---|---|---|
| 微信扫码、收发、权限问答 | pan17/dsh-wechat、NattoCB/dsh-plugin-wechat-bridge 等已有实现 | 固定使用独立插件 pan17/dsh-wechat 0.11.0，不把微信通路算作原创 |
| 工作区、会话切换与任务通知 | 微信桥接已有相关能力 | 按项目选择目标，把明确任务和对应执行回复串回原微信入口 |
| 定时与主动唤醒 | dsh-proactive 已有 | 复用 0.3.1 的 Store、Scheduler、WakeDriver 及校验库，按项目和原来源会话隔离；不同时启用上游整包 |
| 项目记忆 | dsh-yolo 已有事项整理、事件存储与 scope 机制 | 选取 0.5.0 的 SQLite schema、事务、事件仓库和身份库；不加载全局扫描、自动抽取、提醒引擎或 UI |
| 项目资料与近期会话 | 相邻模块可提供部分输入 | 有界读取选定项目，保留文件、用户请求与助手记录的角色和时间，区分分析材料与手机短摘录 |
| 首次使用 | 各插件分别安装配置 | macOS 统一安装入口与原生引导，沿用绑定、选项目、预览及首份只读简报 |
| Google、Slack、Notion 等 | 社区有不同连接器 | 本版未整合授权；后续按服务核对权限和接入方式 |
| iMessage | 已有 dsh-on-imessage | 需要额外权限和运行组件，本版未集成 |

本项目的方向是「长在微信里的 DeepSeek 版 Dot」：了解选定项目，保存有限上下文，按要求跟进，明确交办，再把执行回复带回原入口。它依托社区基础能力，增加产品流程与范围约束，不能据此宣称「唯一」「社区都只会扫码」或「功能更多所以更好用」。是否省事仍需对照安装、交办、追问、恢复各步骤的实际体验。

## 复用与许可

微信桥接仍是独立 bundle。YOLO 与 proactive 采用固定版本库模块组合；YOLO 去除 TypeScript 类型并调整导入后缀，proactive 使用完整性验证后的 npm 编译文件，未修改其运行逻辑。完整 MIT 许可、版权、来源与逐文件 hash 见[第三方声明](../THIRD_PARTY_NOTICES.md)及 vendor 中的 `SOURCE.json`。项目署名不代表 DeepSeek 或上游作者背书。

项目记忆只操作已关注根目录下的独立数据库，不导入全部历史。主动跟进默认关闭；用户明确安排后绑定项目和原来源会话，只允许该项目的记忆、资料读取与静默结束。写入、派工、直接微信发送及任意代码执行在自主回合中被拒绝，后续普通用户回合恢复原权限。

本机已完成一次性真实唤醒、准确摘要与第二次无变化静默；旧版明确交办、单份结果、提醒、日报和取消已由用户手机回贴确认。它们不是多日可靠性证明，也不是与社区方案同任务对照。新用户扫码、长期运行、休眠重连、多用户及与上游整包同时启用的互操作仍待验证。详见[验证记录](verification.md)。

来源：

- [pan17/dsh-wechat](https://github.com/pan17/dsh-wechat)
- [NattoCB/dsh-plugin-wechat-bridge](https://github.com/NattoCB/dsh-plugin-wechat-bridge)
- [john-walks-slow/dsh-proactive](https://github.com/john-walks-slow/dsh-proactive)
- [hanshanyike/dsh-yolo](https://github.com/hanshanyike/dsh-yolo)
- [yuunnn/dsh-on-imessage](https://github.com/yuunnn/dsh-on-imessage)
