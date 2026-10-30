# Hallmark 完整应用界面重设计

用户明确指定 Hallmark，保留已确认动线与首屏二维码。本次采用 full redesign / app scope，沿用纸白、深墨和单一蓝色，不套营销页结构，不新增功能或真实权限。

## 结果

首次使用将微信配对与电脑交代置于同一工作区；日常由输入、具体事项与下一次安排形成主次。项目、记忆和连接页采用相同的字号、控件与间距系统。原四页、首屏示意码、过期原地刷新、成功收起、草稿恢复和同一编辑器在首页/浮层之间移动的行为保留。

## 真正执行过的检查

- 官方 brand/app scaffold、static before 和最终 --kept；最终静态 0 FAIL、0 REFLEX，1 条 gate70 WARN 经人工按明确演示态 dismiss，未豁免 Floor。
- Ego 实际浏览器的 9 个视窗/状态截图，涵盖 375、1280、1440、1920 宽，另检查 320/768 横向溢出。最终截图与源码 hash 绑定。
- 17 项交互走查：二维码过期/刷新/完成、原草稿保留、单编辑器移动、Escape 焦点、示例草稿恢复、自由输入不伪装执行、Enter 单份结果、历史、连接恢复、窄屏浮层与减少动态效果。
- 新上下文独立 finish review。示例按钮可发现性、手机点击区域、来源名称不拆词三项已修。人工补查修复输入提示对比度、命名颜色 token 漏检与 hover 叠加。手机可见 button/select 均至少 44×44px。
- 最后四条来源 metadata 只将分隔标点改为换行；因此 JS hash 有变化。对这四个格式变化归一化后，JS 与旧版逐字节一致；DOM/ARIA/hooks 与内容骨架精确保留。不得再写成 JS 完全无变化。

## 检查边界

遵守用户 Ego 唯一首选浏览器规则，未执行上游 Puppeteer --render，不能宣称它通过；实际渲染意图由 Ego 截图、DOM 样式及交互检查覆盖。官方静态 kept 的 fields/handlers 为零是动态 DOM/事件委托盲区，6/6 script hooks 不单独作为保全证明。

现有 JS 的空态、日常、连接问题和已有对话状态都保留；不为视觉检查伪造异步 loading 或 URL 状态。提示区高度变化、历史标点和多字重等非阻塞 Finish 意见见 judged-review.md。这是可点击方案，尚未安装为原生日常插件，不证明 Google 授权、来源读取、微信送达或自然主动运行修好。

## 复现与材料

node build.mjs 将 tokens.css、base.css、app.css 内联为独立 prototype.html，保留原 CSP。首屏 QR 为明确标注的示意图，不可真实配对。没有外部图片/字体槽位；下一项最有价值的真实材料是原生接线后的第一条实际任务结果，不能用虚构数字或装饰图填充。

完整过程在 .hallmark/PICKS.md、judged-review.md、finish-review.md，比较页为 .hallmark/compare.html。日常 Harness 仍是 0.18.0-preview.1，本轮未安装、改授权/绑定/计划或发布。
