/**
 * 손가락으로 한 번이라도 눌렀으면 hover 를 완전히 끈다.
 *
 * hover 규칙은 전부 `@media (hover:hover) and (pointer:fine)` 안에 있다. 보통은
 * 터치 패널에서 이 조건이 거짓이라 그대로 꺼지지만, 리눅스에서 터치스크린을
 * 마우스로 잡는 크로뮴이 있어 조건이 참으로 남는 경우가 있다. 그러면 누른 자리에
 * hover 가 붙어 있다가, 화면을 옮겨도 그 자리에 새로 그려진 버튼이 눌린 것처럼
 * 옅게 떠 있는다.
 *
 * 첫 touchstart 때 그 블록들의 조건을 꺼서, 어느 쪽이든 결과가 같게 만든다.
 */
export function disableHoverOnTouch() {
  const off = () => {
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
  };
  window.addEventListener('touchstart', off, {once: true, passive: true});
}
