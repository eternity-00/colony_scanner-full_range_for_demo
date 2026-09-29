import type {AppState} from '../../api/types.ts';
import {ADMIN_IDLE_LIMIT_SEC, type SendCommand} from '../../config/defines.ts';
import {Modal} from '../../shared/Modal.tsx';

interface Props {
  state: AppState;
  send: SendCommand;
  operator: string;
  /** 표시 이름을 바꾸러 설정으로 보낸다. */
  onSettings: () => void;
  /** PIN 을 받아 관리자로 올린다. */
  onUpgrade: () => void;
  onClose: () => void;
}

/**
 * 레일의 계정을 눌렀을 때 뜨는 현재 사용자 카드.
 *
 * 예전에는 바로 PIN 키패드가 떴다. 그런데 계정을 누르는 사람이 늘 권한을
 * 올리려는 것은 아니다 — 지금 누구로 되어 있는지, 관리자가 언제 풀리는지를
 * 보려는 쪽이 더 많다. 그래서 먼저 상태를 보여 주고, 권한 전환은 그 안에서 고른다.
 */
export function UserCard({state, send, operator, onSettings, onUpgrade, onClose}: Props) {
  const isAdmin = state.session.role === 'admin';
  const idleLeft = Math.max(0, ADMIN_IDLE_LIMIT_SEC - Math.floor(state.session.idleFor / 1000));

  return (
    <Modal bare title="현재 사용자" onClose={onClose}>
      <div className="user-card">
        <i aria-hidden="true">{operator.slice(0, 1)}</i>
        <div>
          <small>{isAdmin ? '관리자 · ADMIN' : '분석자 · ANALYST'}</small>
          <b>{operator}</b>
          <span>
            {isAdmin
              ? `무조작 ${idleLeft}초 후 분석자로 자동 해제`
              : '장비를 움직이는 동작에는 PIN 이 필요합니다'}
          </span>
        </div>
      </div>

      <button className="link user-rename" onClick={onSettings}>
        설정에서 이름 바꾸기 →
      </button>

      <div className="actions">
        <button onClick={onClose}>닫기</button>
        {isAdmin ? (
          <button
            className="primary"
            onClick={() => {
              void send('role.logout', 0);
              onClose();
            }}
          >
            분석자로 전환
          </button>
        ) : (
          <button className="primary" onClick={onUpgrade}>
            관리자 전환
          </button>
        )}
      </div>
    </Modal>
  );
}
