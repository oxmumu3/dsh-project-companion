# Google 公众接入准备

本文记录 `0.12.0-preview.4` 的实现范围与公众接入状态；日常 App 仍运行此前 `0.12.0-preview.3`，不是本版已升级的证明。

本文件用于核对公众 Google 登录与审核材料，不代表 Google 已经批准应用。2026-10-22 本轮控制台已回读专用 `dsh-dot` 项目为 External / In production，显示累计 1 位用户、生命周期 100 位用户 cap 及需要验证。Google Search Console 已确认项目 URL-prefix 所有权；这不等于拥有整个 GitHub 平台域名。品牌、三项 scope 验证通过以及非测试名单账号的真实授权读取仍未确认。品牌校验仍等待新完成的站点所有权验证同步；Google 提示可能需 24 小时，scope 验证入口当前不可提交，尚未提交 scope 审核。这不表示等待时间结束即自动通过，也不能据此宣传任意读者安装后已经可用。

维护者为奥克斯木木山，正式代码归属为 [oxmumu3/dsh-project-companion](https://github.com/oxmumu3/dsh-project-companion)。对外首页和隐私说明使用独立的 Dot 页面，不改 Finvo 既有网站、应用注册、IAM 或账单配置。

## 完成标准

“公开代码与安装包”“Google 退出测试名单制”“Google 品牌和 scope 审核通过”“非测试名单账号真实授权读取”需要分别核验。只有安装包可下载，不能当作公众登录已经完成。

根据 [Google Audience 说明](https://support.google.com/cloud/answer/15549945?hl=en)，Testing 只允许登记测试账号，相关测试授权通常七天过期。In Production 可以允许非名单用户尝试；敏感或受限 scope 未验证时仍有未验证提示、项目生命周期累计用户上限及组织账号策略限制。将项目切到 Production 不等于获得无限量、无警告的正式开放，也不能代替应做的验证。

需逐项保留证据：

| 项目 | 需要的证据 |
| --- | --- |
| 官网和隐私说明 | 两页实际可公开访问；产品名、数据用途、维护者和联系入口一致；自有入口归属 oxmumu3。 |
| 域名 | Search Console 或 Google 接受的所有权验证成功；授权域名与公开页面一致。 |
| Branding | 应用名称、支持邮箱、首页、同域隐私链接的保存和实际验证结果；仅填表不算已验证。 |
| Audience | 控制台明确显示 In Production；保留尚未验证的警告和 cap 状态。 |
| Data Access | 登记代码确实请求的三项只读 scope；不以声明 scope 代替 Google 批准。 |
| 代码安全 | 普通 Google 点击登录的加密存储、本人同意、CAS、撤销/清除和错误路径验收；源码和隔离宿主检查不等于日常已升级或新用户实测。 |
| 新账号 | 不在测试名单的使用者本人完成同意；再分别核对有界 Gmail、主日历和 Drive 读取。 |
| 审核 | 正确材料实际提交、Google 的受理和最终决定分别记录。若要求付费安全评估，先明确费用和评估范围。 |

目前明确完成的配置结果仅限本轮已回读的 In production 受众及 Search Console 项目 URL-prefix 所有权；不能由此补全表中其他验收结果。审计记录、控制台结果和真实新用户验收应分别给出时间、精确版本及来源，不复制 token、私人正文或其他用户身份资料。

## 审核架构和数据流

普通 Google 登录使用产品自己的 Desktop 公共客户端，不使用维护者个人授权或其他开源项目的客户端身份。用户点击连接后，在系统浏览器中的 Google 页面选择账号和只读权限。回调仅绑定本机随机 `127.0.0.1` 端口，使用 state、S256 PKCE 和一次性 code；本机向固定 Google HTTPS token endpoint 换码和刷新。

本版安全存储仅覆盖普通三件套与单独日历：授权 JSON 使用 AES-256-GCM 加密后进入 Harness profile，独立随机密钥保存在 macOS Keychain。访问令牌保留在控制器内存中；这两个普通授权字段保存密文，而非明文刷新令牌。当前这两个字段的旧明文只在用户明确查询、即将使用授权获取 Google 令牌前，经受控流程迁移；重新登录可用新授权替换，不先迁旧记录。状态刷新不迁移。保存通过原生 revision CAS 防止覆盖用户更改；宿主写入结果未知时保留可能仍被引用的密钥。实现与限制见[桌面授权分发说明](google-desktop-oauth.md)。

该补强不覆盖手填高级 `googleRefreshToken`、flomo/滴答凭据，也不加密 Harness 的会话、宿主记录或既有备份。不能将本版存储设计描述成所有凭据已使用系统钥匙串，或所有 Google 资料均经过应用层加密。无法访问 Keychain 时，普通 Google 路径应失败并提示重连，不能降级为明文保存。

真实读取由用户已启用的来源执行，仅访问固定官方只读 REST 地址，限制查询范围、时间段、数量和正文长度。读取结果进入 Harness 会话及所配置的模型上下文；云模型会收到相关内容。通过微信回答还会经过已配置的桥接和微信通道。维护者没有集中代存用户 Google token 或正文的 Dot 后端，但这些第三方路径仍须在审核中披露。

## 三项权限的必要性

| Scope | 用户可见功能与最小范围说明 |
| --- | --- |
| `gmail.readonly` | 根据用户查询检索有限匹配邮件，读取明确邮件的限长纯文本并回答或摘要；不发送、修改或删除邮件，不下载附件。仅邮件元数据权限不足以回答已选择邮件正文中的问题。 |
| `calendar.events.readonly` | 查询主日历内指定窗口事件，默认未来 24 小时，最多七天、十项；不创建、修改或删除日程。当前不声称读取全部共享日历。 |
| `drive.readonly` | 检索用户原有云盘文件并按明确文件读取支持内容；不修改、删除或分享文件。仅允许应用创建或逐文件选择的权限无法直接支持已有云盘内容的普通检索。每次仍由代码限制返回数量和文件内容范围。 |

Gmail 和全盘 Drive 只读属于受限 scope。不能为了通过审核填写更小权限，却在实际请求中继续使用更大的权限；也不能用“桌面插件”标签自动声明豁免。

## 隐私披露与肯定同意

授权前的显著说明应与实际界面相邻，清楚告诉使用者：申请哪些只读权限、何时读取、资料将进入其配置的模型以及可能经微信返回。使用者须对该数据处理方式作肯定选择，再前往 Google 同意页。不能只把这些信息藏在高级设置或隐私政策中。

用途限定于用户请求、可见的邮件问答与摘要、日历查询、文件检索和内容问答。维护者不出售 Google 资料，不用于广告、信用评估，或训练超出该具体用户适当个性化用途的 AI 模型。使用者所选的模型和其他接收方同样必须满足 Google Limited Use 要求；用户同意不能免除应用自己的义务，也不能替独立模型服务商保证其训练、访问或保留政策。

停用来源、清空本机授权字段、在 Google 撤权、删除历史内容是不同操作。清空 profile 移除的是当前引用，不会抹除所有 Keychain 遗留项、会话、模型或微信中已传递的内容及备份。公开说明应给出各位置的管理办法，不能承诺一个按钮删除所有副本。当前没有统一的 Google 内容自动保留期限；须进一步核对宿主会话、日志、项目摘录及备份与 Google 缓存/保留要求的关系。

## 审核说明和演示材料

提交说明至少应包含：英文功能概述、上表逐项 scope 必要性、Desktop + PKCE + loopback 架构、普通 Google token 的安全存储与高级入口边界，以及资料流向配置模型和微信的事实。受限数据经过第三方服务时，应由 Google 判定具体验证和安全评估范围，不能自行声明全部数据留在设备而获得豁免。

英文演示应覆盖以下实际操作，并使用独立的脱敏测试资料：

1. 安装精确版本，展示 Google 连接前的用途说明、隐私链接与肯定同意。
2. 进入 Google 官方页面，展示应用身份和三个实际请求的只读 scope；由账号本人完成授权，画面隐藏私人身份、token 和授权码。
3. 分别执行一项有界 Gmail 查询/明确正文读取、主日历查询、Drive 检索/明确支持文档读取，并展示结果用于该用户的请求。
4. 说明模型和微信接收路径；不把通道“报告发送”当成手机已收到。
5. 演示来源停用、本机引用清除与 Google 撤权的区别，以及 Keychain 不可用时没有明文降级。

English application summary for review:

> DSH Dot is an open-source desktop plugin for DeepSeek Harness. It answers user-requested questions about authorized Gmail messages, primary-calendar events and selected Drive content. The desktop application obtains consent through Google's external-browser OAuth flow with PKCE and a loopback callback. Google token and API requests go directly from the user's computer to Google. The ordinary-login path in this version stores encrypted OAuth records locally, with separate random encryption keys in macOS Keychain. Retrieved results may enter the user's Harness conversation, configured model service, and connected WeChat channel. The maintainer does not operate a central Google-token or private-content server. These data flows, third-party recipients, legacy configuration limits and retention limitations must be reviewed as implemented; they are not claimed to have received Google approval.

## 官方依据

- [Google OAuth 应用状态](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)
- [品牌验证](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [敏感 scope 验证](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [受限 scope 验证](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Google Workspace 用户数据和开发者政策](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)

这些来源用于明确要求；文件存在、演示脚本准备好或材料已提交，均不能替代 Google 的审核决定及真实新用户验收。
