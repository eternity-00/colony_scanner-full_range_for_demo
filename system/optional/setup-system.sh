#!/bin/bash
set -euo pipefail
if [[ $EUID -ne 0 ]]; then exec sudo /bin/bash "$0"; fi
export DEBIAN_FRONTEND=noninteractive
backup=/var/backups/colony-device-setup-$(date +%Y%m%d-%H%M%S)
mkdir -p "$backup"
for config in /etc/default/locale /etc/locale.gen /etc/wayvnc/config; do
  if [[ -f "$config" ]]; then cp -a --parents "$config" "$backup/"; fi
done
apt-get update
apt-get install -y locales fonts-noto-cjk ibus ibus-hangul im-config openssh-server avahi-daemon avahi-utils rsync gh
sed -i 's/^# *ko_KR.UTF-8 UTF-8/ko_KR.UTF-8 UTF-8/' /etc/locale.gen
grep -qx 'ko_KR.UTF-8 UTF-8' /etc/locale.gen || echo 'ko_KR.UTF-8 UTF-8' >> /etc/locale.gen
locale-gen
update-locale LANG=ko_KR.UTF-8 LANGUAGE=ko_KR:ko:en
raspi-config nonint do_vnc 0
systemctl enable --now ssh avahi-daemon
runuser -u miru -- im-config -n ibus
systemctl is-active wayvnc ssh avahi-daemon
echo '설정 완료. 한글 환경 적용을 위해 작업을 저장한 뒤 로그아웃/로그인하세요.'
