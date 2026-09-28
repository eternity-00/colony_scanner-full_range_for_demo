#!/bin/sh
# Colony Scanner v3 키오스크 런처 (라즈베리파이)
#
# open-demo.sh / run-lcd.sh 와 달리 `npm run build` 를 하지 않는다.
# 파이에는 빌드 산출물(dist/)만 올리고 node_modules 는 올리지 않기 때문이다.
# server/·simulator-app/·scripts/ 는 node: 빌트인만 쓰므로 의존성 설치가 필요 없다.
set -eu
project_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
cd "$project_dir"

# 종료 버튼이 동작하려면 서버 프로세스에 이 값이 있어야 한다.
# server/index.mjs 의 /api/exit 는 COLONY_KIOSK=1 일 때만 크로뮴을 닫는다
# (pkill -f user-data-dir=/tmp/colony). 없으면 {"kiosk":false} 만 돌려주고
# 화면은 "종료하고 있습니다" 오버레이에 멈춘다.
export COLONY_KIOSK=1

# UI 배율 — 패널의 화소 밀도(PPI)에 맞춘다. 해상도가 아니라 PPI 기준이다.
#   10.1" 1024×600 → 1.0   10.1" 1280×800 → 1.3   10.1" 1920×1200 → 1.9   7" 1024×600 → 1.4
UI_SCALE="${UI_SCALE:-1.0}"

[ -f dist/index.html ] || { echo 'dist/ 가 없습니다. PC에서 빌드해 배포하세요.' >&2; exit 1; }

BIN=$(command -v chromium || command -v chromium-browser || true)
[ -n "$BIN" ] || { echo '크로뮴이 없습니다.' >&2; exit 1; }

wait_for() {
  n=0
  until curl -fsS "$1" >/dev/null 2>&1; do
    n=$((n + 1)); [ "$n" -ge 100 ] && { echo "시작 실패: $1" >&2; exit 1; }; sleep 0.1
  done
}

started=''
if ! curl -fsS http://127.0.0.1:8790/api/health >/dev/null 2>&1; then
  nohup node simulator-app/engine.mjs >engine.log 2>&1 & started="$started $!"
fi
if ! curl -fsS http://127.0.0.1:8792 >/dev/null 2>&1; then
  nohup node simulator-app/server.mjs >simulator.log 2>&1 & started="$started $!"
fi
if ! curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
  nohup node server/index.mjs >server.log 2>&1 & started="$started $!"
fi
wait_for http://127.0.0.1:8790/api/health
wait_for http://127.0.0.1:8792
wait_for http://127.0.0.1:8787/api/health

# 브라우저가 닫히면 우리가 띄운 프로세스만 정리한다.
cleanup() { [ -n "$started" ] && kill $started 2>/dev/null || true; }
trap cleanup EXIT INT TERM

profile=$(mktemp -d /tmp/colony-v3-chromium.XXXXXX)
trap 'cleanup; rm -rf -- "$profile"' EXIT INT TERM
exec "$BIN" --kiosk --no-first-run --password-store=basic \
  --disable-session-crashed-bubble --disable-infobars \
  --user-data-dir="$profile" "http://127.0.0.1:8787/?scale=$UI_SCALE"
