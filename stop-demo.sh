#!/bin/sh
set -eu
for port in 8787 8790 8792; do
 pid=$(ss -ltnp "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1)
 [ -z "$pid" ] && continue
 cmd=$(tr '\0' ' ' <"/proc/$pid/cmdline")
 case "$cmd" in *server/index.mjs*|*simulator-app/engine.mjs*|*simulator-app/server.mjs*) kill "$pid";; *) printf '%s\n' "$port 포트를 다른 프로그램이 사용 중이므로 종료하지 않았습니다." >&2;; esac
done
printf '%s\n' 'Colony Scanner LCD와 외부 가상장비를 종료했습니다.'
