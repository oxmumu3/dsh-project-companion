# DSH Dot：竞品事实、可复用机制与交互增量

研究日期：2026-10-28。项目署名：牛村木木山。只读基线：`f57e5fb6b00a41c423e71ee7899181d40b151361`。没有安装竞品、接私人账号、运行竞品模型、发微信或修改日常 runtime。旧 `docs/comparison.md` 与 10 月 25 日报告保持原样。

**结论：微信、记忆、定时和自然语言交办都有成熟供给。Dot 应把优势落实为 Harness 已有项目的一条连续路径：交代目标、获得有来源的结果、需要时交办、变化时再回报。当前最值得增强的是用户能否自然走到结果，而非再加入口和连接器。**没有同任务实测、长期使用样本或独立用户偏好数据，不能写“最好用”“用户最喜欢”或效果排名。

## 三个名称核实

| 用户称呼 | 核实结果与官方承诺 | 不能据此推出 |
| --- | --- | --- |
| Codex Dot | [OpenAI dots](https://openai.com/index/introducing-dots/)，官方页日期 9 月 29 日。dot 可在云电脑持续工作、跨渠道保留上下文，并使用 Codex。后台主动研究被限定为已连接应用的只读工具。 | 不是已核实名为“Codex Dot”的独立产品；官方场景不等于成功率，不能推出支持微信。 |
| Meta Muse | [Meta 官方 Muse 发布页](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)，9 月 8 日。独立 VM、聊天/WhatsApp 入口、持续目标、敏感操作前批准、可撤权和忘记。 | 标题“World’s First”是厂商定位；Confidential VM 在该页仍是后续计划，不能写成已全面交付。 |
| xAI Grok Bot | [x.ai 官方 Grok Bot 页](https://x.ai/news/introducing-grok-bot)，正文日期 8 月 11 日，当前页署名 SpaceXSI。云电脑、同线程跨设备、多 Bot 协作和演示后保存 routine。 | Google 的“1 天前”不是发布日期。页内员工/早期使用者 testimonial 是官方挑选材料，不是独立用户调查。 |

本次没有收集独立社区使用样本；只把官方页面作为产品承诺，把仓库实现作为代码证据。对 Dot 的取舍是我们的推断。

## 最接近的开源对照

下表 HEAD 在本轮实时取得；日期是提交时间，不是发行时间。根 LICENSE 全文均已读取，证据见 [sources.json](sources.json)。许可证结论只覆盖相应仓库根许可，不替各依赖、商标或服务做保证。

| 对照与固定 HEAD | README／实现核实 | 复用与差异化决策 |
| --- | --- | --- |
| [nanobot](https://github.com/HKUDS/nanobot/tree/8f7a7d17590de7ab187650381894dba2b9e060ab) · `8f7a7d1` · 10-28 · MIT | README 明列微信、长记忆、自动化；`nanobot/channels/outbox.py` 持久记录发送，中断 sending 改 unknown。README 406 行说明同实例各项目共享长期记忆。 | 借鉴故障用例与账本清理；Dot 已有执行/投递分离和 uncertain，不能重复建设或宣称新能力。保留 Dot 按项目记忆和来源身份的边界。 |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent/tree/0431192d69d4afd2443a7da15bb9e129a424414c) · `0431192` · 10-28 · MIT | `agent/onboarding_first_tasks.py:139-149` 按真实连接给首份简报，标来源；日常安排另需同意。cron 文档有执行前配置检查与单次故障提示。当前 README 的微信链接是社区 HermesClaw，不据此称内置官方微信支持。 | 借鉴第一份成果和失效来源的低打扰处理。Dot 已有按来源问题草稿，增量应是把它放到刚启用的来源旁边，并明确下一步。跨 Python runtime 不整包嵌入。 |
| [OpenClaw](https://github.com/openclaw/openclaw/tree/a74f408db7fbabcdca1089cec8d50f16d6a4f418) · `a74f408` · 10-28 · MIT | README 为自托管个人助理；`src/agents/tools/cron-tool.ts` 提供 self-scoped scratch/result 操作，文档明确 no_change、progress、done、blocked、needs_attention；静默检查不覆盖最近有意义结果。 | 借鉴“记录结果”和“通知用户”分离、任务内状态与 CAS。Dot 不另嵌宿主或通用工作流 DSL；不能把上次成功读取当作本轮成功。 |
| [pan17/dsh-wechat](https://github.com/pan17/dsh-wechat/tree/312e9834831ab840c3a48f88f0fe95ee33ef2cda) · `312e983` · 10-26 · MIT | 当前 package **0.14.0**；README 有结论模式、合并输入、跨会话通知与审批同步。当前已维护 bundle 的上游基线仍需单独比较。 | 优先比较路由、权限、恢复、限流和绑定迁移，能删除的自有补丁应删除；不因版本号更高自动替换现有绑定或承诺更可靠。 |

代码入口：[nanobot 投递账本](https://github.com/HKUDS/nanobot/blob/8f7a7d17590de7ab187650381894dba2b9e060ab/nanobot/channels/outbox.py)、[Hermes 首任务](https://github.com/NousResearch/hermes-agent/blob/0431192d69d4afd2443a7da15bb9e129a424414c/agent/onboarding_first_tasks.py)、[Hermes cron](https://github.com/NousResearch/hermes-agent/blob/0431192d69d4afd2443a7da15bb9e129a424414c/website/docs/user-guide/features/cron.md)、[OpenClaw 任务结果](https://github.com/openclaw/openclaw/blob/a74f408db7fbabcdca1089cec8d50f16d6a4f418/docs/automation/cron-jobs/payloads.md#job-scratch-and-quiet-results)。

## 先承认 0.15 已有的能力

本地代码已经有四页工作台、授权后的状态轮询、来源启用、首份问题草稿、来源与读取时间、按项目记忆纠正/忘记、context 跟进、无变化静默、执行/投递分离和不确定发送不自动重试。旧报告里相应差距不能继续照搬。

仍有明确体验缺口：本轮读取的 `ui/connections.png` 为 1452×702，首屏被标题、管理/刷新、静态步骤和两段 Google 说明占据，真正授权按钮在首屏下方。`src/client.js:468` 已有首份收益入口，但在长连接页末尾，用户启用来源后还要去找它。截图是既有隔离 Host 证据，不是本轮日常或手机实测。

## 五项优先级

| 优先级 | 应落地的具体增量 | 验收结果 |
| --- | --- | --- |
| P0 | **Google 连接一张卡走通。**可见的收益/必要数据披露、未验证提示、本人同意、浏览器授权、本机保存、启用来源、具体问题按当前阶段呈现；已保存后“重新连接”降为次级，部分授权只显示真实可用来源。 | 新用户每个状态都只有一个清楚的推进动作；授权 CTA 在常用首屏；拒绝/失败/过期后可恢复，已有连接不丢。 |
| P0 | **当前交办先于历史结果。**进行中任务、需要用户处理的异常和本次草稿保持前景；旧回复显示时间并收在历史，执行完成与手机收到保持分开。 | 发起第二件事后仍一眼看到第二件事；旧结果不作为新进展，不触发重复执行。 |
| P1 | **解释贴着结果。**连接成功和失败就地说明下一步；AI 摘要固定位置展示“依据与范围”，展开才显示来源/读取时刻/缺项/截断，原始资料保留身份。 | 用户能核对“为什么这样说”和缺了什么；不会为了查来源离开当前任务；状态播报不抢焦点。 |
| P1 | **静默也留下可查询的检查状态。**任务保存最近检查、最近有意义结果、当前阻塞；无变化仅更新检查记录，失效来源不无限重发同一告警。 | 界面能回答“还在盯吗”；无变化不打扰；修复后恢复不覆盖历史依据，失败不伪装 no_change。 |
| P2 | **上游微信差异回放。**固定 pan17 0.14.0 与维护包的差异，复用兼容修复；先合成故障再做已授权手机小样本。 | 比较准确项目、一次执行/回传、限流重连、原绑定与权限迁移；没有同任务证据不做稳定性排名。 |

前三项交互具体方案和一手设计依据见 [UX.md](UX.md)。第四、五项属于后续工程候选，研究完成不等于已经实现。

## 本轮明确不做

- 不把 OpenAI/Meta/xAI 的云电脑、多 Agent 或支付自动化整体搬入 Harness 插件。
- 不为“更主动”扩大到全账号扫描、自动建立周期计划、自动外发或跨项目共享私人记忆。
- 不叠装另一套长期记忆和待办真相；滴答状态仍按既有产品边界处理。
- 不凭 package 中的 license 字段给缺失 LICENSE 的项目背书；本轮仅对上表四个完整根许可作判断。
- 不把代码、公开承诺、临时截图或发送回执合并成真实用户接受、手机收到或长期可靠性。

## 复核与复现

只开一个 ego lite v2 TaskSpace：`39`。GitHub 仓库 HEAD、README、完整 LICENSE 和选定实现均保存 URL、固定 SHA、HTTP 状态与内容 hash。官方产品/设计页保存短引句、元信息和核查结论，避免把整页复制进可发布材料。微软 HAX 原站本轮返回 high-demand/空页，**未把其正文作为已核依据**；以已读的 Google PAIR、IBM Carbon 和 W3C 设计指导组成三个一手依据。

研究证据在本目录，不等于公开 Release 内容；本轮未修改旧研究、源代码或运行版。
