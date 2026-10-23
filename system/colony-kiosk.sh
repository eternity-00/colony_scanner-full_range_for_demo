#!/bin/sh
# Open the LCD UI in Chromium kiosk mode on the Pi. The app itself runs as colony.service.
#   system/colony-kiosk.sh            (profile from COLONY_PROFILE, default testbed)
# UI scale and window size come from the profile's kiosk block; UI_SCALE overrides the scale.
set -eu
project_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
profile="${COLONY_PROFILE:-testbed}"
read_json() { node -e "const p=require('$project_dir/profiles/$profile.json');console.log($1)"; }
port=$(read_json 'p.network?.port??8787')
scale="${UI_SCALE:-$(read_json 'p.kiosk?.scale??1.0')}"
width=$(read_json 'p.kiosk?.width??1024'); height=$(read_json 'p.kiosk?.height??600')
systemctl --user start colony.service 2>/dev/null || true
n=0; until curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; do n=$((n+1)); [ "$n" -ge 100 ] && { echo "서버 시작 실패 (포트 $port)" >&2; exit 1; }; sleep 0.2; done
BIN=$(command -v chromium || command -v chromium-browser)
OZONE=""; [ -n "${WAYLAND_DISPLAY:-}" ] && OZONE="--ozone-platform=wayland"
profile_dir=$(mktemp -d "${COLONY_PROFILE_DIR:-/tmp/colony-kiosk}.XXXXXX")
if [ "${COLONY_WINDOWED:-0}" = "1" ]; then
  exec "$BIN" --app="http://127.0.0.1:$port/?scale=$scale" --window-size="$width,$height" $OZONE --no-first-run --password-store=basic --user-data-dir="$profile_dir"
fi
exec "$BIN" --kiosk $OZONE --no-first-run --password-store=basic --disable-session-crashed-bubble --disable-infobars --user-data-dir="$profile_dir" "http://127.0.0.1:$port/?scale=$scale"
