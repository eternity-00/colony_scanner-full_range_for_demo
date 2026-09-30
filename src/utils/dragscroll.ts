/**
 * 목록을 손가락으로 집어 끌어 올린다.
 *
 * 스크롤이 생기는 자리(이벤트 로그 서랍, 알림 목록, 표, 설정 화면…)에서
 * 가느다란 스크롤 막대를 정확히 잡아야만 움직였다. 이 패널이 리눅스에서
 * 마우스로 잡히기 때문이다 — 브라우저가 터치 이벤트 대신 마우스 이벤트를
 * 만들어 주고, 그러면 손가락으로 쓸어 넘기는 기본 동작이 켜지지 않는다.
 * touch.ts 가 hover 로 겪은 것과 같은 뿌리다.
 *
 * 그래서 직접 끌어 준다. 문서에 한 번만 붙여 두고, 눌린 자리에서 가장 가까운
 * 「스크롤되는 조상」을 찾아 손가락을 따라 scrollTop 을 옮긴다.
 *
 * 누르기와 끌기를 가르는 것은 움직인 거리다. 6px 을 넘기 전에는 아무것도 하지
 * 않으므로 버튼은 그대로 눌린다. 넘고 나면 그 다음에 올 click 한 번을 막는다 —
 * 목록을 쓸어 넘겼을 뿐인데 손을 뗀 자리의 줄이 눌리면 안 된다.
 */

/** 이만큼 움직여야 「끌기」로 본다. 그 전까지는 누르기다. */
const THRESHOLD = 6;
/** 글자를 넣는 자리에서는 끌지 않는다 — 커서를 옮기는 동작과 부딪힌다. */
const TYPING = 'input,textarea,select,[contenteditable]';

/** 이 요소가 세로로 넘쳐 있고 스크롤을 허용하는가. */
function scrolls(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  const oy = getComputedStyle(el).overflowY;
  return oy === 'auto' || oy === 'scroll';
}

/** 눌린 자리에서 위로 올라가며 처음 만나는 스크롤 상자. */
function findBox(start: Element | null): HTMLElement | null {
  for (let el = start; el && el !== document.body; el = el.parentElement) {
    if (scrolls(el)) return el as HTMLElement;
  }
  return null;
}

export function enableDragScroll() {
  let box: HTMLElement | null = null;
  let startY = 0;
  let startTop = 0;
  let moved = false;
  let pointer = -1;

  const end = () => {
    if (moved) {
      // 끌고 난 뒤의 click 한 번만 삼킨다. 캡처 단계라 버튼에 닿기 전에 걸린다.
      document.addEventListener('click', swallow, {capture: true, once: true});
    }
    box = null;
    moved = false;
    pointer = -1;
  };

  const swallow = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };

  document.addEventListener(
    'pointerdown',
    e => {
      if (e.button !== 0 || (e.target as Element)?.closest?.(TYPING)) return;
      const found = findBox(e.target as Element);
      if (!found) return;
      // 스크롤 막대를 직접 잡은 것이면 브라우저에 맡긴다.
      const r = found.getBoundingClientRect();
      if (e.clientX > r.left + found.clientWidth) return;
      box = found;
      startY = e.clientY;
      startTop = found.scrollTop;
      moved = false;
      pointer = e.pointerId;
    },
    {passive: true},
  );

  document.addEventListener(
    'pointermove',
    e => {
      if (!box || e.pointerId !== pointer) return;
      const dy = e.clientY - startY;
      if (!moved) {
        if (Math.abs(dy) < THRESHOLD) return;
        moved = true;
      }
      box.scrollTop = startTop - dy;
    },
    {passive: true},
  );

  document.addEventListener('pointerup', end, {passive: true});
  document.addEventListener('pointercancel', end, {passive: true});
}
