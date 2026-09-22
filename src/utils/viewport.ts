import {useEffect, useState} from 'react';

/**
 * 화면 폭을 픽셀이 아니라 rem 으로 잰다.
 *
 * 같은 1024px 라도 7인치 패널과 10인치 패널은 글자·버튼의 실제 크기가 두 배 가까이
 * 다르다. --ui-scale 로 루트 글자 크기를 조정해 물리적 크기를 맞추므로, "넓다/좁다"
 * 판단도 픽셀이 아니라 루트 글자 크기 대비로 해야 한다.
 */
export type LayoutWidth = 'sm' | 'md' | 'lg';

/** 스캐너 4대를 한 줄에 놓을 수 있는 최소 폭(rem). */
const LG_REM = 64;
/** 헤더와 카드가 원래 밀도를 유지할 수 있는 최소 폭(rem). 이 아래는 덜어낸다. */
const MD_REM = 48;

/** 루트 글자 크기(px). rem 단위를 픽셀로 환산할 때 쓴다. */
export const rootFontPx = () =>
  parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

const measure = (): LayoutWidth => {
  const rem = window.innerWidth / rootFontPx();
  if (rem >= LG_REM) return 'lg';
  if (rem >= MD_REM) return 'md';
  return 'sm';
};

export function useLayoutWidth(): LayoutWidth {
  const [width, setWidth] = useState<LayoutWidth>(measure);
  useEffect(() => {
    const update = () => setWidth(measure());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width;
}

/**
 * --ui-scale 을 정한다. 우선순위: ?scale= 쿼리 → 저장된 값 → 1.
 * 키오스크 런처가 패널에 맞는 값을 URL 로 넘긴다(run-lcd.sh).
 */
export function applyUiScale() {
  const KEY = 'colony-ui-scale';
  let value: string | null = null;
  try {
    const q = new URLSearchParams(location.search).get('scale');
    if (q && Number(q) > 0) {
      value = q;
      localStorage.setItem(KEY, q);
    } else {
      value = localStorage.getItem(KEY);
    }
  } catch {
    /* 저장소를 못 쓰면 기본 배율로 간다. */
  }
  if (value && Number(value) > 0) {
    document.documentElement.style.setProperty('--ui-scale', value);
  }
}
