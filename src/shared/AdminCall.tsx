import type {AppState, Device} from '../api/types.ts';
import {faultLabel} from '../utils/plate.ts';

/**
 * 장비에 문제가 생겼을 때 현황 화면에 띄우는 안내줄.
 *
 * 고장을 고치는 동작(오류 해제·원점 복귀·모듈 초기화·캘리브레이션)과 장비 화면은
 * 관리자 전용이라, 사용자는 문제를 봐도 할 수 있는 일이 없다. 그래서 무엇이
 * 고장났는지와 함께 「관리자에게 문의하세요」를 같이 적는다.
 *
 * 팝업으로 저절로 뜨게 하지 않는다 — 하던 일을 끊기 때문이다.
 * 관리자에게도 띄우지 않는다. 장비 화면에서 직접 조치하면 된다.
 */
export function AdminCall({state, devices}: {state: AppState; devices: Device[]}) {
  if (state.session.role === 'admin') return null;
  const faulted = devices.filter(d => faultLabel(d));
  if (!faulted.length) return null;

  return (
    <div className="admin-call" role="status">
      <i aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 4.5l8.5 15h-17z" />
          <path d="M12 10v4M12 17h.01" />
        </svg>
      </i>
      <div className="ac-body">
        <b>장비에 문제가 있습니다 · 관리자에게 문의하세요</b>
        <span>{faulted.map(d => `${d.name} · ${faultLabel(d)}`).join('  /  ')}</span>
      </div>
    </div>
  );
}
