#!/bin/zsh
# User-launched local entry. No host shutdown, profile patch, daemon or account import.
set -u
install_dir="${0:A:h}"
official_url='https://github.com/deepseek-ai/deepseek-harness/releases'
app_path=''
while true; do
  for candidate in '/Applications/DeepSeek Harness.app' "$HOME/Applications/DeepSeek Harness.app"; do
    if [[ -x "$candidate/Contents/MacOS/DeepSeek Harness" ]]; then
      app_path="$candidate"
      break
    fi
  done
  if [[ -n "$app_path" ]]; then break; fi
  printf '%s\n' '尚未找到官方 DeepSeek Harness。将打开官方 Releases 页面。' '请自行安装官方 App；安装好后回到这里按回车继续。输入 q 后回车退出。'
  /usr/bin/open "$official_url"
  read -r answer
  if [[ "$answer" == 'q' ]]; then exit 2; fi
done
printf '%s\n' '将安装或保留本地目录中的固定版本微信桥接和 DeepSeek 专属 Dot。' '请先保存工作并正常退出 Harness；本入口不会关闭任何运行中的任务。'
ELECTRON_RUN_AS_NODE=1 "$app_path/Contents/MacOS/DeepSeek Harness" --expose-internals --max-old-space-size=128 "$install_dir/scripts/install.mjs" --bundle-dir "$install_dir" --app "$app_path" --install
install_status=$?
printf '\n%s\n' '请阅读上面的安装结果。按回车关闭此窗口。'
read -r answer
exit "$install_status"
