#!/bin/bash
# Colony Scanner LCD 키오스크 런처 (라즈베리파이 v2 전용)
set -u
cd "$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
export COLONY_KIOSK=1
export STAGE_MS=3500   # 촬영 단계 진행 속도(ms/단계)
# UI 배율 — 패널의 화소 밀도(PPI)에 맞춰 물리적 크기를 맞춘다. 해상도가 아니라 PPI 기준이다.
#   10.1" 1024×600 → 1.0   10.1" 1280×800 → 1.3   10.1" 1920×1200 → 1.9   7" 1024×600 → 1.4
UI_SCALE="${UI_SCALE:-1.0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
BIN=$(command -v chromium || command -v chromium-browser || true)
[ -n "$BIN" ] || { echo '크로뮴이 없습니다.' >&2; exit 1; }
# 이미 떠 있으면 중복 실행 방지
for pu in 8787/api/health 8790/api/health 8792/; do
  if curl -fsS "http://127.0.0.1:${pu%%/*}/${pu#*/}" >/dev/null 2>&1; then
    echo '이미 실행 중입니다. 먼저 종료하세요.' >&2; exit 1; fi
done
npm run build
node scripts/system.mjs >system.log 2>&1 &
sys=$!
profile=$(mktemp -d /tmp/colony-v2-chromium.XXXXXX)
cleanup(){ pkill -f "user-data-dir=$profile" 2>/dev/null || true; kill "$sys" 2>/dev/null || true; wait "$sys" 2>/dev/null || true; rm -rf -- "$profile"; }
trap cleanup EXIT INT TERM
n=0
until curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1; do
  n=$((n+1)); [ "$n" -ge 120 ] && { echo '서버 시작 실패'; exit 1; }; sleep 0.1; done
"$BIN" --kiosk --ozone-platform=wayland --no-first-run --password-store=basic \
  --disable-session-crashed-bubble --disable-infobars \
  --user-data-dir="$profile" "http://127.0.0.1:8787/?scale=$UI_SCALE" >browser.log 2>&1 &
# 크롬이 실제로 뜰 때까지 대기(최대 10초)
for _ in $(seq 1 33); do pgrep -f "user-data-dir=$profile" >/dev/null && break; sleep 0.3; done
# 브라우저가 살아있고 서버도 살아있는 동안 유지 (종료 버튼이 브라우저를 닫으면 루프 종료 → cleanup)
while pgrep -f "user-data-dir=$profile" >/dev/null && kill -0 "$sys" 2>/dev/null; do sleep 0.5; done
