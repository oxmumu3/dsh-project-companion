# Google 桌面登录与公开分发说明

> **历史快照：下文保留 2026-10-23、0.12.0-preview.4 当时的实现与状态，不代表当前进度。**
>
> **当前状态（2026-10-28）**：Google 品牌已 verified / published；三项数据权限已正式提交，审核状态为 `UNDER_REVIEW`。尚未获数据权限批准或完成 CASA，已知累计 100 个账号上限并未解除。当前版本、实际验收与安装范围以 [README](../README.md) 为准；下文“尚未提交”“等待品牌验证”“日常 preview.3”等表述仅属于当时记录。

适用版本：`0.12.0-preview.4`。状态更新：2026-10-23；官方分发依据核对日期：2026-10-22。日常 App 未从 preview.3 升级，本版隔离 Host 验收另行记录。

DSH Dot 保留“连接 Google → 浏览器登录并同意 → 回到本机”的体验。应用使用独立 Google Cloud 项目中的 **Desktop app 公共客户端**；不要求普通使用者自己申请 OAuth client 或复制 token，也不通过项目维护者的服务器中转用户的 Google 授权。

本文说明应用注册字段为何可以随桌面程序分发，以及它与用户私人授权的区别。它不代表 Google 已完成对本应用的公开验证。

## 登录与读取如何发生

1. 使用者在 Dot 点击“连接 Google”，本机生成随机 `state` 和 PKCE `code_verifier`，以 S256 challenge 发起授权。
2. 系统浏览器打开 Google 官方登录与同意页面。用户选择自己的账号，并决定是否授予 Gmail、日历事件和 Drive 的只读权限。
3. Google 将一次性授权码回送到本机 `127.0.0.1` 临时端口。本机验证 `state`，使用 PKCE verifier 向 Google 官方 token endpoint 换取授权。
4. 用户的授权由该用户自己的电脑保存；后续读取和离线刷新均由本机直接请求 Google。普通三件套与单独日历的本版安全存储见下文；具体安装与新用户验收另见验证记录，不等于 Google 公众验证已通过。

应用注册字段只能标识 Dot；没有用户本人授予的有效授权，不能据此读取用户的邮箱、日历或云盘。当前实现保留外部浏览器、随机 loopback 端口、一次性授权码、PKCE 和固定 Google token endpoint 等边界。相关实现见 [`google-suite-auth.js`](../src/google-suite-auth.js) 与 [`google-calendar-auth.js`](../src/google-calendar-auth.js)。

## 应用注册与用户 token 是两种东西

| 内容 | 用途 | 分发边界 |
| --- | --- | --- |
| Desktop `client_id` | 标识请求来自哪一个应用注册 | 随应用分发，也会出现在浏览器授权请求中 |
| 该 Desktop 注册的 `client_secret` | Google 部分桌面注册在换码或刷新时要求的协议参数 | 按公共客户端字段处理；不能作为只有正版应用知道的秘密 |
| 用户 `access_token` / `refresh_token` | 在本人同意的范围内访问私人资料 | 不进入源码、安装包、Release、日志或公开验收证据 |
| 一次性授权码、PKCE verifier | 绑定本次授权流程 | 只用于本次本机登录，不能与其他用户共享 |

Google 参数名含有 `secret`，不意味着所有应用类型的同名字段都具有相同保密属性。**Web server 的机密客户端 secret、服务账号私钥和用户 token 不适用这里的桌面分发结论。**

## 官方依据与开源桌面先例

[Google OAuth 总览的 Installed applications 部分](https://developers.google.com/identity/protocols/oauth2/#installed) 明确说明：安装型应用会获得 client ID，有时也有 client secret；这些字段嵌入应用源码，在该场景中 client secret 不按保密秘密对待。[Desktop 专属指南](https://developers.google.com/identity/protocols/oauth2/native-app) 进一步将桌面程序、CLI 和本地后台工具归类为无法保密的公共客户端。

[RFC 8252 §8.5](https://www.rfc-editor.org/rfc/rfc8252.html#section-8.5) 规定，随多个安装实例分发的共享 secret 不能视为机密。授权服务器即使仍要求这一参数，也必须把原生应用当作公共客户端，不能把它作为客户端身份的充分证明。因此，“刷新接口要求带这个参数”与“它可以随原生应用分发”并不矛盾。

实际开源先例是 [GNOME Online Accounts 的 Google 服务说明](https://gnome.pages.gitlab.gnome.org/gnome-online-accounts/services.html#google)：Google 注册由 GNOME Infrastructure 管理，Google 小节明确说明允许将 client secret 嵌入源码。其[账户配置说明](https://gnome.pages.gitlab.gnome.org/gnome-online-accounts/configuration.html) 则将用户的敏感凭据放在用户 keyring。这说明公共应用注册与私人用户授权需要分别处理；**Dot 没有据此宣称自己已实现 GNOME 的 keyring 存储**。

另一个可直接核查的先例是 [Thunderbird 的固定源码](https://github.com/mozilla/releases-comm-central/blob/121349b3561bce19d53ef651a09ca7628f604296/mailnews/base/src/OAuth2Providers.sys.mjs#L228-L243)：Google 条目同时包含桌面注册字段、`usePKCE: true` 和 `useExternalBrowser: true`。Dot 使用自己的注册，不复制这些项目的注册值。

Google 的[通用 OAuth 安全建议](https://developers.google.com/identity/protocols/oauth2/resources/best-practices) 同时要求避免公开机密客户端凭据，并提醒结合具体平台指南。本文采用的是上面明确针对安装型应用的指导，不能将该例外推广到服务端秘密。

## 为什么不增加授权中转服务器

本机直接 OAuth 能满足点击登录、离线刷新及只读 API 访问。仅为了隐藏一个原本无法在分发客户端中保密的字段而增加服务器，会增加运维、可用性、授权日志和 token 处理责任，改变当前数据路径。

因此本版本继续使用应用自己的 Desktop 注册，不复用其他开源项目的注册，不把字段编码或混淆，也不把它移到公开远程配置或下载资产来躲避扫描。若未来确实引入服务端授权代理，必须作为新的架构与数据流重新设计和说明。

公共客户端仍有风险：别的程序可能复用应用标识，影响项目配额、用户判断或应用信誉；Google 也可能限制或撤销应用注册。PKCE 保护的是授权码与当前登录实例的绑定，不应被描述成能防止所有应用冒充。

## GitHub 单项检测例外的条件

GitHub 的 [push protection 官方流程](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/work-with-leak-prevention/push-protection-in-the-github-ui) 允许审查后对非秘密的误报执行单项例外。个人账号级 push protection 可能不显示原因选项；这不等于可以略过审查。

本项目只在以下检查全部成立后，才允许对这一个 Desktop 应用注册执行正常例外流程：

- 在 Google Cloud 确认实际客户端类型为 **Desktop app**，并确认待分发值与该注册一致；代码中的类型标签不能代替此项核对。
- 记录采用 Google 原生应用指南及 RFC 8252 的理由，而不是把服务端秘密笼统叫作“公开配置”。
- 检查源码、历史提交和待发包，确认没有混入用户 token、授权码、个人 profile 或其他机密凭据。
- 保留本机授权、PKCE、回调及实际读取验证记录，明确用户数据的真实去向。
- 只允许已确认的注册字段，不关闭全局密钥保护；发现任何其他秘密时单独处置。

发布审计记录应保留客户端类型的核对结果、指纹匹配、包指纹、例外范围与操作结果，不复制私人授权内容。本说明本身不证明某次 GitHub 推送已经成功；发布状态以公开仓库、标签和下载资产的实际回读为准。

## 本地保存与模型处理边界

此前 `0.12.0-preview.3` 的授权记录按原实现保存在 Harness 本机 profile，没有应用层静态加密保证。本版为普通“连接 Google 三件套”和“只连接 Google 日历”增加安全存储；日常 App 仍运行此前版本；本版已安装在隔离官方 Host 并完成另一账号授权后的重启读取，日常安装与旧明文真实迁移仍须单独验收。

本版路径将这两种授权的 OAuth JSON 用 AES-256-GCM 加密，在 profile 中只保存密文封装及 Keychain 引用。每次保存产生独立的随机密钥，由 macOS Keychain 保存；访问令牌仅在授权控制器内存中缓存。密文与 Harness 配置位置、插件实例及授权种类绑定。普通登录不需要使用者复制密钥或 token；Keychain 无法读取或密文无法验证时，读取失败并要求重连，不回退到明文保存。

已有普通 Google 明文记录只在用户明确查询、即将使用该授权获取 Google 令牌前，经过当前 owner/绑定检查与原生 revision CAS 后迁移；重新点击登录可以用新授权替换旧记录，不先迁移旧记录。单纯查看状态或刷新页面不会迁移、写配置或查询 Google。插件启动可以只读取当前两个加密记录对应的自有 Keychain 项以准备内存状态，不会遍历钥匙串。当前实现限定 macOS；其他平台不以明文降级来冒充相同安全保证。实现见 [`google-token-vault.js`](../src/google-token-vault.js)。

该补强**不覆盖手工填写的高级 `googleRefreshToken` 兼容入口，也不覆盖 flomo、滴答、Harness 会话或历史备份**。不能据此宣称所有凭据和资料都已静态加密。既有明文备份也不会被新连接自动改写。本版隔离官方 Host 的安装及另一账号授权后重启读取已有记录；日常 App 升级、旧明文真实迁移、完整新用户开箱仍需各自验收；具体状态见[公众接入准备](google-public-onboarding.md)。

读取的资料可能进入用户本机 Harness 会话、宿主记录及所配置的模型上下文；通过微信回答还会经过微信桥接和微信通道。如果使用云模型，相关内容会离开电脑。Google 授权令牌不汇总到维护者的 Google 账号，也不经维护者的 Finvo 服务器，但不能把这点写成“所有私人资料永不出电脑”。连接本身不会自动开启持续扫描、日报或定时推送。

清空本机 profile 中的授权字段会移除当前引用并停止使用；它不等于撤销 Google 端许可、清理所有 Keychain 遗留项，或删除已进入会话、模型、微信和备份的内容。遇到取消或宿主写入结果未知的情况，本版实现会保留可能仍被已提交密文需要的 Keychain 密钥，避免产生无法解密的有效记录。不能声称清空一个字段就抹除了所有历史资料。

## 预览版可用范围与公开验证

2026-10-22 最近一次控制台回读为 **External / In production**，显示累计 1 位用户、生命周期 100 位用户上限及需要验证；后续读取没有重新核对 Cloud 名单或新的累计数。Google 登录已退出 Testing 的测试名单制，非名单账号可以尝试发起本人授权，但仍可能看到未验证提示或受到组织管理员、账号保护政策及累计 cap 限制。2026-10-23 本人确认使用另一 Google 账号完成授权；本版隔离官方 Host 重启后，Gmail 近七天搜索、primary 日历未来 24 小时和 Drive 文件名搜索各 limit1 均返回一项，日历为非空结果。该身份区别仅来自本人确认，没有追加 email/sub scope 或独立身份请求，也未核对是否处于 Cloud 测试名单。Gmail 未读完整正文或附件，Drive 未读正文；未调用模型、发送微信或建计划。此单账号结果不能宣传为“所有读者安装后都已经可用”。具体状态见[公众接入准备](google-public-onboarding.md)及 [Google Audience 说明](https://support.google.com/cloud/answer/15549945?hl=en)。

发布 GitHub 安装包、切换 In production、完成品牌或 scope 验证，以及真实新用户授权是不同结果。目前没有确认 Google 品牌和三项 scope 验证已通过。Search Console 已确认项目 URL-prefix 所有权，品牌校验仍等待这项新验证同步；Google 提示可能需 24 小时，scope 验证入口当前不可提交，尚未提交 scope 审核。这不是“24 小时后必定通过”的承诺。先前本人测试账号的有限读取仍只证明当时的验收范围；本版另一账号的有界实读另行记录。切换受众和本次重启读取都不证明任意账号可用、长期可靠，或旧 Testing 授权已获得新的长期有效期。

`gmail.readonly` 和全盘 `drive.readonly` 属于受限权限，分别见 [Gmail scope 分类](https://developers.google.com/workspace/gmail/api/auth/scopes) 与 [Drive scope 分类](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)。[Google 受限权限验证说明](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) 对通过第三方服务器访问或传输受限数据规定了额外评估要求。Dot 可以把内容交给配置的云模型，不能仅凭“桌面插件”身份推定符合纯本机数据处理的豁免。

公开说明必须保留上述未验证提示、累计 cap 和真实新用户验收范围，不能将“本机真实登录和读取已通过”“源码已发布”或“In production”标签等同于“任意账号的公开 Google 登录已获批准”。
