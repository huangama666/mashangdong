#!/bin/zsh
set -e
cd "${0:A:h}"

if ! command -v node >/dev/null 2>&1; then
  for node_dir in "$HOME"/.nvm/versions/node/*/bin(N/); do
    export PATH="$node_dir:$PATH"
  done
fi

if ! command -v node >/dev/null 2>&1; then
  print '未找到 Node.js，请先安装 Node.js 22.12 或更高版本。'
  read 'reply?按回车退出…'
  exit 1
fi

if [[ ! -f node_modules/vite/bin/vite.js ]]; then
  npm ci --no-audit --no-fund
fi

print '正在更新码上动页面…'
npm run build

if curl --noproxy '*' -fsS --max-time 2 http://127.0.0.1:4173/ 2>/dev/null | /usr/bin/grep -q '码上动'; then
  open http://127.0.0.1:4173/
  exit 0
fi

(sleep 2; open http://127.0.0.1:4173/) &
print '码上动：http://127.0.0.1:4173/'
print '关闭本终端窗口或按 Ctrl+C 可停止服务。'
exec node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort
