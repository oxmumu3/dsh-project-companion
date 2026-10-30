# Hallmark 人工审阅：Dot app 原型

最终复核对象：`prototype.html` SHA-256 **`702de7eb0d2150e7f35be65c7dd3ed895ad5eb7de7e570f2cd5857a187527e94`**；`app.css` SHA-256 `6b666fa2012b099e66b0d017b6899a5eae32d0aabc393563bfd8acd4326826c1`。这是明确标注示例数据的可点击交互原型；不是已部署的 Dot，也不构成真实连接、模型执行、计划保存或外部送达验收。只读审阅，未改代码、扫描结果或门槛配置。

## 结论

**唯一自动 WARN 70 可以按误报 dismiss，不是 waive Floor。此前识别的 Floor40 placeholder、Reflex11 hover、Floor63 来源 meta 已在最终文件中修复；本次人工审阅不再有开放的阻塞项。** 非阻塞 Finish 项及原型能力边界仍按下文保留，不据此宣称正式产品已通过。判读标准是 `/Users/shan/.codex/skills/hallmark/references/gates.md` §5。

### Gate 70 的精确证据

- `.hallmark/after-kept-static.json`：0 FAIL / 0 REFLEX / 1 WARN，`render: off`。唯一命中 `prototype.html:631`：`a script prints success ("attention ${state.done?done:}") with no request behind it`。`done` 实际是模板的 CSS 类名，不是“发送成功”文本。
- `prototype.html:594` 首屏明确写“交互方案　示例数据　不读取资料或发送消息”；`:600` 按钮是“演示发送”，不是实际发送承诺。
- `:663` 的 `sendDemo()` 对未命中示例的自由输入保留草稿，明确说明“不会理解或执行自由输入”；只有精确匹配的固定示例进入 `commitDemo()`（`:664`）。
- `:614–617` 每个示例结果附带真实边界：未派发、未调整广告配置、未接受邀请、未修改日历/建立提醒、未执行或改动文件。历史 `:661` 同样标“未发送至外部”。
- 命中所在卡片 `:631` 显示“已处理（示例）”；`:679` 的 local toggle 后明确说“没有修改外部任务”。连接、恢复、暂停也只更改本页合成 state，并说明没有连接真实账号/操作真实计划（`:676–679`）。
- CSP `:6` 的 `form-action 'none'` 禁止真实表单提交；源码没有 `fetch`、XHR、WebSocket、sendBeacon、axios 调用。这里缺 endpoint 是明确演示范围，而非假装后端成功。

可登记理由：**“70 命中模板 CSS 类 done；全局、提交按钮、结果和本地状态反馈均明确示例范围，自由输入不执行。不存在宣称已向外部发送的成功态。”** 该说明仅适用此原型；接真实产品后必须重新验收 endpoint、失败和回执，不能沿用本次 dismiss。

## 人工发现项的最终处置

| 门槛 | 当前证据 | 判定 / 最小处理 |
|---|---|---|
| 40 Floor，已修复 | `app.css:72` placeholder 原先用 edge，对 paper 仅3.10:1；现已改为 muted，约5.18:1 | 源码复核通过。边框3:1不能代替文本4.5:1；仍应让最终DOM测量覆盖伪元素 |
| 63 Floor，已修复 | `prototype.html:620–623` 四个来源 meta 的分隔符已改成换行；`app.css:500` 用 `white-space:pre-line` 展示 | 全部来源类型、时间、位置字词保留，仅格式变化。更正首审计数：**a/b/c原各有2个中点，d原只有1个**，因此原双中点问题实际涉及3条，不能把d也算违规；最终将4条统一分行不改变事实 |
| 63，独立SVG不命中 | 发送/资料导航/电脑试试后的 arrow 是独立SVG，按钮CSS有gap，不是文本里黏着的箭头字符 | 语义是动作或方向图标；不把全部独立动作图标扩大解释成禁用项。初审的这一条开放项已撤回，不是waive |
| 11 Reflex，已修复 | 全局 `button:hover` 改色已移除；nav只背景，primary仅亮度；icon/history/secondary不再叠加统一文字变色 | 源码已收敛为每控件一个信号；真实hover渲染仍由最终Ego复核 |

上述修复均已直接核对最终源码；没有对 Floor 作 waiver。Gate70 是有证据的误报处置；未改官方扫描 JSON 来制造通过。

## App 适用的 J / R-J 判读

| 门槛 | 判读 |
|---|---|
| 11 hover | cbaad5已按上表修复。无卡片普遍抬升/图片缩放 |
| 16 toast | 不属庆祝反馈：现有 toast 主要补充不可见的外部边界（没有改真实账号/计划/任务）或草稿保留。可见状态变化本身不需要 toast；正式实现可收敛为持续边界说明。本原型不因此伪造执行 |
| 23 accent footprint | 声明 Restrained。已查看 daily-1440、first-375 的实际 Ego 截图，蓝色主要用于操作/状态，无大面积强调色；这只是视觉判读，不冒充官方 render 的像素面积测量 |
| 29 / 38iii / 65 | 无光晕/背景色团，无单词局部着色标题；系统无衬线 + 蓝色，不是 cream/serif/terracotta 套式 |
| 47c / 84 | 用户授权设计下一版 Dot 交互，屏幕本身即待实现的原型，首屏有明确示例声明；不是把合成 dashboard 当真实运行截图或成果证明。真实 Host 界面仍需产品集成后另验 |
| 54 | 关注项前的“明天18:00到期”、来源不确定性等携带事实；示例回复/资料范围说明也解释状态与边界，不只是复述下一段标题。未发现应删除的装饰 eyebrow |
| 62 | 无依赖 JS 才解除的 opacity/visibility reveal；`[hidden]` 用于受控浮层、dialog、提示和 composer 停放，非滚动揭示。该单页原型仍依赖 JS 生成主要内容，不应宣传无 JS 可用 |
| 63 | 来源meta已统一分行；status-dot与schedule装饰点由最终CSS `display:none`确认。独立方向SVG按语义不命中；不是例外放过Floor |
| 67 / 69 | 无 tracked caps；重复说明“示例/不执行”承担必要真实性边界，不是重复报价或营销事实填充 |
| 70 | 有明确证据 dismiss；不是 waive |
| 80 | 图标在图标尺度；示意 QR 是所设计连接流程的控件，带“演示/不用于连接”，不是装饰插画或可扫码凭据 |
| 85 | 无邮件订阅收尾，主操作在 app 的输入区，四个导航目的地与对话/事项/来源关系明确 |

App scope 不应用营销 hero/段落节奏/80字屏幕预算/landing page 的 44b fold 等跳过项。用户要求首次 QR 与电脑入口可见，是独立 keep-contract，不借 app scope 跳过。

## Finish（不阻塞，但不隐瞒）

- 已满足或本次不适用：F3 标题 balance；F5 连接图标无彩色 coin；F6 时间使用 tabular nums；F7 当前表面有层级、未见六种同款卡片；F9 无头像热链；F10 无 Lottie；F11 无文本荧光带；F13 无额外 outlier 字体；F16 selection/caret/scrollbar 有主题；F18 无 data-slot 系统；F21 可见 h1→h2→h3；F22 无 justified 文本；F23 有 lang/title/description；F24 浮层与 dialog 最终均无软阴影；F1/F2 没有新引入的英文直引号或三点省略。
- **F4：** 单一 primary recipe；二维码过期时 refresh 与发送可同时成为 filled action，需在过期状态截图确认并判断是否该让次操作降级，不能只看默认图。
- **F12：** 事项/项目行刻意顶对齐容纳多行内容；不是可通过机械 `align-items:center` 修复的同层等高控件行。结合窄屏检查。
- **F14：** `.send-notice` 无保留 `min-height:1lh`，出现提示可能改变输入区高度；是非阻塞的稳定性欠账，未标为已修复。
- **F17/F19/F25/F26：** 静态扫描无法证实。已查看 daily-1440 与 first-375：无明显长文本狭缝，资料名保持完整；仍需 root 对最终九视窗检查字体实际权重、窄屏内容保留与断行。源码含 400/500/550/600/620/650 多种权重，不能声称 ≤3 种实际运行权重已通过。
- F8/F15/F20 按官方 app scope 跳过。

## 保留性与证据边界

- 官方 `.hallmark/before.json` 的 `fields=[]`、`handlers=[]`、`links=[]`、`hooks=[]`，但本页真实存在 textarea/select/submit 和事件委托。其 **0 字段/0 handler 是静态库存盲区，不是“所有字段与事件已验证保留”**。after-kept 只给 script hooks 6/6；六个 hook 不能替代全部 DOM 行为验收。
- 基线 commit `c13b56c` 与中间788db26/cbaad5版本的 inline JS 为29,037 bytes，SHA-256 `413792c21b24dedd90d8d8485aa9b878f5099312e35b418885abd169ee6035f4`。最终 JS 为29,023 bytes，SHA-256 **`a8e220c488ef29039eb0aa1e6dc06c5f930645f23b10f88f01cb041111367fb7`**。提取方式为匹配全部 `<script…>…</script>` 内容、以换行连接、按UTF-8哈希。**最终JS不再与基线字节相同**；独立 diff 确认唯一变化是4条 `sources.*.meta` 字符串的7个中点分隔符改为 `\n`，handler、字段、分支、调用与事实字词不变。这是补证，不能代替浏览器验证。
- `.hallmark/interaction-proof.json` 已实际重跑并绑定最终 **702de7…**：17项合成交互均为pass。此前61350cc的17项不再冒充最终验收；本次读取的是新证据。它仍只证明本页的合成交互，不证明原生Conversation或真实后端能力。
- Root最终补证：`.hallmark/ego-after-record.json` 已绑定最终 **702de7…**，9态截图与测量完成，无横向溢出或已测正文对比度失败；`final-style-proof.json`补充确认16px placeholder为muted约5.18:1、3px键盘焦点、375px可见18个控件均至少44×44px、来源meta分行、浮层单编辑器与发送在屏内。原独审三项已resolved；这些补证由root执行，独审未伪称另开浏览器。
- `after-kept-static.json` 为render off，0 FAIL / 0 REFLEX / 1 WARN70；Ego是独立替代验证，不冒充上游Puppeteer/render tier。自动库存的0字段/0handler盲区仍成立，最终JS差异、keep-contract与17项实际交互共同补证。
- **未新增能力：** 本轮没有把原型接入Harness原生Conversation/Composer、真实来源授权、网络loading/error生命周期或真实执行端点；页面tab仍是本地state，URL状态/刷新恢复未新增。first/daily/issue及连接恢复是明确合成状态。未来集成要在真实Host另验，不能将此原型的Hallmark结果宣传为上述能力完成。


## Root 对剩余 Finish 的答复

F4：过期码刷新和演示发送分属二维码对象、桌面输入两个独立任务，沿用同一primary recipe；保留首屏两种入口，不新增确认。F14：现有用户触发的说明提示仍可能扩展高度，作为原生接线时的非阻塞稳定性欠账保留。F17/F25/F26：最终9态无正文狭缝、横向溢出或隐藏整段内容；手机右栏在主列后继续呈现。F19：保留现有应用字体的多权重，不冒称三权重上限已通过。这些是已答复Finish，未替Floor作waiver。
