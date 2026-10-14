#!/bin/sh
# Colony Scanner v2.0 — 웹으로 열어 보는 배포.
#
# v5 · v6 과 포트를 나눠 써서 함께 뜬다.
#   엔진 8990 · 제어 서버 8988(다른 기기에서 열 수 있게 0.0.0.0 으로 연다)
set -eu
cd "$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
[ -f dist/index.html ] || { echo 'dist/ 가 없습니다. PC에서 빌드해 배포하세요.' >&2; exit 1; }

export VIRTUAL_ENGINE_PORT=8990
export VIRTUAL_ENGINE_URL=http://127.0.0.1:8990
export PORT=8988
export HOST=0.0.0.0
# 여기서 띄운 서버를 나중에 run-v20.sh 가 그대로 물려받는다(이미 떠 있으면 새로
# 띄우지 않는다). 이 값이 없으면 그 키오스크의 종료 버튼이 창을 못 닫는다.
# COLONY_PROFILE 로 v2.0 창만 닫으므로 웹으로 보는 쪽에는 영향이 없다.
export COLONY_KIOSK=1
export COLONY_PROFILE=/tmp/colony-v20-chromium

wait_for() {
  n=0
  until curl -fsS "$1" >/dev/null 2>&1; do
    n=$((n + 1)); [ "$n" -ge 100 ] && { echo "시작 실패: $1" >&2; exit 1; }; sleep 0.1
  done
}

# 엔진이 먼저다. 제어 서버가 앞서 뜨면 엔진을 못 찾아 스캐너를 점검 필요로 잡는다.
curl -fsS http://127.0.0.1:8990/api/health >/dev/null 2>&1 ||
  nohup node simulator-app/engine.mjs >engine.log 2>&1 &
wait_for http://127.0.0.1:8990/api/health

curl -fsS http://127.0.0.1:8988/api/health >/dev/null 2>&1 ||
  nohup node server/index.mjs >server.log 2>&1 &
wait_for http://127.0.0.1:8988/api/health

ip=$(hostname -I | awk '{print $1}')
echo "Colony Scanner v2.0 · http://$ip:8988/"
