# Google 桌面登录与公开分发说明

适用版本：`0.12.0-preview.3`。资料核对日期：2026-10-22。

DSH Dot 保留“连接 Google → 浏览器登录并同意 → 回到本机”的体验。应用使用独立 Google Cloud 项目中的 **Desktop app 公共客户端**；不要求普通使用者自己申请 OAuth client 或复制 token，也不通过项目维护者的服务器中转用户的 Google 授权。

本文说明应用注册字段为何可以随桌面程序分发，以及它与用户私人授权的区别。它不代表 Google 已完成对本应用的公开验证。

## 登录与读取如何发生

1. 使用者在 Dot 点击“连接 Google”，本机生成随机 `state` 和 PKCE `code_verifier`，以 S256 challenge 发起授权。
2. 系统浏览器打开 Google 官方登录与同意页面。用户选择自己的账号，并决定是否授予 Gmail、日历事件和 Drive 的只读权限。
3. Google 将一次性授权码回送到本机 `127.0.0.1` 临时端口。本机验证 `state`，使用 PKCE verifier 向 Google 官方 token endpoint 换取授权。
4. 用户的授权记录保存在该用户自己的 Harness 本机 profile。后续读取由本机直接访问 Google API；离线刷新也直接请求 Google。

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

用户 token 保存在用户自己的 Harness profile，不汇总到维护者的 Google 账号，也不经维护者的 Finvo 服务器。当前实现不能宣称这些 token 已使用系统钥匙串加密。

读取的资料可能进入用户本机 Harness 会话，并作为上下文发给该用户配置的模型服务；如果使用云模型，相关内容会离开电脑。不能把“授权记录在本机”写成“所有私人资料永不出电脑”。连接 Google 本身也不会自动开启持续扫描、日报或定时推送。

## 预览版可用范围与公开验证

截至本说明日期，应用 Google 注册仍为 **External / Testing**。点击登录功能保留，但 Google 只允许已登记的测试账号授权；陌生下载用户不能因此直接获得访问资格。根据 [Google Audience 说明](https://support.google.com/cloud/answer/15549945?hl=en)，测试名单最多 100 人，涉及这些权限的测试授权及离线 refresh token 通常在七天后过期。

发布 GitHub 安装包与完成 Google 应用验证是两件事。切换 In Production 也不自动消除未验证提示或用户上限。面向公众扩大使用前，需要完成适用的品牌、权限和验证流程。

`gmail.readonly` 和全盘 `drive.readonly` 属于受限权限，分别见 [Gmail scope 分类](https://developers.google.com/workspace/gmail/api/auth/scopes) 与 [Drive scope 分类](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)。[Google 受限权限验证说明](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) 对通过第三方服务器访问或传输受限数据规定了额外评估要求。Dot 可以把内容交给配置的云模型，不能仅凭“桌面插件”身份推定符合纯本机数据处理的豁免。

公开说明必须保留上述测试范围，不能将“本机真实登录和读取已通过”或“源码已发布”等同于“任意账号的公开 Google 登录已获批准”。
