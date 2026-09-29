#!/bin/sh
set -eu
# 1) 포트를 잡고 있는 것부터 내린다.
for port in 8787 8790 8792; do
 pid=$(ss -ltnp "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1)
 [ -z "$pid" ] && continue
 cmd=$(tr '\0' ' ' <"/proc/$pid/cmdline")
 case "$cmd" in *server/index.mjs*|*simulator-app/engine.mjs*|*simulator-app/server.mjs*) kill "$pid";; *) printf '%s\n' "$port 포트를 다른 프로그램이 사용 중이므로 종료하지 않았습니다." >&2;; esac
done

# 2) 포트를 못 잡은 채 살아남은 것도 쓸어낸다.
#    예전 종료가 SSE 연결 때문에 끝나지 않아 프로세스가 남곤 했다. 그것들도
#    엔진을 폴링하고 촬영을 걸기 때문에, 보이지 않는 채로 장비를 부린다.
#    이 스크립트를 돌리는 셸(cmdline 에 stop-demo.sh 가 들어 있다)은 건드리지 않는다.
here=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
for d in /proc/[0-9]*; do
 pid=${d#/proc/}
 [ "$pid" = "$$" ] && continue
 # 훑는 사이에 사라지는 프로세스가 있어, 읽기 실패는 조용히 넘긴다.
 cmd=$(cat "$d/cmdline" 2>/dev/null | tr '\0' ' ') || continue
 [ -n "$cmd" ] || continue
 case "$cmd" in *stop-demo.sh*) continue;; esac
 case "$cmd" in *server/index.mjs*|*simulator-app/engine.mjs*|*simulator-app/server.mjs*) ;; *) continue;; esac
 [ "$(readlink -f "$d/cwd" 2>/dev/null)" = "$here" ] || continue
 kill "$pid" 2>/dev/null || true
done

sleep 1
# 3) 그래도 안 죽으면 확실히 내린다.
for d in /proc/[0-9]*; do
 pid=${d#/proc/}
 [ "$pid" = "$$" ] && continue
 # 훑는 사이에 사라지는 프로세스가 있어, 읽기 실패는 조용히 넘긴다.
 cmd=$(cat "$d/cmdline" 2>/dev/null | tr '\0' ' ') || continue
 [ -n "$cmd" ] || continue
 case "$cmd" in *stop-demo.sh*) continue;; esac
 case "$cmd" in *server/index.mjs*|*simulator-app/engine.mjs*|*simulator-app/server.mjs*) ;; *) continue;; esac
 [ "$(readlink -f "$d/cwd" 2>/dev/null)" = "$here" ] || continue
 kill -9 "$pid" 2>/dev/null || true
done
printf '%s\n' 'Colony Scanner LCD와 외부 가상장비를 종료했습니다.'
