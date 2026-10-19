# 版本记录

## v0.4.0-preview.2 · 首个公开预览版

发布日期：2026-10-19。

DeepSeek Dot / DSH Project Companion 是牛村木木山制作的社区项目助理：在微信里查看、记住和跟进选定的 DeepSeek Harness 项目，并按明确请求交办工作、带回本次执行回复。

- macOS 统一安装入口，装配固定微信桥接与项目助理，保留已有兼容绑定。
- 原生首次使用页面：连接微信、选择最多五个项目、预览来源并提交一次首份简报。
- 有来源的项目记忆、明确时间的提醒/日报，以及可取消的一次性或周期只读检查；默认不创建计划。
- 显式交办与按本次输入/轮次关联的原入口回复，不把“已接收”当作完成。
- 首简报和主动检查限制在选定项目的只读工具；无实质变化可静默结束。

两套官方 SDK 的回归各284项通过；现有本机/微信绑定完成了有界验证。修复后的准确简报与无变化静默在电脑原生会话实测通过；旧版提醒、日报、交办回传和首份简报通路由用户手机确认。修复后准确摘要尚未再次在手机复验。新用户从零开箱、多日运行、休眠重连、Windows及多用户未完成实测。

微信每个连续交互窗口有10条主动消息限制，用户正常回复后恢复。电脑和 Harness 必须在线。邮箱、日历、Slack、Notion、iCloud云授权与iMessage后置。详见[验收范围](docs/verification.md)。

感谢[pan17/dsh-wechat](https://github.com/pan17/dsh-wechat)、[hanshanyike/dsh-yolo](https://github.com/hanshanyike/dsh-yolo)、[john-walks-slow/dsh-proactive](https://github.com/john-walks-slow/dsh-proactive)。完整MIT版权及固定来源见[第三方说明](THIRD_PARTY_NOTICES.md)。
