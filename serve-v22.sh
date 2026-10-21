#!/bin/sh
# Colony Scanner v2.2 — 웹으로 열어 보는 배포.
#
# v5 · v6 · v2.1 과 포트를 나눠 써서 함께 뜬다.
#   엔진 9190 · 제어 서버 9188(다른 기기에서 열 수 있게 0.0.0.0 으로 연다)
set -eu
cd "$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
[ -f dist/index.html ] || { echo 'dist/ 가 없습니다. PC에서 빌드해 배포하세요.' >&2; exit 1; }

export VIRTUAL_ENGINE_PORT=9190
export VIRTUAL_ENGINE_URL=http://127.0.0.1:9190
export PORT=9188
export HOST=0.0.0.0
# 여기서 띄운 서버를 나중에 run-v21.sh 가 그대로 물려받는다(이미 떠 있으면 새로
# 띄우지 않는다). 이 값이 없으면 그 키오스크의 종료 버튼이 창을 못 닫는다.
# COLONY_PROFILE 로 v2.2 창만 닫으므로 웹으로 보는 쪽에는 영향이 없다.
export COLONY_KIOSK=1
export COLONY_PROFILE=/tmp/colony-v22-chromium
# 알람 시험 페이지(/trigger.html)의 플레이트 시험을 받는다. 실제 장비에 붙일 때는 뺀다.
export COLONY_TRIGGERS=1

wait_for() {
  n=0
  until curl -fsS "$1" >/dev/null 2>&1; do
    n=$((n + 1)); [ "$n" -ge 100 ] && { echo "시작 실패: $1" >&2; exit 1; }; sleep 0.1
  done
}

# 엔진이 먼저다. 제어 서버가 앞서 뜨면 엔진을 못 찾아 스캐너를 점검 필요로 잡는다.
curl -fsS http://127.0.0.1:9190/api/health >/dev/null 2>&1 ||
  nohup node simulator-app/engine.mjs >engine.log 2>&1 &
wait_for http://127.0.0.1:9190/api/health

curl -fsS http://127.0.0.1:9188/api/health >/dev/null 2>&1 ||
  nohup node server/index.mjs >server.log 2>&1 &
wait_for http://127.0.0.1:9188/api/health

ip=$(hostname -I | awk '{print $1}')
echo "Colony Scanner v2.2 · http://$ip:9188/"
