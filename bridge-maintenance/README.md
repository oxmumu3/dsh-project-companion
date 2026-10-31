# 微信桥接维护版来源与复建

## 0.20.0-preview.3 内嵌分发

当前 Dot 只需一个标准插件包，内置以以下固定 `.3` 为基线的 `0.11.1-dot.3-embedded.1`。额外维护仅涉及二维码请求取消、晚到确认不得保存 token，以及对应类型声明。完整许可保留；逐文件与原归档哈希见 [EMBEDDED.json](EMBEDDED.json)，可重建差异见 [embedded-login-lifecycle.patch](embedded-login-lifecycle.patch)，在解开的基线包中执行 `git apply --unidiff-zero /path/to/embedded-login-lifecycle.patch`。124文件复建一致。下文是历史独立维护包的来源与复建，不是当前读者的第二次安装步骤。


DSH Dot 的统一安装候选包使用 `dsh-wechat@0.11.1-dot.3` 本地维护版。pan17/dsh-wechat 原作者版权和 MIT 许可保持完整；维护责任归 DSH Dot。此版本未发布到上游或 npm，不代表原作者背书。

- 上游仓库：https://github.com/pan17/dsh-wechat
- 源码基线：`v0.11.0`，commit `218537511681be7557589f5ae0eab84f80267dc8`。
- 本地审核源码 commit：`1aa862728afcba1d811ce9ba442d6fb1bcd45ee0`。复建只需上游基线与本目录差异，不依赖远端存在此本地 commit。
- 精确包：`dsh-wechat-0.11.1-dot.3.tgz`，SHA256 `2205931694cf84eadea55c7445d7f5ff5b2ae4c76a8f658b495120c811a7c41c`。
- 原始 npm `0.11.0` 包独立固定为 SHA256 `993e1e1afce3c0dcd2610bf9e84ffbfd6d08768f5c4b4fa30eeec50dc2e97d3f`。源码 tag 和 npm 包分别固定，不宣称二者逐字节等同。
- [PROVENANCE.json](PROVENANCE.json) 记录差异文件、包、原始许可证、锁文件和受核变更文件的哈希；[差异](dsh-wechat-0.11.1-dot.3.patch) 含完整源码修改、回归测试和锁文件版本同步。

维护内容限于：仅对明确未发送的连接失败作有界 FIFO 重试；保留消息预算；发送超时和不完整回执不冒充成功；脱敏错误诊断；在桥接传输恢复后、agent 入队前提供同步 admission，使 Dot 能确定处理完整的纯收件请求。空队列纯收件请求由桥接串行回复固定确认，不进入模型；非空补发沿用原确认。发送前核对原绑定、agent、token、队列与卸载状态。歧义发送结果不会自行反复发送；混合问题继续交给助手。发送回执不等于手机送达或已读。

## 从固定上游基线复建

审核使用 Node `22.22.0`、npm `10.9.4`、TypeScript 版本及依赖锁哈希见 PROVENANCE。以下命令在新的专用目录运行；将绝对路径替换为实际差异和输出位置。`npm ci` 只安装复建所需开发依赖，不安装到 Harness，也不读取微信账号。

```sh
git clone https://github.com/pan17/dsh-wechat.git dsh-wechat-dot-rebuild
cd dsh-wechat-dot-rebuild
git checkout --detach 218537511681be7557589f5ae0eab84f80267dc8
git apply --check /absolute/path/bridge-maintenance/dsh-wechat-0.11.1-dot.3.patch
git apply /absolute/path/bridge-maintenance/dsh-wechat-0.11.1-dot.3.patch
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test -- --reporter=dot
npm pack --ignore-scripts --pack-destination /absolute/path/output
shasum -a 256 /absolute/path/output/dsh-wechat-0.11.1-dot.3.tgz
```

复建后应得到上述精确包哈希。发布脚本同时核对文件名、SHA256、包内名称、版本、MIT 与 bundle 声明；没有任意桥接覆盖参数。原始 MIT 全文见 [pan17-dsh-wechat.txt](../third-party-licenses/pan17-dsh-wechat.txt)。源码变更和测试材料不含配对、凭据、消息缓存或用户资料。

桥接自动化回归为 51 文件、770 项通过；纯恢复的桥接与 Dot 组合路径使用合成数据和 stubbed transport 验证。构建与打包不会启动宿主、安装插件、创建计划或发送真实微信，手机验收另记。

0.11.1-dot.3 增加仅插件内部可用的受控主动发送服务，按原会话、绑定版本、权限和稳定请求 ID 复核。发送日志跨重启保留；SQLite 提供同目录跨进程互斥。旧维护桥不认识该锁，因此升级时必须让旧官方宿主正常退出，不能新旧共用同一目录。Node 缺少内置 SQLite 时受控主动服务关闭，普通聊天继续可用。
