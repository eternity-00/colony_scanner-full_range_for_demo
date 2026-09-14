#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
if ! curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
  cd "$project_dir"
  npm run build
  nohup npm start >"$project_dir/colony-demo.log" 2>&1 &
  count=0
  until curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; do
    count=$((count + 1))
    if [ "$count" -ge 50 ]; then
      printf '%s\n' "서버 시작 실패. $project_dir/colony-demo.log를 확인하세요." >&2
      exit 1
    fi
    sleep 0.1
  done
fi
exec chromium --app=http://127.0.0.1:8787 --window-size=1200,800
