/**
 * 손가락으로 쓰는 화면에서는 hover 를 완전히 끈다.
 *
 * hover 규칙은 전부 `@media (hover:hover) and (pointer:fine)` 안에 있다. 보통은
 * 터치 패널에서 이 조건이 거짓이라 그대로 꺼지지만, 믿을 수 없다 — 리눅스에서
 * 터치스크린이 마우스로 잡히면 조건이 참으로 남고, 그러면 브라우저가 터치
 * 이벤트 대신 마우스 이벤트를 만들어 `touchstart` 도 오지 않는다. 손가락이
 * 떨어져도 포인터가 「떠난」 적이 없으니 누른 자리에 hover 가 눌어붙는다.
 * PIN 키패드에서 0 을 네 번 누르면 0 만 계속 눌린 것처럼 보이던 게 이 경우다.
 *
 * 그래서 조건을 세 갈래로 잡는다. 하나라도 걸리면 그 블록들을 꺼 버린다.
 */

/** hover 규칙이 들어 있는 @media 블록을 모두 끈다. */
function killHoverRules() {
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // 교차 출처 스타일시트는 읽을 수 없다.
    }
    for (const rule of Array.from(rules)) {
      // 브라우저마다 conditionText 의 공백이 달라서 지우고 비교한다.
      if (
        rule instanceof CSSMediaRule &&
        rule.conditionText.replace(/\s+/g, '').includes('hover:hover')
      ) {
        rule.media.mediaText = 'not all';
      }
    }
  }
}

/** 키오스크 런처가 붙이는 표시. run-v4.sh 는 항상 ?scale= 을 달고 연다. */
function isKiosk() {
  try {
    const q = new URLSearchParams(location.search);
    return q.has('scale') || q.has('kiosk');
  } catch {
    return false;
  }
}

export function disableHoverOnTouch() {
  // 1. 키오스크로 열렸으면 볼 것도 없다. 마우스가 없는 패널이다.
  if (isKiosk()) {
    killHoverRules();
    return;
  }
  // 2·3. 손가락이 닿으면 그때 끈다. 터치 이벤트가 오지 않는 패널을 대비해
  //      포인터 이벤트도 같이 본다(pointerType 이 touch 면 손가락이다).
  const off = () => {
    killHoverRules();
    window.removeEventListener('touchstart', onTouch);
    window.removeEventListener('pointerdown', onPointer);
  };
  const onTouch = () => off();
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') off();
  };
  window.addEventListener('touchstart', onTouch, {passive: true});
  window.addEventListener('pointerdown', onPointer, {passive: true});
}
