# 安装 DeepSeek Dot

当前版本为 `0.5.0-preview.1`，社区项目，非官方产品。统一安装包包含固定的微信桥接 `dsh-wechat@0.11.0` 和项目助理，通过官方 Desktop CLI 安装；不修改官方 App、不导入作者账户，也不复制微信配对凭据。

## macOS 双击安装

[下载安装包](https://github.com/piggy00544/dsh-project-companion/releases/download/v0.5.0-preview.1/dsh-dot-0.5.0-preview.1-macos.zip) · [查看版本文件](https://github.com/piggy00544/dsh-project-companion/releases/tag/v0.5.0-preview.1)

1. 解压并保留整个目录，不要只移出 `Install.command`。
2. 已有官方 Harness：保存工作并正常退出 App，再双击 `Install.command`。安装器不会结束运行中的任务。
3. 没有 Harness：入口打开[官方 Releases](https://github.com/deepseek-ai/deepseek-harness/releases)。本人完成官方应用安装后，回到终端按回车，入口继续检查并安装插件；它不自动下载或覆盖官方 App。
4. 阅读安装结果，成功后本人打开 Harness，确认微信桥接和项目助理均已启用。完成模型登录配置，再进入设置中的「DeepSeek Dot」。

只支持官方 DSH `0.2.0-rc.2` 或 `0.2.1-rc.2`。安装仍可能联网下载依赖，不是完整离线包。当前入口未签名、公证；如果 macOS 阻止打开，请先停下核对，不要绕过安全检查。不要向安装器提供模型密钥或微信凭据。Windows 整合安装尚未验证。

安装成功表示官方 CLI 返回成功且精确版本回读匹配，不等于组件已运行、微信已绑定或手机已收到消息。下一步见[首次使用](first-use.md)。

## 已有 Harness：官方插件页面添加

下载 [dsh-project-companion-0.5.0-preview.1.tgz](https://github.com/piggy00544/dsh-project-companion/releases/download/v0.5.0-preview.1/dsh-project-companion-0.5.0-preview.1.tgz)，在官方插件管理页面添加并启用。微信能力需另行安装并启用 `dsh-wechat@0.11.0`，可以使用统一安装包内的桥接 tgz。不要额外启用 YOLO 或 proactive 整包来满足本项目依赖。

## 安装器会保留什么

- 已有微信桥接精确为 `0.11.0` 时原样保留；其他版本停止，避免覆盖既有连接。
- 项目助理同版本保留，显式安装允许升级旧版，拒绝降级。
- 已有禁用状态不会静默改成启用；结果会列出需要在官方管理器启用的组件。
- 模块与 profile 登记不一致时停止并提示修复，不把残留模块当作已安装。
- Harness 正在运行或安装中途启动时停止，稍后可从同一入口重试。
- 第二个包失败时报告已完成与未完成的步骤，不冒称整体成功或自动回滚。

## 分发校验与开发预览

完整目录包含 `Install.command`、`bundle-manifest.json`、安装脚本、两个固定 tgz，以及主项目和上游许可证。manifest 记录精确版本和 SHA256；安装器还会核对包名、版本、MIT 许可和 bundle 声明。

已有 Node 的开发者可在解压目录只预览计划：

```sh
node scripts/install.mjs --bundle-dir . --dry-run
```

确认后在同一命令增加 `--install` 执行。无 Node 的用户由双击入口使用官方 App 自带运行时。散装源码目录缺少 manifest 时不能当作完整安装包使用。

安装器已覆盖版本冲突、包篡改、运行中宿主、保留与升级、合法禁用状态及分步失败的自动回归；本机完成过官方 CLI 升级。陌生用户下载后双击、新装 Harness 与全新微信扫码的完整开箱流程仍待验证。来源与许可见[第三方声明](../THIRD_PARTY_NOTICES.md)。
