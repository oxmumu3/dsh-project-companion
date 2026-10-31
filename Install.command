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
  if ! read -r answer; then exit 2; fi
  if [[ "$answer" == 'q' ]]; then exit 2; fi
done
printf '%s\n' '将安装或保留本地目录中的固定版本微信桥接和 DeepSeek 专属 Dot。' '首次安装官方 Harness 后请先打开一次，再保存工作并正常退出；本入口不会关闭任何运行中的任务。'
while true; do
  ELECTRON_RUN_AS_NODE=1 "$app_path/Contents/MacOS/DeepSeek Harness" --expose-internals --max-old-space-size=128 "$install_dir/scripts/install.mjs" --bundle-dir "$install_dir" --app "$app_path" --install
  install_status=$?
  case "$install_status" in
    3)
      printf '%s\n' '需要先完成官方 App 的首次启动。现在为你打开已找到的 Harness。' '等主界面出现后，请保存工作并按 ⌘Q 正常退出，然后回到这个窗口按回车继续。输入 q 后回车退出。'
      if ! /usr/bin/open "$app_path"; then
        printf '%s\n' '未能打开官方 App；请自行打开一次，再正常退出并回到这里。'
      fi
      ;;
    4)
      printf '%s\n' 'Harness 仍在运行，尚未开始安装。请保存工作并按 ⌘Q 正常退出，再回到这个窗口按回车继续。输入 q 后回车退出。'
      ;;
    *) break ;;
  esac
  if ! read -r answer; then exit 2; fi
  if [[ "$answer" == 'q' ]]; then exit 2; fi
done
printf '\n%s\n' '请阅读上面的安装结果。按回车关闭此窗口。'
read -r answer
exit "$install_status"
