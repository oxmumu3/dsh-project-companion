# 安装 DSH Dot 0.20.0-preview.5

## 在创造模式中安装／更新

复制这段请求交给 Harness：

```text
请安装或更新并启用 DSH Dot。先检查现有插件，避免重复添加和降级。若已安装旧 GitHub 版 dsh-project-companion，沿原包名更新到 https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.20.0-preview.5/dsh-project-companion-0.20.0-preview.5.tgz；否则从 npm 官方源实时查询 @oxmumu3/dsh-project-companion 的 latest，按查到的精确版本安装或更新，不直接采用本机缓存的旧 latest。保留已有微信绑定、账号授权、资料范围、设置和其他插件，不自动读取或新建计划。核对实际版本、启用状态，再打开 DSH Dot。
```

新用户也可在「插件 → 添加插件」填写 `@oxmumu3/dsh-project-companion@0.20.0-preview.5`，安装后启用。它是一个标准插件包，已内置独立微信组件。已有未带 namespace 的历史安装应沿原包更新；不要将两个名称当成同一个插件重复添加。本版提供兼容的原名称更新包，保留原插件配置位置。

下方固定链接用于已有原名称安装的更新或精确版本验收。


牛村木木山制作的 DeepSeek Harness 社区插件，非 DeepSeek 或 OpenAI 官方产品。本版内置微信组件，只需添加一个标准 `.tgz`，不包含 Harness 应用或 Family 家庭助手。

## 在 Harness 中添加一次

1. 首次使用官方 Harness，先打开一次完成初始化与模型配置。
2. 进入「插件 → 添加插件」，粘贴下面这一行，安装并点击「立即启用」。
3. 打开左侧「DSH Dot」，从首页连接微信，或先在电脑对话。后续授权工作区和个人来源分别按需进行。

```text
https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.20.0-preview.5/dsh-project-companion-0.20.0-preview.5.tgz
```

也可[直接下载插件包](https://github.com/oxmumu3/dsh-project-companion/releases/download/v0.20.0-preview.5/dsh-project-companion-0.20.0-preview.5.tgz)，在官方管理器填写下载后的文件实际路径。无需解压 `.tgz`、另装微信组件或运行 macOS 脚本。

[本版发布页](https://github.com/oxmumu3/dsh-project-companion/releases/tag/v0.20.0-preview.5)提供校验文件。插件由 GitHub Release 分发，尚未上架官方插件市场，npm latest 同步为本版；不要用旧版 ZIP 或第二个微信安装包代替这条单插件路径。

## 已有用户

- 已配置的独立微信组件继续使用，包括已禁用、待加载或失败的状态；不会据服务暂未就绪就启动第二个组件。
- 已明确配置的家庭 Owner 共用入口继续沿用，不另开独立微信通道，不修改家人权限。
- 新用户的内置组件由 Dot 生命周期管理。停用 Dot 会一同释放其内置通道；外部独立微信插件不属于 Dot，不会被 Dot 停用或移除。
- 不改写 profile 依赖与插件配置，不调用第二次包安装，不迁移、重置或复制绑定/账号。来源启用、私人读取和持续安排仍分别沿用原有授权边界。
- 老独立组件版本不兼容或自身失败时，本版不会擅自升级它；需要在官方管理器处理该组件，不能把“保留现状”当成故障已修好。

## 宿主与运行条件

- 已支持的官方 SDK 为 `0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.3`。当前官方桌面验证在 macOS 完成，Windows 完整流程未验证；标准插件格式本身不等于所有平台已通过验收。
- 使用官方管理器完成安装、启用；需要重启时先保存工作并正常退出 Harness，不停止其他任务或手改 profile。
- 官方管理器安装仍可能需要联网获取正常依赖。本包不包含 Harness，不执行第二次插件安装，也不带自启动安装脚本。
- 独立受控主动推送需要宿主支持 Node 内置 SQLite；普通聊天可用不等于定时推送已经可用。
- 升级已有用户时保留旧组件和账号状态。旧组件不兼容或损坏时需单独处理，不将它误认成全新环境，也不自动降级或重置配对。

## 安装后先用起来

1. 打开左侧「DSH Dot」。首次首页直接显示微信二维码；已有兼容绑定沿用，第一次由本人扫码，再从微信发一句「你好」。也能先在电脑聊。
2. 想整理项目时，先选择一两个 Harness 已登记工作区并保存，再明确点击「整理这些工作区的项目」。保存选择不读正文、不开模型、不建计划；后续在「连接」增减范围。
3. 项目是持续目标，目录是工作区，会话负责讨论和执行。保留识别建议或写明自己的目标，再从项目详情继续原生对话；不必把所有文件夹一次授权。
4. 需要个人资料时，在「连接」用服务商官方登录，由本人同意并启用所需来源。连接与启用不会自动开启推送。
5. 要回顾、日报或提醒时，用自然语言说清来源、项目、时间或频次，并核对保存的安排。电脑、Harness 和网络需在线。

完整操作见[首次使用](first-use.md)、[逻辑项目](https://github.com/oxmumu3/dsh-project-companion/blob/v0.20.0-preview.5/docs/logical-projects.md)、[个人回顾](https://github.com/oxmumu3/dsh-project-companion/blob/v0.20.0-preview.5/docs/personal-review.md)与[快速开始](https://github.com/oxmumu3/dsh-project-companion/blob/v0.20.0-preview.5/docs/quickstart.md)。

## Google、flomo、滴答

Google 普通三件套支持点击登录；授权保存在本机，普通刷新授权以 macOS Keychain 密钥 + AES-256-GCM 保存。高级手填配置、宿主记录和历史备份不在同一存储保证范围。来源返回内容可能进入配置的模型和微信回复，使用前阅读隐私说明。

Google 品牌已验证，Gmail、日历、Drive 数据权限已提交审核但未批准，CASA未完成、已知累计100个账号上限尚未解除，仍可能出现未验证提示或账号策略限制。不保证任意新账号都可用。若出现 “Google hasn’t verified this app”，核对 DSH Dot、开发者 experts@finvo.ai 和三项只读范围；愿意继续时，由本人选择 Advanced（高级）→ Go to DSH Dot (unsafe) → 继续／允许。这不代表 Google 已批准。保存成功后按用途启用来源。

授权回调依赖当前 Harness 进程存活。旧流程过期、App退出或重启后，从当前 Dot 重新发起，不刷新旧的127.0.0.1回调页；一次失败不会清除旧连接。flomo 需要 MAX，滴答申请 `tasks:read`。均可稍后再连。

## 共用已有家庭微信

本包不安装、升级 Family 或自动配置 Owner 委托。已配置兼容共用入口的维护者组合为 Family `0.2.0-preview.33-diary.6-dot.3-travel.1-review.3`，此前维护者组合升级保留过原绑定、五源账号范围、家人权限与安排；本版仅完成隔离兼容验证，不能将历史结果冒作本版日常升级。未配置的读者先使用普通独立 Dot；家人成员不会获得 Owner 的私人来源或项目权限。详情见[闭环说明](https://github.com/oxmumu3/dsh-project-companion/blob/v0.20.0-preview.5/docs/context-loop.md)。

## 本版验证与已知问题

本版最终单包通过官方隔离 Host 五种安装/兼容场景，三SDK最终相关回归各125项零失败/跳过，32项生命周期测试及独立审读通过。隔离安装不等于维护者已升级日常 App、新用户手机已收到消息或长期自然推送已稳定。

自动回顾仍为实验能力：flomo近期查询曾出现范围投影失败，历史自然模型输出失败尚未全部归因；本版修复了一种无依据精确时间导致的失败，不能据合成验证宣称自然任务已完全修好。新版自然执行、独立新用户扫码到收件、多日与休眠恢复仍分别验收。通道报告发送不等于手机收到。详见[验证记录](https://github.com/oxmumu3/dsh-project-companion/blob/v0.20.0-preview.5/docs/verification.md)。

## 来源与维护

微信能力复用固定维护基线，内嵌版补充二维码取消保护。来源、完整许可与可重建差异见[单插件说明](single-plugin.md)及[第三方声明](../THIRD_PARTY_NOTICES.md)。无需另装 YOLO、proactive 或微信插件整包。

包管理器可能按缓存或发布年龄策略把裸 `@latest` 解析为旧版。创造模式应先在线查询 npm 官方 latest，再安装查询所得的精确版本并回读实际版本；无需清理全局缓存或关闭全局安全策略。
