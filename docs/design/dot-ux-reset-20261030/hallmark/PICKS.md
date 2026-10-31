# Hallmark v2.0.0 · Dot 完整应用界面重设计

- Redesign: full，app scope；今天／项目／记忆／连接四个工作页，不使用营销页 hero、主题抽签或宣传图。
- Before: 官方静态基线109 Floor FAIL、153 Reflex、9 WARN。主要是颜色字体常量、间距和溢出防护；这些计数不是109个真实用户故障。Ego已保存9个原版界面及可见控件记录。
- Read: 用户在电脑交代事情，也在微信继续和收结果。现有直接扫码和共享草稿清楚且保留。重复圆角外框、彩色侧边条、小字号说明和等权重按钮使工作区像拼接组件。实际自然运行问题仍另行处理，不属于视觉验收。
- Keeps: 用户确认的动线、首屏直接二维码、所有字段/事件/路由/IDs/data hooks、脚本行为、家庭独立权限及全部原型免责声明。
- Files: edit prototype.html、tokens.css、base.css；create app.css、构建脚本、保留输入模板及运行证据；delete none。所有工作只在本次隔离artifact目录，原日常App不动。
- Theme: brand，已存在的DESIGN.md锁定纸白、深墨、蓝色及本地字体。使用官方brand/app scaffold，不额外套用品牌或远程字体。
- Screen: 电脑交代与手机配对形成同一工作区；桌面并列，窄屏先码后输入。日常由具体事项承载阅读，时间线与资料范围作为工具栏；四页共用密度与控件语言。
- Signature: 首屏可用的微信配对对象与同一份桌面对话，二维码在位、过期原地刷新、连接后收起。现为明确标注的示意码，不生成真实配对。
- Chrome: 保留产品标识和四页导航，收紧成工作区栏；不新增侧边栏、tab或操作步骤。
- Material: 只有现有合成事项、项目、记忆、资料和时间安排；不新增指标、图片、客户证言或真实数据读取。
- Pre-emit critique: P4 H4 E3 S4 R4 V3；最弱E，将分散样式集中为token、去掉重复外框，并逐态检查控件，而不是只靠首屏静态图。
- Verification: 官方静态sloplint before／kept，Ego真实视口与交互走查，独立fresh-context finish review和一轮修复。上游Puppeteer render不调用，遵守用户Ego浏览器规则；其未执行与Ego替代覆盖分别如实记录，不标成上游render pass。

- Final: source 702de7eb0d2150e7f35be65c7dd3ed895ad5eb7de7e570f2cd5857a187527e94; static Floor 0 FAIL / Reflex 0; 70 dismissed after semantic review. Three independent finish findings resolved. Ego 9 states, 17 interactions; no upstream Puppeteer render claimed.
