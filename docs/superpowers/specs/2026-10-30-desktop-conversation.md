# 恢复 Dot 桌面对话

用户已经明确纠正：今天页不能因共享微信的结果投影而成为只读看板；恢复显著输入、同一原生会话连续对话与历史入口。既有任务、来源权限、Family Owner 身份及未发送草稿保持原有边界。

本轮复用当前官方 SessionReference + SessionProvider + conversation.content embedded factory。今天页挂载一个原生会话实例，保留官方历史、Composer、发送/失败/排队/停止与草稿状态。切去原生会话时先卸载嵌入实例，避免同一会话同时有两个可编辑输入根。旧 SDK 缺少嵌入能力时沿用明确的安全原生草稿入口。

共享微信的只读结果范围和桌面对话范围分别核对。桌面对话仅选择已核实的实际非 Family 本地 Dot 会话；不把 family_owner_* 转成桌面工具权限，不修改资料 grant、不创建主动计划。无既有会话时仅在用户显式开始操作后通过官方会话创建 API 开始本地对话，不自动读取私人来源。

验收覆盖共享/普通/离线入口、同一 session reference 生命周期、无双输入根、旧草稿保留、绑定变化后的失效、新建失败和重复点击。测试均使用合成状态与会话，不触碰日常 Host 或私人内容。

上次新建的桌面对话仅保存 sessionId 指针，使用本插件的官方 configForms 乐观修订接口，不写文本、工具权限或微信绑定。重开时先以官方 sessions.refresh + list metadata 验证真实可见的非 Family、非子代理 session，再 retain；未知、删除或不可验证的指针不创建替身。首次本地 session 使用官方 create({})，由 Host 的 defaultCwd 决定工作目录；仅用户明确开始时调用。新会话不会继承任意已有私人来源 grant，资料工具仍按真实 session 授权。
