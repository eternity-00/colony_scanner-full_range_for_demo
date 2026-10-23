#!/bin/bash
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
umask 077
log=$here/install-system.log
status=$here/install-system.status
printf 'running\n' > "$status"
echo '한국어 입력기·글꼴 및 장치 도구를 설치합니다. sudo 암호를 이 창에 입력하세요.'
sudo /bin/bash $here/setup-system.sh 2>&1 | tee "$log"
result=${PIPESTATUS[0]}
printf '%s\n' "$result" > "$status"
if [[ $result -eq 0 ]]; then
  $here/korean-session.sh
  echo '설치 완료. 새 앱부터 한글 입력을 확인하세요. 전체 적용은 저장 후 재로그인하세요.'
else
  echo "설치 실패 (종료 코드 $result). 로그: $log"
fi
read -r -p 'Enter 키를 누르면 창을 닫습니다.'
