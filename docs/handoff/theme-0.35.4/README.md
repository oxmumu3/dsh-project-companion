# Dot 0.35.4 主题与阅读回归回执

范围：从 `72cb01b` 起的候选工作树。只修主题/阅读回归，并把已批准的 Today 方向里几处已知样式偏差收口。项目、记忆、连接的结构重设计和 M2.5 三页新交互没有混进来。

## 复现

- Codex 已独立用官方签名 RC2 真实安装并运行 16 个隔离画面：暗色下四页外壳仍被强制浅色；Google 标题/状态 `1.05:1`、授权说明 `1.22:1`、启用登录按钮暗色 `2.33:1` / 浅色 `4.23:1`。
- 本工作树用 `72cb01b` 的 CSS 在系统 Chrome 里复现了同一组数：暗色外壳 `rgb(246,245,240)`，Google 卡 `rgb(44,44,46)`、标题 `rgb(35,49,60)`；登录按钮白色字压在 `rgb(122,170,255)` 上（`2.33:1`）。Today 的矩阵按钮被旧工作台规则撑成 `28×44`、带 `1px` 边框和 `13px/9px` 内边距，圆点看起来像小方块。
- 本会话没有从沙箱启动 Electron，也没有申请全盘权限。下面的截图是同一份 CSS + 合成数据的浏览器渲染，不是官方桌面截图；真实 Electron 矩阵由 Codex 从精确提交复跑。

## 修改

- **四页统一取宿主 token**：移除 `0.35.2` 引入的固定浅色 palette。今天、项目、记忆、连接以及浮动入口的纸面、卡片、正文、次要文字、边框、强调色都改从 `--dsw-alias-*` 映射。暗色下 `.pc_dot` 外壳跟着变 `#151517`，不再出现「外壳浅、卡片深」的半套主题。
- **Google 连接区**：标题、授权说明、Gmail/日历/Drive 状态、链接、按钮全部按宿主文字/背景配对。登录按钮改为成对的填充色 + 前景色：浅色 `5.43:1`、暗色 `5.96:1`，不再固定白字配宿主浅蓝。授权说明原文、位置和「不会自动授权」的边界没有改动。
- **Today 与旧样式隔离**：旧工作台的按钮、输入框规则排除 `.dotv2`，点阵恢复圆点，输入框不再多一圈硬边。长项目名在项目格、事项行和卡片标题里限两行并换行，不再把行高撑开。事项时间改成「刚刚 / 5 分钟前 / 今天 09:05 / 昨天 21:10」，页面不出现 ISO 串。
- **标题句**：去掉「两 件做完了」里的空格，分句统一逗号、句末补句号；只有「在跑」时也读成完整一句。
- **构建**：`prepack` 现在会先跑 `npm run build`，从精确提交 `npm pack` 不会缺 `dist/client.js`。

## 截图

均为合成数据；1440 宽和 390 宽；浅/深各一套。`before-*` 是复现图，其余是修复后。

- Today：`shots/today-light-1440.png`、`shots/today-dark-1440.png`、`shots/today-light-390.png`、`shots/today-dark-390.png`
- Google 待授权：`shots/google-pending-light-1440.png`、`shots/google-pending-dark-1440.png`、`shots/google-pending-dark-390.png`；复现：`shots/before-google-pending-dark-1440.png`
- Google 已授权：`shots/google-authorized-light-1440.png`、`shots/google-authorized-dark-1440.png`
- 项目：`shots/projects-light-1440.png`、`shots/projects-dark-1440.png`
- 记忆：`shots/memory-light-1440.png`、`shots/memory-dark-1440.png`

## 对比度（普通文字目标 4.5:1）

| 位置 | 修复前（暗色） | 修复后浅色 | 修复后暗色 |
|---|---:|---:|---:|
| Google 标题 / 状态 / Gmail 状态 | 1.05 | 18.9 | 13.34 |
| Google 授权说明 | 1.23 | 16.97 | 10.39 |
| 启用登录按钮 | 2.33（浅色 4.23） | 5.43 | 5.96 |
| Today 次要文字 | 3.71（浅色） | 5.8 | 12.11 |
| Today 正文 | — | 18.9 | 17.45 |

## 本地测试

`npm_config_cache=<worktree>/.theme-audit/npm-cache npm test`

- 2613 项，2572 通过，4 失败，37 跳过。
- 4 个失败都来自 `scripts/ci-sandbox.mjs` 调 macOS `sandbox-exec`：本会话的文件沙箱返回 `sandbox-exec: sandbox_apply: Operation not permitted`，不是断言失败，和本次改动无关。
- 相关套件：`theme-regression` 9/9、`today-first-use` 22/22、`workbench-ui` / `client-goal-board-ui` / `context-client` / `dot-appearance` 165/165。

## 边界

没有访问真实账户，没有发送微信，没有改日常任务，没有外发。授权说明和授权逻辑保持原样。包 SHA 与精确提交见本轮交付回执。
