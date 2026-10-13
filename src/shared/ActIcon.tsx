import type {ReactNode} from 'react';

/**
 * 버튼에 붙는 동작 아이콘.
 *
 * 글자만 있는 버튼이 넉 장 나란히 서면 눈이 다 읽고서야 어느 것인지 안다.
 * 모양이 먼저 들어오면 「시작」과 「정지」를 읽지 않고 고른다 — 장갑 낀 손으로
 * 급히 누르는 자리라 그 반 박자가 크다.
 *
 * 메뉴 아이콘(TabIcon)과 같은 선 굵기·24 격자를 쓴다. 한 장비에서 같은 손이
 * 읽는 그림이라 서로 다른 화풍이 섞이면 따로 배워야 한다.
 */
const PATHS: Record<string, ReactNode> = {
  /** 촬영 시작 — 재생 세모 */
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  /** 일시정지 — 막대 둘 */
  pause: (
    <>
      <path d="M9 5.5v13" />
      <path d="M15 5.5v13" />
    </>
  ),
  /** 비상 정지 — 꽉 찬 네모. 세모(재생)와 가장 멀리 떨어진 꼴이다. */
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />,
  /*
   * 재전송과 반출은 둘 다 「밖으로 내보낸다」라 화살표 방향만으로는 갈린 뜻이
   * 안 선다. 재전송은 실패한 것을 *다시* 하는 일이라 도는 화살표로,
   * 반출은 판이 장비에서 빠져나오는 일이라 받침 위로 뜨는 화살표로 그린다.
   */
  /** 재전송 — 되돌아 도는 화살표 */
  send: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20.5 4v5h-5" />
    </>
  ),
  /** 플레이트 반출 — 받침에서 위로 빠져나오는 판 */
  eject: (
    <>
      <path d="M12 13V4" />
      <path d="M8.5 7.5 12 4l3.5 3.5" />
      <path d="M4.5 16.5v2a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </>
  ),
  /** 플레이트 등록 — 네모 안의 더하기. 서랍의 등록 탭과 같은 그림이다. */
  plus: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  /** 플레이트 상세 — 돋보기. 레일의 상세 탭과 같은 그림이다. */
  find: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20.5 20.5l-4.2-4.2" />
    </>
  ),
};

export type ActKey = keyof typeof PATHS;

export function ActIcon({name}: {name: ActKey}) {
  return (
    <svg
      className="acti"
      viewBox="0 0 24 24"
      fill={name === 'play' || name === 'stop' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
