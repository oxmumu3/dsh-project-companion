# 安装 DSH Dot 单插件候选 0.20.0-preview.3

牛村木木山制作的 DeepSeek Harness 社区插件，非 DeepSeek 或 OpenAI 官方产品。本候选内置固定版本的微信组件，只需添加一个标准 `.tgz`，不包含 Harness 应用或 Family 家庭助手。

## 在 Harness 中添加一次

1. 首次使用官方 Harness，先打开一次完成初始化与模型配置。
2. 进入「插件 → 添加插件」，填写收到的 `dsh-project-companion-0.20.0-preview.3.tgz` 实际文件路径，安装并启用。无需解压这个插件包，也无需另外安装微信组件或运行 macOS 脚本。
3. 打开左侧「DSH Dot」，从首页连接微信，或先在电脑对话。后续授权工作区和个人来源分别按需进行。

本版尚未公开发布、未上架官方插件市场，也未更新 npm。当前[公开版 0.20.0-preview.2](https://github.com/oxmumu3/dsh-project-companion/releases/tag/v0.20.0-preview.2)的两组件包与 ZIP 安装说明是旧版本入口，不要把它当成本候选的下载链接。

## 已有用户

- 已配置的独立微信组件继续使用，包括已禁用、待加载或失败的状态；不会据服务暂未就绪就启动第二个组件。
- 已明确配置的家庭 Owner 共用入口继续沿用，不另开独立微信通道，不修改家人权限。
- 新用户的内置组件由 Dot 生命周期管理。停用 Dot 会一同释放其内置通道；外部独立微信插件不属于 Dot，不会被 Dot 停用或移除。
- 不改写 profile 依赖与插件配置，不调用第二次包安装，不迁移、重置或复制绑定/账号。来源启用、私人读取和持续安排仍分别沿用原有授权边界。
- 老独立组件版本不兼容或自身失败时，本候选不会擅自升级它；需要在官方管理器处理该组件，不能把“保留现状”当成故障已修好。

## 宿主与运行条件

- 官方 Harness SDK 支持 `0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.3`；Windows 整合包未验证。没有 App 时，安装入口只引导安装官方应用，并非一体机。安装依赖可能需要联网。
- 初次打开 Harness 前，安装器会要求先初始化；App 正在使用时等待本人正常退出，不结束任务，不绕过安装保护。
- 维护桥 `.3` 可从已审计的原版 `0.11.0`、`0.11.1-dot.1`、`.2` 升级并保留原配对；同版本保留，其他不支持的版本停止，不降级、不重置绑定。不要让新旧宿主同时使用同一配对目录。
- Dot 允许升级旧版，同版保留，拒绝降级；原禁用状态、账号授权和安排保留。安装后在官方插件管理器核对启用与组件运行。
- 模块与登记不一致、或中途安装失败时，会显示具体状态；交由官方管理器修复，不手改 profile。安装器不会为了本版关闭其他插件。
- 独立受控主动推送需要 Node 内置 SQLite。入口优先使用官方 App 自带运行时；缺少相关运行能力时不能据普通聊天正常就认定主动推送可用。
- 安装入口未签名、公证。遇到 macOS 安全拦截时先停止核对，不关闭系统安全保护。

## 安装后先用起来

1. 打开左侧「DSH Dot」。首次首页直接显示微信二维码；已有兼容绑定沿用，第一次由本人扫码，再从微信发一句「你好」。也能先在电脑聊。
2. 想整理项目时，先选择一两个 Harness 已登记工作区并保存，再明确点击「整理这些工作区的项目」。保存选择不读正文、不开模型、不建计划；后续在「连接」增减范围。
3. 项目是持续目标，目录是工作区，会话负责讨论和执行。保留识别建议或写明自己的目标，再从项目详情继续原生对话；不必把所有文件夹一次授权。
4. 需要个人资料时，在「连接」用服务商官方登录，由本人同意并启用所需来源。连接与启用不会自动开启推送。
5. 要回顾、日报或提醒时，用自然语言说清来源、项目、时间或频次，并核对保存的安排。电脑、Harness 和网络需在线。

完整操作见[首次使用](first-use.md)、[逻辑项目](https://github.com/oxmumu3/dsh-project-companion/blob/v0.20.0-preview.2/docs/logical-projects.md)、[个人回顾](https://github.com/oxmumu3/dsh-project-companion/blob/v0.20.0-preview.2/docs/personal-review.md)与[快速开始](https://github.com/oxmumu3/dsh-project-companion/blob/v0.20.0-preview.2/docs/quickstart.md)。

## Google、flomo、滴答

Google 普通三件套支持点击登录；授权保存在本机，普通刷新授权以 macOS Keychain 密钥 + AES-256-GCM 保存。高级手填配置、宿主记录和历史备份不在同一存储保证范围。来源返回内容可能进入配置的模型和微信回复，使用前阅读隐私说明。

Google 品牌已验证，Gmail、日历、Drive 数据权限已提交审核但未批准，CASA未完成、已知累计100个账号上限尚未解除，仍可能出现未验证提示或账号策略限制。不保证任意新账号都可用。若出现 “Google hasn’t verified this app”，核对 DSH Dot、开发者 experts@finvo.ai 和三项只读范围；愿意继续时，由本人选择 Advanced（高级）→ Go to DSH Dot (unsafe) → 继续／允许。这不代表 Google 已批准。保存成功后按用途启用来源。

授权回调依赖当前 Harness 进程存活。旧流程过期、App退出或重启后，从当前 Dot 重新发起，不刷新旧的127.0.0.1回调页；一次失败不会清除旧连接。flomo 需要 MAX，滴答申请 `tasks:read`。均可稍后再连。

## 共用已有家庭微信

本包不安装、升级 Family 或自动配置 Owner 委托。已配置兼容共用入口的维护者组合为 Family `0.2.0-preview.33-diary.6-dot.3-travel.1-review.3`，原四绑定、五源账号范围、家人权限与安排在本轮本机升级后保留。未配置的读者先使用普通独立 Dot；家人成员不会获得 Owner 的私人来源或项目权限。详情见[闭环说明](https://github.com/oxmumu3/dsh-project-companion/blob/v0.20.0-preview.2/docs/context-loop.md)。

## 本版验证与已知问题

0.20.0-preview.2 基线运行代码三SDK各2165项通过；本候选增加组件选择与生命周期接线，单独记录新验证证据。隔离安装不等于本版已升级日常 App 或完成手机收件。

自动回顾仍为实验能力：flomo近期查询曾出现范围投影失败，历史自然模型输出失败尚未全部归因；本版修复了一种无依据精确时间导致的失败，不能据合成验证宣称自然任务已完全修好。新版自然执行、独立新用户扫码到收件、多日与休眠恢复仍分别验收。通道报告发送不等于手机收到。详见[验证记录](https://github.com/oxmumu3/dsh-project-companion/blob/v0.20.0-preview.2/docs/verification.md)。

## 旧版辅助包与维护者安装（0.20.0-preview.2）

高级用户可通过官方插件页添加同一 Release 的 [Dot tgz](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.20.0-preview.2/dsh-project-companion-0.20.0-preview.2.tgz) 和 [维护桥 .3](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.20.0-preview.2/dsh-wechat-0.11.1-dot.3.tgz)。推荐完整包处理版本与依赖；无需额外启用 YOLO 或 proactive 整包。

完整目录包含 `Install.command`、`bundle-manifest.json`、两个固定tgz、脚本和完整许可证。可运行 `node scripts/install.mjs --bundle-dir . --dry-run`；显式安装使用 `--install`。桥接固定来源见[第三方声明](../THIRD_PARTY_NOTICES.md)与[桥接说明](https://github.com/oxmumu3/dsh-project-companion/blob/v0.20.0-preview.2/bridge-maintenance/README.md)。
