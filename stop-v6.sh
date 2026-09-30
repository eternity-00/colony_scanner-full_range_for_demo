#!/bin/sh
# v6 만 내린다. v5(8787/8790/8792)는 건드리지 않는다.
set -u
for port in 8888 8890; do
  pid=$(ss -lptn "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
  [ -n "${pid:-}" ] && kill "$pid" 2>/dev/null
done
sleep 1
echo 'Colony Scanner v6 종료'
