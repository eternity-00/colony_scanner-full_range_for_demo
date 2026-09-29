# 제품 표식

6-well 플레이트. 이 장비가 다루는 것이 6-well 플레이트라 그 모양을 그대로 쓴다.
원 하나만 주황인 것은 「찍고 있는 칸」이고, 현황 트레이의 색 규칙과 같다.

원본은 `docs/ColonyScanner_2단락업_라이트.svg` 다. 폰트 참조 없는 순수 도형이라
그대로 쓴다 — 화면 로고(`src/assets/logo.svg`)와 파비콘(`public/favicon.svg`)이
같은 좌표·같은 색(#3F7A96 · #F29A2E)을 쓴다. 로고가 바뀌면 그 파일만 갈아 끼우면 된다.

- `colony-scanner.svg` — 바탕화면 아이콘 원본. 파란 타일 위에 흰 원 여섯.
  작은 크기(48px)에서 테두리가 뭉개져서 플레이트 테두리는 빼고 원만 남겼다.
- `colony-scanner-*.png` — 위 SVG 를 크기별로 뜬 것. 라즈베리파이 hicolor 테마에 깐다.
- `colony-scanner-v5.*` — v5(좌측 레일) 배포용. 파이에 v4 와 v5 아이콘이 나란히 놓이므로
  한눈에 갈라져야 한다. 왼쪽 파란 띠가 레일, 오른쪽 회색 면이 본문이다.
  ImageMagick 의 SVG 렌더러가 `clipPath` 를 제대로 못 그려서, 둥근 모서리는
  겹쳐 그리는 방식으로 냈다(둥근 사각 + 오른쪽을 각지게 덮는 사각).
- `../../public/favicon.svg` · `src/shared/Logo.tsx` — 화면 안에서 쓰는 형태.
  흰 바탕에 놓이므로 타일 없이 플레이트 테두리 + 원으로 그린다.

## 다시 만들 때

```sh
for s in 256 128 64 48; do
  convert -background none assets/icon/colony-scanner.svg -resize ${s}x${s} assets/icon/colony-scanner-${s}.png
done
```

## 파이에 까는 곳

```
~/.local/share/icons/hicolor/<크기>/apps/colony-scanner-v4.png
```

`~/Desktop/Colony Scanner v4.desktop` 의 `Icon=colony-scanner-v4` 가 이 이름을 가리킨다.
바꾼 뒤에는 `gtk-update-icon-cache -f ~/.local/share/icons/hicolor` 로 캐시를 새로 만든다.
