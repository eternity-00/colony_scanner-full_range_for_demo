#!/bin/sh
# Colony Scanner v6 — 웹으로 열어 보는 배포.
#
# v5 와 포트를 나눠 써서 둘이 동시에 뜬다. v5 는 파이 화면(키오스크)에서,
# v6 은 PC 브라우저에서 링크로 연다. 서로의 서버를 내리지 않는다.
#   엔진 8890 · 제어 서버 8888(다른 기기에서 열 수 있게 0.0.0.0 으로 연다)
set -eu
cd "$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
[ -f dist/index.html ] || { echo 'dist/ 가 없습니다. PC에서 빌드해 배포하세요.' >&2; exit 1; }

export VIRTUAL_ENGINE_PORT=8890
export VIRTUAL_ENGINE_URL=http://127.0.0.1:8890
export PORT=8888
export HOST=0.0.0.0

wait_for() {
  n=0
  until curl -fsS "$1" >/dev/null 2>&1; do
    n=$((n + 1)); [ "$n" -ge 100 ] && { echo "시작 실패: $1" >&2; exit 1; }; sleep 0.1
  done
}

# 엔진이 먼저다. 제어 서버가 앞서 뜨면 엔진을 못 찾아 4대를 점검 필요로 잡는다.
curl -fsS http://127.0.0.1:8890/api/health >/dev/null 2>&1 ||
  nohup node simulator-app/engine.mjs >engine.log 2>&1 &
wait_for http://127.0.0.1:8890/api/health

curl -fsS http://127.0.0.1:8888/api/health >/dev/null 2>&1 ||
  nohup node server/index.mjs >server.log 2>&1 &
wait_for http://127.0.0.1:8888/api/health

ip=$(hostname -I | awk '{print $1}')
echo "Colony Scanner v6 · http://$ip:8888/"
