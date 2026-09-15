#!/bin/sh
set -eu
cd "$(dirname "$0")"
npm run build
printf '%s\n' 'Colony Scanner LCD: http://127.0.0.1:8787'
printf '%s\n' 'External Virtual Device: http://127.0.0.1:8792'
printf '%s\n' '종료: Ctrl+C'
exec npm run system
