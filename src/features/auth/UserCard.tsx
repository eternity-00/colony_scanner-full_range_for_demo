import {useEffect} from 'react';
import type {AppState} from '../../api/types.ts';
import {ADMIN_IDLE_LIMIT_SEC, type SendCommand} from '../../config/defines.ts';

interface Props {
  state: AppState;
  send: SendCommand;
  /** 사용자 설정 화면으로 보낸다. */
  onSettings: () => void;
  /** PIN 을 받아 관리자로 올린다. */
  onUpgrade: () => void;
  onClose: () => void;
}

/**
 * 레일의 계정을 눌렀을 때 그 옆에 붙는 말풍선.
 *
 * 예전에는 바로 PIN 키패드가 떴다. 그런데 계정을 누르는 사람이 늘 권한을
 * 올리려는 것은 아니다 — 지금 누구로 되어 있는지, 관리자가 언제 풀리는지를
 * 보려는 쪽이 더 많다. 그래서 먼저 상태를 보여 주고, 권한 전환은 그 안에서 고른다.
 *
 * 화면을 덮는 팝업이 아니라 말풍선인 이유: 결정을 요구하는 자리가 아니라 읽는
 * 자리다. 누른 곳에 붙어 있으면 어디서 나온 것인지가 눈으로 이어지고, 뒤 화면을
 * 어둡게 하지 않으니 보던 것을 잃지 않는다.
 */
export function UserCard({state, send, onSettings, onUpgrade, onClose}: Props) {
  const isAdmin = state.session.role === 'admin';
  const idleLeft = Math.max(0, ADMIN_IDLE_LIMIT_SEC - Math.floor(state.session.idleFor / 1000));

  useEffect(() => {
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <>
      {/* 바깥을 누르면 닫힌다. 어둡게 덮지 않으므로 뒤 화면은 그대로 보인다. */}
      <div className="pop-away" role="presentation" onMouseDown={onClose} />
      <section className="user-pop" role="dialog" aria-label="현재 사용자">
        <div className="pop-head">
          <h2>현재 사용자</h2>
          <button className="pop-x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="user-card">
          <i aria-hidden="true">{isAdmin ? '관' : '사'}</i>
          <div>
            <small>{isAdmin ? 'ADMIN' : 'USER'}</small>
            <b>{isAdmin ? '관리자' : '사용자'}</b>
          </div>
        </div>

        <p className="user-note">
          {isAdmin
            ? `무조작 ${idleLeft}초 후 사용자로 자동 해제됩니다.`
            : '장비를 움직이는 동작에는 PIN 이 필요합니다.'}
        </p>

        <div className="user-act">
          <button onClick={onSettings}>설정</button>
          {isAdmin ? (
            <button
              className="primary"
              onClick={() => {
                void send('role.logout', 0);
                onClose();
              }}
            >
              사용자로 전환
            </button>
          ) : (
            <button className="primary" onClick={onUpgrade}>
              관리자 전환
            </button>
          )}
        </div>
      </section>
    </>
  );
}
