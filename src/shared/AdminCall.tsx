import type {Device} from '../api/types.ts';
import {faultLabel} from '../utils/plate.ts';
import {Modal} from './Modal.tsx';

/**
 * 장비에 문제가 생겼을 때 사용자에게 띄우는 팝업.
 *
 * 고장을 고치는 동작(오류 해제·원점 복귀·모듈 초기화·캘리브레이션)과 장비 화면은
 * 관리자 전용이라, 사용자는 문제를 봐도 할 수 있는 일이 없다. 그래서 무엇이
 * 고장났는지와 함께 「관리자에게 문의하세요」를 같이 적는다.
 *
 * 언제 뜨는지는 App 이 정한다 — 새 고장이 생긴 순간 한 번만.
 */
export function AdminCall({devices, onClose}: {devices: Device[]; onClose: () => void}) {
  return (
    <Modal title="관리자에게 문의하세요" onClose={onClose}>
      <p>
        장비에 문제가 생겼습니다. 조치에는 관리자 권한이 필요하니 관리자를 불러 주세요.
      </p>
      <ul className="fault-list">
        {devices.map(d => (
          <li key={d.id}>
            <b>{d.name}</b>
            <span>{faultLabel(d)}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
