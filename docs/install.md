# 安装 DSH Dot 0.14.1-preview.11

这是牛村木木山维护的社区预览，为已有官方 DeepSeek Harness 增加 Dot 和配套微信桥接。适用于 macOS，安装器严格核对 Harness 与 SDK 同为 `0.2.0-rc.2`、`0.2.1-rc.2` 或 `0.2.1-rc.3` 之一。

1. 从官方渠道安装 DeepSeek Harness。**首次安装后，先打开一次 Desktop，完成初始化与自己的模型配置；保存工作并正常退出。** 官方 CLI 需要已初始化的 Desktop profile，未运行过 App 就安装插件会被拒绝。
2. 在[项目发布页](https://github.com/oxmumu3/dsh-project-companion/releases)选择对应版本的完整 macOS 安装包，解压后保留整个目录，双击 `Install.command`。安装器不会关闭正在运行的任务，执行时可能需要网络取得依赖。
3. 阅读安装结果，再启动 Harness；在插件管理器确认 Dot 与微信桥接启用及运行。首次绑定由本人扫码，随后按界面提示从微信发消息建立会话。

也可在解压后的目录用终端执行 `node scripts/install.mjs --bundle-dir . --dry-run` 预览；确认后执行同一命令并加 `--install`。入口可使用官方 App 自带运行时。请勿单独移出脚本或修改 profile 绕过保护。

已有桥接 0.11.0 或 0.11.1-dot.1 可升级到本包 0.11.1-dot.2，相同版本保留；其他不兼容版本停止。旧 Dot 可升级，不自动降级较新版本；原本禁用的组件保持禁用并在结果中提示。实际保留绑定需要以安装后的状态为准。

本包默认使用 [pan17/dsh-wechat](https://github.com/pan17/dsh-wechat) 的维护版本；许可证及差异见随包 `THIRD_PARTY_NOTICES.md` 和 `bridge-maintenance/`。家庭助手共用微信入口需要额外配置，不随默认安装自动开启。Google、flomo 与滴答为可选连接，授权与使用范围见[资料连接](context-sources.md)。

空白隔离环境下的官方 Desktop CLI 会要求先由 Desktop 首次初始化；独立新用户从初始化到安装、扫码和手机接收尚未完整验收。安装、运行、发送及手机收到均须分别确认。遇到 macOS 安全拦截先核对来源，不关闭系统保护；Windows 整合安装未验证。
