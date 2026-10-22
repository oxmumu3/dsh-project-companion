# Google 三件套与连接体验 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development with explicit backend/frontend ownership, then independent specification and quality reviews.

**Goal:** 用户在 Dot 点击 Google 登录即可申请 Gmail、日历、Drive 只读授权；普通连接不再要求 Token、Client ID 或 MCP 开发者资格。

**Architecture:** 沿用产品独立 Desktop OAuth 注册，增加与已有 Calendar-only 记录分开的 suite OAuth 记录和固定端点 REST 读取。复用现有 owner、绑定、暂停、来源启用、取消、CAS 保存与请求限额边界。界面统一三个来源，授权状态自动回读，但不因打开界面读取私人资料或建计划。

**Tech Stack:** Node.js 22 ESM、Harness Cordis 原生配置和插件 API、现有 DOM UI、node:test。

## 已确定的产品与验证边界

- 已批准方案与本次端到端指令作为实现授权，不再要求用户确认常规设计。
- Google 项目仍为独立 `dsh-dot`，不改 Finvo 原项目、IAM、账单或原 OAuth 客户端。
- 三个 scope：gmail.readonly、calendar.events.readonly、drive.readonly；实际 grantedScopes 决定可启用来源。
- 保留 Calendar-only 授权优先级，避免升级静默切换已有日历账号。
- Gmail/Drive 新 OAuth 同意由本人完成；不迁移隔离 Calendar 测试凭据，不冒称私人资料已实读。
- 先安装已验证 preview.3，再对新的候选测试、审读、打包并安装。全程保留绑定和计划。
- 原生微信禁用所有 UI 自动化；电脑回归与手机实际送达分开记录。

## 任务与所有权

- [x] Root：私有备份日常 profile 与五个状态文件，正常退出 App，执行冻结安装器，重开并核对运行状态。
- [x] Backend agent：新增 `src/google-suite-auth.js` 与 `src/google-suite-rest.js`；修改 context-config/provider/route/writer 和 index；新增对应 node:test。合约 `googleSuiteAuth` 状态包含 `grantedSources`，动作 `{action:'google_suite_authorize'}`。
- [x] Backend：测试缺失权限、部分同意、冷启动刷新、撤销/暂停/换绑/并发保存、固定 REST 端点与字节限制。继承 Calendar-only 测试且不能改变其凭据。
- [x] UI agent：只改 `src/client.js` 与前端测试。Google 主区提供清楚的登录、等待、已授权待启用、可读取、过期和重试；高级凭据折叠；只有授权进行时轮询并按卸载/到期清理。
- [x] Root：按官方文档核对 Gmail/Drive/Docs/Sheets/Slides GET 请求和只读 scope，在独立 Cloud 项目准备相关 API 与声明；保留 Testing 状态，不代点私人权限同意。
- [x] Root：运行完整串行测试与 SDK 矩阵；交给独立 agent 做权限边界和 UX 审读，修复阻塞问题后再封包。
- [x] Root：统一 README、install、first-use、context-sources、verification 与真实候选版本和能力状态。
- [ ] Root：构建精确 candidate、许可证与运行文件审计，日常 App 安装后查组件运行与 UI。保存电脑证据和醒后唯一必要的 Google consent/手机验收事项。

## 验收命令与结果口径

```sh
node --max-old-space-size=128 --test --test-concurrency=1 test/google-suite-*.test.mjs test/google-calendar-*.test.mjs test/context-*.test.mjs
npm test
python3 scripts/build-release.py --bridge <本地已审计dot.2桥接包> --runtime-reference <本轮已测tgz> --output <本轮新候选目录>
```

测试必须 0 fail。实际 Cloud API Enabled、OAuth 保存、真实读取、原 App 安装/运行、微信手机送达分别记证据，不互相替代。
