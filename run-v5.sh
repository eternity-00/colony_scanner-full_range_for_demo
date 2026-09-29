#!/bin/sh
# Colony Scanner v5 키오스크 런처 (라즈베리파이)
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

# v3 와 포트(8787/8790/8792)가 같다. 이미 떠 있는 서버를 재사용하면 v3 의 dist 가
# 그대로 나오므로, 내 것이 아닐 수 있는 서버는 먼저 내린다.
./stop-demo.sh >/dev/null 2>&1 || true
sleep 1

BIN=$(command -v chromium || command -v chromium-browser || true)
[ -n "$BIN" ] || { echo '크로뮴이 없습니다.' >&2; exit 1; }

wait_for() {
  n=0
  until curl -fsS "$1" >/dev/null 2>&1; do
    n=$((n + 1)); [ "$n" -ge 100 ] && { echo "시작 실패: $1" >&2; exit 1; }; sleep 0.1
  done
}

# 순서가 중요하다. 제어 서버가 엔진보다 먼저 올라오면 엔진을 못 찾아
# 4대를 ENGINE_OFFLINE(=점검 필요)로 잡고, 엔진이 붙을 때까지 그 상태가 화면에 보인다.
# 엔진을 먼저 띄우고 응답을 확인한 뒤 제어 서버를 시작한다.
started=''
if ! curl -fsS http://127.0.0.1:8790/api/health >/dev/null 2>&1; then
  nohup node simulator-app/engine.mjs >engine.log 2>&1 & started="$started $!"
fi
wait_for http://127.0.0.1:8790/api/health

if ! curl -fsS http://127.0.0.1:8792 >/dev/null 2>&1; then
  nohup node simulator-app/server.mjs >simulator.log 2>&1 & started="$started $!"
fi
if ! curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
  nohup node server/index.mjs >server.log 2>&1 & started="$started $!"
fi
wait_for http://127.0.0.1:8792
wait_for http://127.0.0.1:8787/api/health

# 브라우저가 닫히면 우리가 띄운 프로세스만 정리한다.
cleanup() { [ -n "$started" ] && kill $started 2>/dev/null || true; }
trap cleanup EXIT INT TERM

profile=$(mktemp -d /tmp/colony-v5-chromium.XXXXXX)
trap 'cleanup; rm -rf -- "$profile"' EXIT INT TERM
# 파이 데스크톱은 labwc(Wayland)다. ozone 플랫폼을 안 주면 크로뮴이 X11 로 뜨려다
# "Missing X server or $DISPLAY" 로 죽는다. 데스크톱 아이콘으로 눌러도 마찬가지다.
OZONE=""
[ -n "${WAYLAND_DISPLAY:-}" ] && OZONE="--ozone-platform=wayland"
exec "$BIN" --kiosk $OZONE --no-first-run --password-store=basic \
  --disable-session-crashed-bubble --disable-infobars \
  --user-data-dir="$profile" "http://127.0.0.1:8787/?scale=$UI_SCALE"
