# 제품 표식

6-well 플레이트. 이 장비가 다루는 것이 6-well 플레이트라 그 모양을 그대로 쓴다.
원 하나만 주황인 것은 「찍고 있는 칸」이고, 현황 트레이의 색 규칙과 같다.

- `colony-scanner.svg` — 바탕화면 아이콘 원본. 파란 타일 위에 흰 원 여섯.
  작은 크기(48px)에서 테두리가 뭉개져서 플레이트 테두리는 빼고 원만 남겼다.
- `colony-scanner-*.png` — 위 SVG 를 크기별로 뜬 것. 라즈베리파이 hicolor 테마에 깐다.
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
