# Dot 0.35.4 · Today 等待来源时不再冒充「都处理完了」

范围：从最终装机 `53c9016` 开出的独立工作树 `codex/pro-dot-today-loading-20261113`。只修 Today 右栏「你答应过的事」在来源未返回时的错误状态与版式，不混入 Claude 的 M2.5 项目／记忆／连接改版，也不改日常、设置、业务数据或真实 Google／微信读取。

## 复现

- 活动投影是只读 GET：路由先 `void dotSourceReader.refreshIfStale()`，再返回本地账本快照；来源读取不阻塞请求。冷启动时第一次响应因此可能带着「空缓存 + 空 promises」返回，但 `reachable` 仍是 `true`。
- 旧的前端把这个响应当成成功的空列表：右栏显示 `emptyNeed`「都处理完了…」；这条文案又被放进 `.promise li` 的 `52px` 日期列，于是逐字折行。等后台读完成，下一次轮询才换成真实事项——用户先看到的是一帧「已处理」的假话。
- 基准截图 `before-loading-rail-light-1440.png` 用 `53c9016` 的 `today.jsx`／`today-model.js`／`styles.css` 和与故障同形的空投影重放：右栏文案落在 `52px` 列，11 行，列表总宽 `316px`。

## 修改

- **来源读取有阶段**：`dotSourceReader` 的快照新增 `phase`：`idle → reading → ready`；整次读取抛错时进入 `failed` 并记录脱敏 `readError`。来源级失败仍走原来的 `sources[].state` 与 `sourceFix` 提示。
- **投影透传阶段**：`today-projection` 增加 `sourcesPhase`，不改变账本 revision、权限、来源行或 promise 合并规则。
- **前端四态**：`buildToday` 产出 `promisesState`：`loading` / `error` / `empty` / `ready`，以及 `state=loading`、`promisesState` 和 `sourcesPhase`。没有数据且来源仍在读时，页面显示「正在读取今天的状态…」，不显示空态、示例或 starter。
- **失败不冒充空**：来源阶段 `failed`，或成功阶段里存在未读通的来源，且没有 promise 时，右栏显示「这次没读到来源，恢复后这里会接上。」，具体来源警告照旧列在下面；只有成功读到零条 promise 才出现「都处理完了」。
- **整行版式**：`li.is-state` 使用 `grid-template-columns:minmax(0,1fr)`，等待／失败／公开空态都占满右栏，不再进入日期列；加载行带 `role=status` 与 `aria-live=polite`。
- **不僵在加载**：store 的重绘比较加入 `sourcesPhase`；同一 revision 下 `reading → ready` 仍会重绘（例如没有启用来源、列表保持为空的情况）。
- **冷加载与边界**：首次活动请求返回前显示等待态；`reachable:false` 仍走原有「看不到状态」边界；错误文案与授权逻辑未改。

## 截图

均为真实 `client/today.jsx` + 同份 `styles.css` 在系统 Chrome 的合成数据渲染，不是官方 Electron 截图；`before-*` 使用 `53c9016` 的旧组件。截图宽度 1440 / 390，深浅各一套（加载行）。

- 复现：`shots/before-loading-rail-light-1440.png`（`52px` 宽、11 行）
- 加载（有项目、右栏等待）：`shots/loading-rail-light-1440.png`、`shots/loading-rail-dark-1440.png`（`316px` 宽、1 行）
- 冷加载（整页等待）：`shots/loading-cold-light-1440.png`
- 读取失败：`shots/error-rail-light-1440.png`（`316px`、1 行；具体来源警告保留）
- 成功空：`shots/empty-rail-light-1440.png`（`316px`、2 行；仅此处出现「都处理完了」）
- 成功非空：`shots/data-rail-light-1440.png`（3 条真实 promise 行）
- 窄屏：`shots/loading-rail-light-390.png`（`318px`、1 行）、`shots/data-rail-light-390.png`

逐图测量在 `render-report.json`：`before` 的 `stateWidth=52`、`stateLines=11`；修后加载／失败／空态 `stateWidth=316`（390 宽为 318），且 `documentOverflow=false`。

## 回归

新增 `test/today-loading-state.test.mjs`，覆盖：

- 延迟中的活动请求：`phase=loading` 时模型与真实 Today 组件都只给加载文案，不出现 `emptyNeed`。
- 延迟投影：`sourcesPhase=reading` 时右栏为 `loading`；解析后成功空才是 `empty`，有 promise 才是 `ready`。
- 失败与成功空不混淆：`sourcesPhase=failed`、来源级 `needs_authorization` 都是 `error` 文案；与成功空的文案、状态均不同。
- 整次读取抛错进入 `failed`；同一 revision 下 `reading → ready` 仍触发一次重绘。
- 真实 `today.jsx` 渲染出的 `data-promise-state`、`li.is-state`、以及 `styles.css` 的整行规则。

全量测试：`npm test`，结果见下方「验证」。

## 验证

- `npm run build`：从当前工作树生成 `dist/client.js`（14 inputs），供既有 UI 测试与后续打包使用。
- `npm_config_cache=<临时目录> npm test`：2622 项，2581 通过，4 失败，37 跳过。
- 4 个失败全部在 `test/ci-sandbox.test.mjs`：本会话文件沙箱下 `sandbox-exec: sandbox_apply: Operation not permitted`，进程未启动，属于环境限制，不是断言失败，也与本改动文件无关。
- 相关套件：`today-loading-state` 8/8、`today-model` 10/10、`today-first-use` 22/22、`m2-b6-dot-none-marker` 3/3。

**未验证**：官方签名 Electron 桌面上的真实安装、真实来源授权与真实重启路径；按任务边界，由 Codex 从本提交精确复验。截图是系统 Chrome 的合成数据渲染，不替代官方桌面验收。
