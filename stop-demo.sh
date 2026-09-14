#!/bin/sh
set -eu
pid=$(ss -ltnp 'sport = :8787' 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1)
if [ -z "$pid" ]; then
  printf '%s\n' 'Colony Scanner 데모 서버가 실행 중이 아닙니다.'
  exit 0
fi
cmd=$(tr '\0' ' ' <"/proc/$pid/cmdline")
case "$cmd" in
  *server/index.mjs*) kill "$pid"; printf '%s\n' 'Colony Scanner 데모 서버를 종료했습니다.' ;;
  *) printf '%s\n' '8787 포트를 다른 프로그램이 사용 중이므로 종료하지 않았습니다.' >&2; exit 1 ;;
esac
