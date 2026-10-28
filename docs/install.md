# 安装 DSH Dot 0.14.1-preview.11

这是当前公开下载版；本机日常已装的 `0.15.0-preview.1` 尚未公开，不使用本页公开包降级。适用于 macOS 上已有的官方 DeepSeek Harness `0.2.0-rc.2`、`0.2.1-rc.2` 或 `0.2.1-rc.3`。安装包包含项目助理和配套微信桥接，沿用已有兼容绑定；这是社区预览版，作者牛村木木山，非 DeepSeek 或 OpenAI 官方产品。

## 复制安装指令

先保存工作并正常退出 Harness，再打开 macOS「终端」粘贴下面这一行：

```sh
(dsh_dot_dir="$(mktemp -d)" && cd "$dsh_dot_dir" && curl -fLO "https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.14.1-preview.11/dsh-dot-0.14.1-preview.11-r3-macos.zip" && curl -fLO "https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.14.1-preview.11/dsh-dot-0.14.1-preview.11-r3-macos.zip.sha256" && shasum -a 256 -c "dsh-dot-0.14.1-preview.11-r3-macos.zip.sha256" && ditto -x -k "dsh-dot-0.14.1-preview.11-r3-macos.zip" . && open "dsh-dot-0.14.1-preview.11-r3-macos/Install.command")
```

它会下载固定版本、核对 SHA256、解压到独立临时目录并打开 `Install.command`。脚本会显示安装结果；安装结束后打开 Harness，在左侧进入「DSH Dot」。已有微信连接可以沿用；首次使用需要本人扫码、配置自己的模型。若电脑尚未安装 Harness，安装入口会打开官方应用下载页，待本人装好后继续。

也可以直接下载[完整 macOS 安装包](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.14.1-preview.11/dsh-dot-0.14.1-preview.11-r3-macos.zip)，解压并双击 `Install.command`。完整目录须一起保留，不要只移出入口文件。校验文件：[ZIP SHA256](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.14.1-preview.11/dsh-dot-0.14.1-preview.11-r3-macos.zip.sha256)；全部发布资产见[固定版本页面](https://github.com/oxmumu3/dsh-project-companion/releases/tag/v0.14.1-preview.11)。

Google 三项数据权限已正式提交，当前 `UNDER_REVIEW`，尚未批准、完成 CASA 或解除已知累计 100 个账号上限；External / In production 不再逐个登记测试账号，但仍可能有未验证提示和账号策略限制，不保证任意新账号可用。flomo 需要 MAX。均为可选来源，不影响先用本地项目和微信流程。连接或启用不会自动创建私人资料扫描、订阅或推送。历史有限读取与当前审核分开记录，见[历史验证记录](verification.md)和[当前路线图](roadmap.md)。

此公开包安装 Dot 与独立 `dsh-wechat`，**不会自动配置共用家庭入口，也不会安装或升级 Family**。已有家庭微信入口需另行配置 Owner 委托；当前本机 0.15 组合要求精确的 Family `0.2.0-preview.33-diary.6-dot.2`，不是只装这个公开包就能获得。

## 安装后

完整操作见[首次使用](first-use.md)。

1. 打开 Harness，完成自己的模型登录配置，确认微信桥接与项目助理启用。
2. 从左侧进入「DSH Dot」，沿用微信绑定或扫码；首次连接后从微信发一句「你好」建立会话。
3. 选一个已经添加到 Harness 的项目，先生成首份简报，再按需交办、安排提醒或日报。
4. 手机实际收到和排版由本人核对。安装、组件运行、通道报告发送与手机收到是不同状态。

电脑、Harness 和网络需要保持可用，休眠或退出会影响主动提醒。macOS 安全拦截时先停止核对，不关闭系统安全保护。安装仍可能联网下载依赖；Windows 整合安装未验证。

## 官方插件页面添加

高级用户可在官方插件管理页添加并启用同版本 [companion tgz](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.14.1-preview.11/dsh-project-companion-0.14.1-preview.11.tgz)。微信能力需要同一 Release 的 [dsh-wechat 0.11.1-dot.2](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.14.1-preview.11/dsh-wechat-0.11.1-dot.2.tgz)；推荐使用完整安装包处理版本和依赖。无需额外启用 YOLO 或 proactive 整包。

## 保留与升级规则

- 桥接未安装时安装配套 `0.11.1-dot.2`；已有 `0.11.0` 或 `0.11.1-dot.1` 时升级并沿用绑定；已是 `.2` 则保留。其他版本停止，不降级、不重置配对。
- 项目助理同版本保留，允许升级旧版，拒绝降级。已有禁用状态保留，安装结果会列出需本人启用的组件。
- Harness 正在运行或安装中途启动时停止，正常退出后从同一入口重试；脚本不会结束正在运行的任务。
- 模块与 profile 登记不一致时停止，交由官方插件管理器处理，不手改 profile。第二个包失败会报告已完成与未完成步骤，不冒称整体成功。

## 维护者核验

完整目录包含 `Install.command`、`bundle-manifest.json`、安装脚本、两个固定 tgz 和完整许可证。原始桥接来源与固定差异见[桥接来源说明](https://github.com/oxmumu3/dsh-project-companion/blob/v0.14.1-preview.11/bridge-maintenance/README.md)。有 Node 时可在完整目录运行 `node scripts/install.mjs --bundle-dir . --dry-run`；显式安装加 `--install`。没有独立 Node 时，入口使用官方 App 自带运行时。

Google 普通三件套与单独日历使用 Keychain 密钥 + AES-256-GCM 存储；旧普通授权仅在明确查询前迁移，状态刷新不写配置。高级手填凭据、会话和历史备份不在该保证范围。历史有限读取、隔离 Host 和手机记录见[验证记录](verification.md)，不把它们改写成本版所有场景或任意新用户均通过。

## 未公开的本机 0.15 组合

本机已通过官方入口升级 Dot `0.15.0-preview.1` 与精确配套 Family `0.2.0-preview.33-diary.6-dot.2`，重开后原微信、五源授权及计划保留；本版手机单份结果、提醒和一次跟进仍待本人确认。三套 SDK、隔离官方 Host 与日常 UI 核验不等于长期稳定或新用户完整开箱通过。

0.15 只有已核验的本地候选包，没有公开下载入口。普通 Dot 安装器只处理其清单内的 Dot 与独立微信桥接，不处理 Family 升级。维护者使用候选时须分别核对两个精确包，通过官方安装入口保留原绑定；不手改 profile、借用隔离宿主凭据或用版本豁免替代兼容检查。使用方式见[个人资料闭环](context-loop.md)。
