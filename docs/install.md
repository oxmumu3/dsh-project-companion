# 安装 DSH Dot

本页对应社区预览版 `0.15.0-preview.14`。macOS 完整包包含 Dot 和配套微信桥接。需要已安装的官方 DeepSeek Harness `0.2.0-rc.2`、`0.2.1-rc.2` 或 `0.2.1-rc.3`；新装 Harness 后请先打开一次，再正常退出，官方插件安装依赖这次初始化。作者牛村木木山，非 DeepSeek 或 OpenAI 官方产品。

## 安装入口（0.15.0-preview.14）

如果刚安装官方 Harness，请先打开一次以初始化桌面环境，再保存工作并正常退出 Harness，再打开 macOS「终端」粘贴下面这一行：

```sh
(dsh_dot_dir="$(mktemp -d)" && cd "$dsh_dot_dir" && curl -fLO "https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.15.0-preview.14/dsh-dot-0.15.0-preview.14-macos.zip" && curl -fLO "https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.15.0-preview.14/dsh-dot-0.15.0-preview.14-macos.zip.sha256" && shasum -a 256 -c "dsh-dot-0.15.0-preview.14-macos.zip.sha256" && ditto -x -k "dsh-dot-0.15.0-preview.14-macos.zip" . && open "dsh-dot-0.15.0-preview.14-macos/Install.command")
```

它会下载固定版本、核对 SHA256、解压到独立临时目录并打开 `Install.command`。脚本会显示安装结果；安装结束后打开 Harness，在左侧进入「DSH Dot」。已有微信连接可以沿用；首次使用需要本人扫码、配置自己的模型。若电脑尚未安装 Harness，安装入口会打开官方应用下载页，待本人装好后继续。若已装 App 但尚未首次启动，安装窗口会打开官方 App 并等待：看到主界面后正常退出 Harness，回到同一窗口按回车继续。App 仍在运行时会继续等待本人正常退出，不会自动关闭任务。

也可以直接下载[完整 macOS 安装包](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.15.0-preview.14/dsh-dot-0.15.0-preview.14-macos.zip)，解压并双击 `Install.command`。完整目录须一起保留，不要只移出入口文件。校验文件：[ZIP SHA256](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.15.0-preview.14/dsh-dot-0.15.0-preview.14-macos.zip.sha256)；全部发布资产见[固定版本页面](https://github.com/oxmumu3/dsh-project-companion/releases/tag/v0.15.0-preview.14)。

Google 三项数据权限已正式提交，当前 `UNDER_REVIEW`，尚未批准、完成 CASA 或解除已知累计 100 个账号上限；External / In production 不再逐个登记测试账号，但仍可能有未验证提示和账号策略限制，不保证任意新账号可用。flomo 需要 MAX。均为可选来源，不影响先用本地项目和微信流程。连接或启用不会自动创建私人资料扫描、订阅或推送。历史有限读取与当前审核分开记录，见[历史验证记录](https://github.com/oxmumu3/dsh-project-companion/blob/v0.15.0-preview.14/docs/verification.md)和[当前路线图](https://github.com/oxmumu3/dsh-project-companion/blob/v0.15.0-preview.14/docs/roadmap.md)。

此公开包安装 Dot 与独立 `dsh-wechat`，**不会自动配置共用家庭入口，也不会安装或升级 Family**。已有家庭微信入口需另行配置 Owner 委托；当前本机已核对的 0.15 组合使用 Family `0.2.0-preview.33-diary.6-dot.3` 或其追加旅行能力的 `.3-travel.1`，不是只装这个公开包就能获得。

## Google 预览授权提示

Google 权限审核已经正式提交，当前最后确认状态为审核中。若出现 “Google hasn’t verified this app”，先核对应用名 DSH Dot、开发者 experts@finvo.ai 和 Gmail、日历、Drive 的只读范围；确认愿意继续后，由本人选择 Advanced（高级）→ Go to DSH Dot (unsafe) → 继续／允许。此提示仍有效，继续授权不代表 Google 已批准，也不会解除已知累计100个授权账号上限。可暂不连接 Google，先用本地项目与微信。

若浏览器没有出现“Google 授权已保存”，返回 Dot 连接页重新发起本次授权；不要反复刷新旧回调页。保存成功后按用途启用来源，已有授权失败时不清除原连接。

## 本版验证范围

.14 已通过电脑端调度回归、真实两分钟合成计时、日常升级和原生界面核对；已有微信绑定及来源授权保留。2026-10-29维护者一次变化检查已自动触发并在手机收到一份结果；全新用户从扫码到收件、多日与休眠恢复仍待验证。它是社区预览版，不承诺所有场景稳定。

## 安装后

完整操作见[首次使用](https://github.com/oxmumu3/dsh-project-companion/blob/v0.15.0-preview.14/docs/first-use.md)。

1. 打开 Harness，完成自己的模型登录配置，确认微信桥接与项目助理启用。
2. 从左侧进入「DSH Dot」，沿用微信绑定或扫码；首次连接后从微信发一句「你好」建立会话。
3. 选一个已经添加到 Harness 的项目，先生成首份简报，再按需交办、安排提醒或日报。
4. 手机实际收到和排版由本人核对。安装、组件运行、通道报告发送与手机收到是不同状态。

电脑、Harness 和网络需要保持可用，休眠或退出会影响主动提醒。macOS 安全拦截时先停止核对，不关闭系统安全保护。安装仍可能联网下载依赖；Windows 整合安装未验证。

## 官方插件页面添加

高级用户可在官方插件管理页添加并启用同版本 [companion tgz](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.15.0-preview.14/dsh-project-companion-0.15.0-preview.14.tgz)。微信能力需要同一 Release 的 [dsh-wechat 0.11.1-dot.2](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.15.0-preview.14/dsh-wechat-0.11.1-dot.2.tgz)；推荐使用完整安装包处理版本和依赖。无需额外启用 YOLO 或 proactive 整包。

## 保留与升级规则

- 桥接未安装时安装配套 `0.11.1-dot.2`；已有 `0.11.0` 或 `0.11.1-dot.1` 时升级并沿用绑定；已是 `.2` 则保留。其他版本停止，不降级、不重置配对。
- 项目助理同版本保留，允许升级旧版，拒绝降级。已有禁用状态保留，安装结果会列出需本人启用的组件。
- Harness 正在运行或安装中途启动时停止，正常退出后从同一入口重试；脚本不会结束正在运行的任务。
- 模块与 profile 登记不一致时停止，交由官方插件管理器处理，不手改 profile。第二个包失败会报告已完成与未完成步骤，不冒称整体成功。

## 维护者核验

完整目录包含 `Install.command`、`bundle-manifest.json`、安装脚本、两个固定 tgz 和完整许可证。原始桥接来源与固定差异见[桥接来源说明](https://github.com/oxmumu3/dsh-project-companion/blob/v0.15.0-preview.14/bridge-maintenance/README.md)。有 Node 时可在完整目录运行 `node scripts/install.mjs --bundle-dir . --dry-run`；显式安装加 `--install`。没有独立 Node 时，入口使用官方 App 自带运行时。预览也会检查桌面环境；未初始化返回 `needs_initialization`，不会报 `ready`。发现残留文件或无效登记时会停止并交由官方 App 修复，不自行写入或覆盖 profile。

Google 普通三件套与单独日历使用 Keychain 密钥 + AES-256-GCM 存储；旧普通授权仅在明确查询前迁移，状态刷新不写配置。高级手填凭据、会话和历史备份不在该保证范围。历史有限读取、隔离 Host 和手机记录见[验证记录](https://github.com/oxmumu3/dsh-project-companion/blob/v0.15.0-preview.14/docs/verification.md)，不把它们改写成本版所有场景或任意新用户均通过。

## 共用已有家庭微信入口

普通安装包只处理 Dot 与独立微信桥接，不会安装或升级 Family，也不自动建立 Owner 委托。本版维护者共用组合为 Family `0.2.0-preview.33-diary.6-dot.3`，保留家人独立权限与已有绑定。已有配置继续沿用；未配置的读者先按普通独立 Dot 流程使用。功能范围见[个人资料闭环](https://github.com/oxmumu3/dsh-project-companion/blob/v0.15.0-preview.14/docs/context-loop.md)。

## 验证范围

维护者手机已收到五源分析简报、只读项目交办的一份结果和定时提醒，单次无变化检查已静默完成。空白目录经官方初始化后，由原安装器真实装好两项插件；这不替代第一次扫码、模型登录或第三方本人授权。多日运行与休眠重连尚未验证。完整记录见[验证记录](https://github.com/oxmumu3/dsh-project-companion/blob/v0.15.0-preview.14/docs/verification.md)。
