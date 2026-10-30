# Dot 原型到真实产品：五个必须接通的缺口

依据 2026-10-30 的 DESIGN.md 与本机源码审查；当前原型是合成演示，不读账户、不发消息、不建立计划。以下不是新需求清单，是设计中看似可用、正式上线前必须证明的连接。随后已对成品做只读独审及桌面/窄屏走查，结果见 QA.md；真实后端仍未接入。

1. **首页与浮层“同一对话”需要真实所有权交接。** 当前两处抢同一个原生编辑器时，后者会显示“对话已在工作台打开”；关闭与切页还需处理 retain/release 竞态。正式实现须在首页已有编辑器时让入口聚焦它或隐藏重复入口；其它页面复用同一个经验证的 native session，确认旧编辑器卸载后再挂新位置，保留原生草稿、附件和审批。`src/client.js` 的 `createDesktopConversationController`、`DesktopConversation` 和 `OverlayDesktopConversation` 是现有接点。**交付措辞：**“可点击原型演示同一对话”不等于“日常 Harness 已完成无缝切换”；必须通过真实 Host 单编辑器、草稿和输入法测试。

2. **桌面与微信是两条会话身份，“继续聊”不能靠自动迁移冒充同一记录。** 当前首页可恢复旧 native session，微信通过 Family Owner 路由与另一个 session/绑定；资料 lease 与授权受 session、Owner 和来源共同约束。针对事项的按钮需要服务端携带经验证的事项及其来源，用原生安全草稿接口在正确会话中继续；不得把家庭成员对话、旧微信会话或私人授权自动复制给桌面对话。目标会话已有未发送草稿时须保留，并给出能继续操作的提示。`index.js` 的 `reviewAuthorization`、`family-owner-delegation.js` 和 `prepareDotDraft` 是关键守卫。**交付措辞：**可说“桌面与微信可围绕同一事项协作”，只有实际实现并验收消息、状态与权限映射后才能说“聊天记录自动同步”。

3. **“Dot 已发现”卡片的依据尚未作为完整卡片数据投影。** 回顾账本内部有 summary、why、action 和 evidence 引用，但当前 `personalReview` 的工作台安全投影只暴露事项 id、title、status、dueAt 等，且整个投影依赖已验证的工作台绑定。要展示“发生了什么 / 为什么现在 / 来源 / 下一步”，需在当前授权范围下新增有界、脱敏的只读投影，验证证据仍属于同一 Owner、source grant 和当前事项；读取失败或资料截断要如实显示，不能把示例文案当真实发现。`index.js` 的 `workbench.snapshot` 与 `src/personal-review-ledger.js` 是接点。**交付措辞：**原型里的事项和来源是演示；在真实授权、真实生成与用户验收前，不宣称 Dot 已发现这些问题。

4. **统一“已有安排”时间线不能直接混用旧 Dot 和 Family 计划。** 当前 `src/workbench.js` 对 Family 的 `readOnly` 投影有意隐藏旧 Dot 的 reminders/daily，Family 成员与 Owner 的计划也有不同可见范围；页面现有“安排提醒 / 设置日报”仍主要是生成草稿，具体修改依赖原会话和用户明确请求。若原型将日报、提醒和项目跟进排成一个时间线，必须分别接入可信的 Owner 只读计划、当前 scope 和时区，并保留来源、禁用/阻塞及未确认状态；取消或调整还需各自的真实权限和回执。**交付措辞：**只在真实接口核对过时称“已安排”；通道报告发出不等于手机收到，更不能说未验证的计划已运行。

5. **单条连接提示只是展示，不能修复上游的整体授权耦合。** 当前 `family-workbench-route.js` 的工作台身份检查仍经 `scopeFor/current/recheck` 依赖全部已有私源 lease，某一项失效可能让多个区域同时 unknown；把文案合并不能让它们变成可读，更不能以公开资讯的窄 Owner 路由借权访问私源。设置页必须用实时、各来源独立的只读状态给出具体恢复动作，保留“未知 / 本机已配置 / 当前 scope 已启用 / 远端实读成功”的区别。此前仅确认本机滴答 configured/enabled、flomo configured/disabled，不能据此说 flomo 账号已失效或自动重新绑定。**交付措辞：**状态 banner 是汇总，不代表后台已解除耦合，也不承诺已验证远端授权。
