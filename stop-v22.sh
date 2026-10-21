#!/bin/sh
# v2.2 만 내린다. v5 · v6 · v2.1 은 건드리지 않는다.
set -u
# 창부터 닫는다. 포트만 내리면 크로뮴이 남아, 다시 띄울 때 전체화면 창이
# 둘로 쌓인다.
pkill -f 'user-data-dir=/tmp/colony-v22' 2>/dev/null || true
for port in 9188 9190; do
  pid=$(ss -lptn "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
  [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null
done
sleep 1
echo 'Colony Scanner v2.2 종료'
