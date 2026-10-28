# Dot 交付后的体验收口 Implementation Plan

> **For agentic workers:** Use executing-plans task by task; preserve the installed 0.15.0-preview.1 until the new candidate is verified.

**Goal:** 完成已有授权的竞品研究和具体体验增强，修正授权失败误报成功、旧结果遮挡新任务和共享入口工作台缺口。

**Architecture:** 复用现有 OAuth、可信 Family route、TaskResults 和 V2 四页；不加账户、扫描、调度器或权限。Google 只增加脱敏的本次尝试结果，不保存 code/token/URL 到状态或日志；已有凭据不因失败清除。

**Tech Stack:** JavaScript、Node test runner、原生 Harness 插件/隔离官方 Host。

- [ ] OAuth RED：令牌交换失败后保留旧凭据，回调给固定可恢复原因，status 报本次失败；取消/超时/成功和恶意 callback 隔离；context GET 仅白名单透出。
- [ ] OAuth GREEN：google-suite-auth.js 保存无秘密结果；context-route.js 和 client.js 明确本次授权失败与原有连接，卡内给未验证页手动说明、下一动作和首份收益；不自动点 Google 同意。
- [ ] 今日卡 RED/GREEN：workbench-ui.test.mjs 构造旧 completed＋新 running/blocked，当前卡必须是最新交办；旧结果仍可查，不自动执行。
- [ ] 可信 Family route 的工作台投影由独立 worktree 实现并审读，不能仅并表扩大范围。
- [ ] 文档并行：真实本地/公开版本、两种微信入口、Google UNDER_REVIEW 和验收范围同步；不覆盖历史研究。
- [ ] 整合、独审、必要SDK回归及隔离UI；保存精确产物与剩余手机验收，不声称公众版已更新。

成功标准：错误能恢复且不谎报、最新任务可见、来源/权限边界不退化；研究有一手证据和至少一个落地改进。手机验收仍由本人完成。
