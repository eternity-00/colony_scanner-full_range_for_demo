#!/bin/sh
# Colony Scanner v2.1 키오스크 런처 (라즈베리파이)
#
# v5 · v6 · v2.0 과 포트를 나눠 쓰므로 함께 뜬다 — 이 스크립트는 v5(8787/8790/8792)·v6(8888/8890)을
# 건드리지 않는다. 바탕화면 아이콘으로 나란히 비교하려고 이렇게 나눴다.
#   엔진 9090 · 제어 서버 9088
set -eu
project_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
cd "$project_dir"

export VIRTUAL_ENGINE_PORT=9090
export VIRTUAL_ENGINE_URL=http://127.0.0.1:9090
export PORT=9088
# 다른 기기에서 http://<파이 주소>:9088 로도 열어 볼 수 있게 둔다.
export HOST=0.0.0.0
# 종료 버튼이 동작하려면 서버에 이 값이 있어야 한다. COLONY_PROFILE 은 자기
# 크로뮴만 닫기 위한 것이다 — 없으면 /tmp/colony* 를 통째로 죽여 다른 버전까지 꺼진다.
export COLONY_KIOSK=1
export COLONY_PROFILE=/tmp/colony-v21-chromium
# 알람 시험 페이지(/trigger.html)의 플레이트 시험을 받는다. 실제 장비에 붙일 때는 뺀다.
export COLONY_TRIGGERS=1

# UI 배율 — 패널의 화소 밀도(PPI)에 맞춘다. 해상도가 아니라 PPI 기준이다.
UI_SCALE="${UI_SCALE:-1.0}"

[ -f dist/index.html ] || { echo 'dist/ 가 없습니다. PC에서 빌드해 배포하세요.' >&2; exit 1; }

BIN=$(command -v chromium || command -v chromium-browser || true)
[ -n "$BIN" ] || { echo '크로뮴이 없습니다.' >&2; exit 1; }

# 화면은 하나뿐이다. 다른 버전의 키오스크가 떠 있으면 두 전체화면 창이 겹쳐
# 쌓여, 누를 때마다 엉뚱한 쪽이 앞으로 나온다. 창만 닫는다 — 서버는 그대로
# 두어 v5 · v6 의 웹 주소와 아이콘이 바로 다시 열린다.
pkill -f 'user-data-dir=/tmp/colony-v5' 2>/dev/null || true
pkill -f 'user-data-dir=/tmp/colony-v6' 2>/dev/null || true
pkill -f 'user-data-dir=/tmp/colony-v22' 2>/dev/null || true
pkill -f 'user-data-dir=/tmp/colony-v20' 2>/dev/null || true

wait_for() {
  n=0
  until curl -fsS "$1" >/dev/null 2>&1; do
    n=$((n + 1)); [ "$n" -ge 100 ] && { echo "시작 실패: $1" >&2; exit 1; }; sleep 0.1
  done
}

# 엔진이 먼저다. 제어 서버가 앞서 뜨면 엔진을 못 찾아 스캐너를 점검 필요로 잡고,
# 엔진이 붙을 때까지 그 상태가 화면에 보인다.
started=''
if ! curl -fsS http://127.0.0.1:9090/api/health >/dev/null 2>&1; then
  nohup node simulator-app/engine.mjs >engine.log 2>&1 & started="$started $!"
fi
wait_for http://127.0.0.1:9090/api/health

if ! curl -fsS http://127.0.0.1:9088/api/health >/dev/null 2>&1; then
  nohup node server/index.mjs >server.log 2>&1 & started="$started $!"
fi
wait_for http://127.0.0.1:9088/api/health

cleanup() { [ -n "$started" ] && kill $started 2>/dev/null || true; }
trap cleanup EXIT INT TERM

profile=$(mktemp -d "$COLONY_PROFILE.XXXXXX")
trap 'cleanup; rm -rf -- "$profile"' EXIT INT TERM
# 파이 데스크톱은 labwc(Wayland)다. ozone 플랫폼을 안 주면 크로뮴이 X11 로 뜨려다
# "Missing X server or $DISPLAY" 로 죽는다.
OZONE=""
[ -n "${WAYLAND_DISPLAY:-}" ] && OZONE="--ozone-platform=wayland"
exec "$BIN" --kiosk $OZONE --no-first-run --password-store=basic \
  --disable-session-crashed-bubble --disable-infobars \
  --user-data-dir="$profile" "http://127.0.0.1:9088/?scale=$UI_SCALE"
