# DSH Dot 原型重设计保留契约

基线：`output/dsh-dot-ux-reset-2026-10-30/prototype.html`，只读时 SHA-256 `6728b7aae03566b80c605c6d2daa30c3f529fad352f245bb0d66be71023aaae5`；以最终实施前再核对的文件为准。它是本地可点击方案，资料和扫码均为演示，不证明真实授权、读取、投递或安装。`DESIGN.md` 的首次使用补充覆盖此前“按需连接入口”的旧描述。

## 产品面与主路径

- 四个产品页是「今天 / 项目 / 记忆 / 连接」，分别承载立即交代与待关注、项目推进、可追溯记忆、来源连接。不能改成产品介绍页，不能把真实主操作变成宣传或展示样例。
- 首次使用：首屏直接放示意微信二维码和“先在电脑上试试”；1280×720 首屏能看码和输入/发送，390×844 可看码及桌面替代入口。等待 → 过期 → 原地刷新 → 演示成功收起；成功不能发送消息、创建计划或清除草稿。已有家庭管家绑定是否可复用须在正式实现由后端核验，不能在原型中伪造确认。
- 日常/异常：具体事项有来源、边界和下一步；异常一条提示并保留上次结果，未知不是空数据；连接/计划需显式区分示例、已启用和真实执行。日常不反复显示扫码卡。
- 首页与非首页浮层共用一个可编辑输入；首页按钮聚焦已有输入，其他页打开浮层，关闭和回工作台保留草稿。正式产品必须保留宿主原生会话、审批和附件链；桌面与微信围绕同一事项不代表历史已同步，家人权限独立。
- 起步示例仅填草稿，替换现有草稿时可恢复；自由输入只保留、不伪装执行；演示提交才产生合成结果。记录可打开，不自动铺满首页或重做旧任务。状态切换和二维码演示保留草稿；仅“重置演示”明确重置。

## 实际 JS 依赖，改结构必须同步迁移

- 固定节点与事件：`demo-state`, `reset-demo`, `connection-status`, `open-history`, `tab-today`, `tab-projects`, `tab-memory`, `tab-connections`, `page`, `composer-parking`, `shared-composer`, `dot-input`, `draft-recovery`, `draft-recovery-label`, `restore-draft`, `send-notice`, `floating`, `floating-title`, `open-workbench`, `close-floating`, `floating-body`, `floating-mount`, `launcher`, `history-dialog`, `history-title`, `history-content`, `detail-dialog`, `detail-title`, `detail-content`, `toast`；动态生成的 `home-mount`, `first-connect-title`, `first-wechat-code`。这些 ID 被脚本或 ARIA 引用，不是装饰。
- 事件委托与状态映射：`data-icon`, `data-page`（today/projects/memory/connections）, `data-close-dialog`, `data-source`（a/b/c/d）, `data-prepare`（risk）, `data-starter`（priorities/schedule/project）, `data-connect`（wechat/google/flomo/dida）, `data-simulate-connect`, `data-action`。后者包含 `focus`, `history`, `done`, `pause`, `retry`, `show-attention`, `project-detail`, `memory-detail`, `qr-complete`, `qr-expire`, `qr-refresh`；改变或移除需同步脚本与回归。
- `render()` 先把同一 `shared-composer` 移到隐藏 parking，再按页面/浮层移动到 `home-mount` 或 `floating-mount`；不能复制成两个同时可编辑节点。保留 `state` 中页面、草稿/备份、示例状态、二维码、连接、结果、事项与安排状态跨重绘语义。
- 保护键盘行为：IME 组合 Enter 不发送；Enter/Shift+Enter 语义；Tab 箭头/Home/End 与 `aria-selected`、`aria-labelledby`；Escape 关闭浮层并回到启动按钮；焦点及 `role=status`、modal 语义保留；尊重减少动态效果。保持示意码“不可用于连接”和演示数据标注。

## 超出上轮 CSS 润色、但不改变工作流的设计机会（最多四项）

1. **明确首屏主次**：把“现在可以直接交代”和微信扫码设计为两个协调但有主次的区域，以字号、布局节奏而非大面积色块控制；仍在首屏同时可见，勿让口号挤下输入。
2. **给需要关注的事项一个稳定阅读语法**：标题、发生了什么、依据/不确定、下一步形成统一的信息节奏；降低卡片边框密度，以时间、状态、分隔线建立秩序，而不是再加一层说明。
3. **把项目/记忆/连接统一为工作区家族**：共享标题尺度、行高、图标和操作位置，但各页保留自己的任务语义；来源范围和状态应该让人可读，不依靠纯颜色。
4. **精炼纸白＋深墨＋DeepSeek 蓝的材质和细节**：建立清晰的字体尺度、留白、边框及关键蓝色层级，减少机械的等权重圆角小卡；优先使用系统字体、保证对比与焦点、移动端可触达。装饰不得冒充官方标识或状态。

## 验收边界

按首用、日常、连接异常、项目/记忆/连接四页、来源详情、草稿恢复、浮层与键盘路径复走；检查桌面和窄屏首屏及实际动效。原型的可点击与视觉检查不能宣称原生 Host 接线、个人授权、微信真实收发或主动提醒已验收。
