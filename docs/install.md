# 安装 DSH Dot 0.15.0-preview.12（社区预览）

请使用[固定版本发布页](https://github.com/oxmumu3/dsh-project-companion/releases/tag/v0.15.0-preview.12)中的 macOS 完整包，并按[该版本安装说明](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.15.0-preview.12/INSTALL.txt)操作。完整包包含 Dot 与配套微信桥接；不自动安装或配置家庭助手共用入口。源码、首次使用和验证说明均以同一个 tag 为准：[源码](https://github.com/oxmumu3/dsh-project-companion/tree/v0.15.0-preview.12) · [首次使用](https://github.com/oxmumu3/dsh-project-companion/blob/v0.15.0-preview.12/docs/first-use.md) · [验证记录](https://github.com/oxmumu3/dsh-project-companion/blob/v0.15.0-preview.12/docs/verification.md)。

需要先安装官方 DeepSeek Harness、打开一次完成桌面初始化，并保存工作后正常退出。安装窗口发现尚未初始化时会引导打开官方 App，等待本人退出后在同一窗口继续；不会自动关闭已有任务。首次扫码、模型登录与第三方账号授权由本人完成。

Google 三项权限正在审核，尚未批准，仍可能有未验证提示、累计 100 个账号上限和账号策略限制；flomo 需要 MAX。有变化时主动推送的手机验收、独立新用户首次扫码到收件、连续多日与休眠重连仍待验证。安装不会默认创建私人资料扫描或周期计划。

以下保留主分支的历史版本说明；安装本预览请使用上方固定 tag 的入口，不要混用旧版文件。

## 历史版本：DSH Dot 0.13.0-preview.2

本版是 DeepSeek Harness 原生项目助理插件，适配已验证的 0.2.0-rc.2、0.2.1-rc.2 和 0.2.1-rc.3。作者牛村木木山；独立社区项目。

在 Harness 新会话粘贴：

> 请使用官方插件管理工具安装并启用 DSH Dot：https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.13.0-preview.2/dsh-project-companion-0.13.0-preview.2.tgz 。保留已有微信绑定、来源授权、项目记忆和提醒，不改变其他插件，不重启正在运行任务的宿主。安装后核对 DSH Dot 组件正常运行。

安装只处理本插件。已有微信连接和资料来源沿用原配置；首次使用微信需另安装兼容当前 Harness 的微信桥接，并由本人扫码。不要在 rc.3 使用旧 0.12 完整 ZIP 替换桥接。需要审批时由本人核对，插件不会代为批准。

[固定版本页面与校验资产](https://github.com/oxmumu3/dsh-project-companion/releases/tag/v0.13.0-preview.2)。电脑和 Harness 需保持运行；安装、组件运行、通道受理和手机实收分别核对。Google 仍有未验证权限与累计账号上限，flomo 需 MAX，均为可选来源。

完整使用方式见[快速开始](quickstart.md)和[真实验证边界](https://github.com/oxmumu3/dsh-project-companion/blob/d389852e3aebfab061325d72b8286ba40de319ee/docs/verification.md)。
