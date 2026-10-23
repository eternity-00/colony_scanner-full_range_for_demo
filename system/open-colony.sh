#!/bin/bash
set -euo pipefail
systemctl --user start colony-demo.service
exec chromium --app=http://127.0.0.1:8787 --window-size=1200,800
