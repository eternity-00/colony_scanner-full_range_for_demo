/**
 * 제품 표식 — 6-well 플레이트.
 *
 * 이 장비가 다루는 것이 6-well 플레이트라, 그 모양을 그대로 쓴다(`WELLS = 6`).
 * 테두리는 플레이트, 안의 원 여섯은 Well 이고, 하나만 주황이라 「찍고 있는 칸」을
 * 뜻한다 — 현황 트레이의 색 규칙과 같다.
 *
 * PNG 가 아니라 SVG 인 이유: LCD 의 UI 배율(UI_SCALE)이 패널마다 달라서 PNG 는
 * 배율이 바뀌면 흐려진다. 색도 CSS 에서 바꿀 수 있고 파일 요청이 없다.
 * 바탕화면 아이콘은 이 그림을 PNG 로 떠서 쓴다(`scripts/make-icon.mjs`).
 */
export function Logo({size = 26}: {size?: number}) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect x="1.5" y="4.5" width="29" height="23" rx="4.5" stroke="currentColor" strokeWidth="2.2" />
      {[0, 1].map(row =>
        [0, 1, 2].map(col => (
          <circle
            key={`${row}-${col}`}
            cx={8 + col * 8}
            cy={12 + row * 8}
            r="2.9"
            fill={row === 1 && col === 2 ? 'var(--well-mark, #e8971a)' : 'currentColor'}
          />
        )),
      )}
    </svg>
  );
}
