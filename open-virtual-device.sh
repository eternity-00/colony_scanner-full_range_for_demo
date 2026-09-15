#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
if ! curl -fsS http://127.0.0.1:8790/api/health >/dev/null 2>&1; then
  nohup node "$project_dir/simulator-app/engine.mjs" >"$project_dir/virtual-engine.log" 2>&1 &
  sleep 0.3
fi
if ! curl -fsS http://127.0.0.1:8792 >/dev/null 2>&1; then
  nohup node "$project_dir/simulator-app/server.mjs" >"$project_dir/virtual-device.log" 2>&1 &
  sleep 0.3
fi
exec chromium --new-window --app=http://127.0.0.1:8792 --window-size=1100,820
