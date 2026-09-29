/**
 * 제품 표식 — 6-well 플레이트.
 *
 * 이 장비가 다루는 것이 6-well 플레이트라, 그 모양을 그대로 쓴다(`WELLS = 6`).
 * 테두리는 플레이트, 안의 원 여섯은 Well 이고, 하나만 주황이라 「찍고 있는 칸」을
 * 뜻한다 — 현황 트레이의 색 규칙과 같다.
 *
 * 헤더는 받은 로고 파일(public/logo.png)을 그대로 쓰고, 이 컴포넌트는 색을
 * 물려받아야 하는 자리(파비콘·아이콘 원본)의 기준 도형으로 남긴다.
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
            fill={row === 1 && col === 2 ? 'var(--well-mark, #f29a2e)' : 'currentColor'}
          />
        )),
      )}
    </svg>
  );
}
