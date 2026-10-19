# 开发排障入口

仅供开发者定位故障；普通使用和验收不需要输入以下命令。自然语言主流程见[快速开始](quickstart.md)。

# 快速开始

## 安装

目标版本：官方 DeepSeek Harness `0.2.0-rc.2` 或 `0.2.1-rc.2`。先确认宿主已有可用模型，并能完成普通任务。

1. 在 DSH 插件管理器中添加 `dsh-wechat@0.11.0`，安装后启用；按原插件指引扫码，并从微信发一条消息验证原通路。
2. 在同一 profile 中添加本项目的 `.tgz` 包实际路径或 Release 下载地址，并启用。
3. 从已有普通项目会话执行下面的命令。仅安装文件而未启用 bundle，不会注册命令。

本项目不替你重启正在工作的 DSH，也不修改原微信桥接的凭据或配对。

## 关注与日报

在要关注的 DSH 项目里：

```text
/companion watch
/companion now
/companion status
```

也可用自然语言要求 DSH：“关注当前项目，整理今天的项目日报，标出来源和还待确认的事。”它可调用 `project_companion` 工具。

日报使用选定项目的 `.agent/memory/progress.md`、`.agent/memory/context.md`、`README.md`，以及插件启用后观察到的有界近期会话。没有这些文件也可关注；缺失会如实体现，不能把空记录当成项目没有进展。

如果日报来自微信会话，可继续追问其中的项目；原生 `/companion` 经微信转发的路径需按本机实际版本验证，不能用合成宿主测试代替扫码实测。

## 每日汇报与提醒

在接收微信的真实会话中配置时间及时区，例如：

```text
/companion daily 09:00 America/Mexico_City
/companion remind 2026-10-20T15:00:00-06:00 检查项目验收结果
/companion status
/companion pause
```

时间只是示例，换成自己的安排。定时汇报未配置前保持关闭；新版本不自动替用户建立计划。一次提醒从状态中取得 ID 后，可用 `/companion cancel <提醒ID>` 取消；裸 `/companion` 返回当前状态。

电脑或 DSH 重启后，如果状态显示发送会话不可用，在真实微信会话中重新执行每日配置来更新绑定。有效窗口内的 blocked 日报继续保留为同一条待发送记录；queued、桥接报告已发送或结果不确定的记录不自动重复投递。

## 项目续聊

先查询关注列表和日报，取得明确项目 ID，再在微信发出具体任务，例如：

```text
/companion list
/companion continue p_example 检查这个项目尚待确认的验收项，先给我结果和来源
```

将 `p_example` 换成列表中的真实 ID。首版仅把明确命令交给该项目已有、空闲的 live 会话；忙碌、未载入或存在多个不明确目标时返回指引，保留原有运行和权限边界。裸 `/companion` 返回状态。

## 可选云端来源

在项目上下文中关联一个公开 GitHub 仓库：

```text
/companion github owner/repository
```

它用于日报里的最新 release 动态，不授予私有仓库、邮箱或日历权限。云端读取失败会显示失败状态，不用旧结果冒充新查询。

Gmail、Google Workspace、Slack、Notion、iCloud 云端接入作为后续可选授权层，优先复用已有连接器；本版无需为这些服务另外登录。
