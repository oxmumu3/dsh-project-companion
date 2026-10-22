# 安装 DSH Dot 0.12.0-preview.4

适用于 macOS 上已有的官方 DeepSeek Harness `0.2.0-rc.2` 或 `0.2.1-rc.2`。安装包包含项目助理和配套微信桥接，沿用已有兼容绑定；这是社区预览版，作者奥克斯木木山，非 DeepSeek 或 OpenAI 官方产品。

## 复制安装指令

先保存工作并正常退出 Harness，再打开 macOS「终端」粘贴下面这一行：

```sh
(dsh_dot_dir="$(mktemp -d)" && cd "$dsh_dot_dir" && curl -fLO "https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.12.0-preview.4/dsh-dot-0.12.0-preview.4-macos.zip" && curl -fLO "https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.12.0-preview.4/dsh-dot-0.12.0-preview.4-macos.zip.sha256" && shasum -a 256 -c "dsh-dot-0.12.0-preview.4-macos.zip.sha256" && ditto -x -k "dsh-dot-0.12.0-preview.4-macos.zip" . && open "dsh-dot-0.12.0-preview.4-macos/Install.command")
```

它会下载固定版本、核对 SHA256、解压到独立临时目录并打开 `Install.command`。脚本会显示安装结果；安装结束后打开 Harness，在左侧进入「DSH Dot」。已有微信连接可以沿用；首次使用需要本人扫码、配置自己的模型。若电脑尚未安装 Harness，安装入口会打开官方应用下载页，待本人装好后继续。

也可以直接下载[完整 macOS 安装包](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.12.0-preview.4/dsh-dot-0.12.0-preview.4-macos.zip)，解压并双击 `Install.command`。完整目录须一起保留，不要只移出入口文件。校验文件：[ZIP SHA256](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.12.0-preview.4/dsh-dot-0.12.0-preview.4-macos.zip.sha256)；全部发布资产见[固定版本页面](https://github.com/oxmumu3/dsh-project-companion/releases/tag/v0.12.0-preview.4)。

Google 三件套已切为 External / In production，无需测试账号白名单；正式权限验证与陌生账号首次授权实测仍待完成，有未验证应用提示与累计 100 个账号上限；flomo 需要 MAX。两者都是可选来源，不影响本地项目和微信基本流程。私人来源按需读取，连接不会自动开启持续扫描或推送。完整能力与真实验收范围见[连接说明](https://github.com/oxmumu3/dsh-project-companion/blob/v0.12.0-preview.4/docs/context-sources.md)和[验证记录](https://github.com/oxmumu3/dsh-project-companion/blob/v0.12.0-preview.4/docs/verification.md)。

## 安装后

完整操作见[首次使用](https://github.com/oxmumu3/dsh-project-companion/blob/v0.12.0-preview.4/docs/first-use.md)。

1. 打开 Harness，完成自己的模型登录配置，确认微信桥接与项目助理启用。
2. 从左侧进入「DSH Dot」，沿用微信绑定或扫码；首次连接后从微信发一句「你好」建立会话。
3. 选一个已经添加到 Harness 的项目，先生成首份简报，再按需交办、安排提醒或日报。
4. 手机实际收到和排版由本人核对。安装、组件运行、通道报告发送与手机收到是不同状态。

电脑、Harness 和网络需要保持可用，休眠或退出会影响主动提醒。macOS 安全拦截时先停止核对，不关闭系统安全保护。安装仍可能联网下载依赖；Windows 整合安装未验证。

## 官方插件页面添加

高级用户可在官方插件管理页添加并启用同版本 [companion tgz](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.12.0-preview.4/dsh-project-companion-0.12.0-preview.4.tgz)。微信能力需要同一 Release 的 [dsh-wechat 0.11.1-dot.2](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.12.0-preview.4/dsh-wechat-0.11.1-dot.2.tgz)；推荐使用完整安装包处理版本和依赖。无需额外启用 YOLO 或 proactive 整包。

## 保留与升级规则

- 桥接未安装时安装配套 `0.11.1-dot.2`；已有 `0.11.0` 或 `0.11.1-dot.1` 时升级并沿用绑定；已是 `.2` 则保留。其他版本停止，不降级、不重置配对。
- 项目助理同版本保留，允许升级旧版，拒绝降级。已有禁用状态保留，安装结果会列出需本人启用的组件。
- Harness 正在运行或安装中途启动时停止，正常退出后从同一入口重试；脚本不会结束正在运行的任务。
- 模块与 profile 登记不一致时停止，交由官方插件管理器处理，不手改 profile。第二个包失败会报告已完成与未完成步骤，不冒称整体成功。

## 维护者核验

完整目录包含 `Install.command`、`bundle-manifest.json`、安装脚本、两个固定 tgz 和完整许可证。原始桥接来源与固定差异见[桥接来源说明](https://github.com/oxmumu3/dsh-project-companion/blob/v0.12.0-preview.4/bridge-maintenance/README.md)。有 Node 时可在完整目录运行 `node scripts/install.mjs --bundle-dir . --dry-run`；显式安装加 `--install`。没有独立 Node 时，入口使用官方 App 自带运行时。

本版新增 Google 授权前的数据用途说明，以及普通三件套、单独日历的 Keychain 密钥 + AES-256-GCM 存储。旧普通授权只在明确查询前迁移，状态刷新不写配置；高级手填凭据、会话和历史备份不在该补强范围。源码回归、独立审读与隔离官方 Host 检查见验证记录。日常 App 仍运行此前 `0.12.0-preview.3`，其本人有限读取不能作为本版升级、新用户开箱或手机验收证明；长期运行、滴答任务正文、Drive 文档正文和非空日程仍分别待验。
