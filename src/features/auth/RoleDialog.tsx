import {useState} from 'react';
import type {AppState} from '../../api/types.ts';
import type {SendCommand} from '../../config/defines.ts';
import {Modal} from '../../shared/Modal.tsx';

interface Props {
  state: AppState;
  send: SendCommand;
  onClose: () => void;
  /** 막힌 동작 이름. 주면 "관리자 확인" 팝업으로 열린다. */
  reason?: string;
  /** PIN 이 맞은 뒤 이어서 할 일. 막혔던 동작을 그대로 다시 보낸다. */
  onAuthed?: () => void;
}

const PIN_LENGTH = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function RoleDialog({state, send, onClose, reason, onAuthed}: Props) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const press = (key: string) => {
    setError('');
    setPin(p => (p + key).slice(0, PIN_LENGTH));
  };

  const login = async () => {
    try {
      await send('role.login', 0, {pin});
      onClose();
      onAuthed?.();
    } catch (e) {
      setPin('');
      setError(e instanceof Error ? e.message : '알 수 없는 오류입니다.');
    }
  };

  const logout = async () => {
    await send('role.logout', 0);
    onClose();
  };

  // 두 얼굴 모두 아래 줄이 [취소] [실행] 이다. 본문에 실행 버튼을 따로 두면
  // 팝업 하나에 누를 곳이 셋(본문 버튼 · 닫기 · ×)이 되어 어디를 눌러야
  // 되는지가 흐려진다. 실행은 늘 오른쪽 아래 한 곳이다.
  const asking = !(state.session.role === 'admin' && !reason);

  return (
    <Modal
      title={reason ? '관리자 확인이 필요합니다' : '권한 전환'}
      onClose={onClose}
      onConfirm={asking ? login : logout}
      confirmDisabled={asking && (pin.length !== PIN_LENGTH || state.session.lockedFor > 0)}
      confirmLabel={asking ? (reason ? '확인하고 계속' : '확인') : '사용자로 전환'}
    >
      {state.session.role === 'admin' && !reason ? (
        <p>관리자 권한이 열려 있습니다.</p>
      ) : (
        <>
          {reason ? (
            <p>
              <b>{reason}</b>은(는) 장비를 움직이는 동작이라 관리자 권한이 필요합니다. PIN{' '}
              {PIN_LENGTH}자리를 입력하면 이어서 진행합니다.
            </p>
          ) : (
            <p>관리자 전환을 위해 {PIN_LENGTH}자리 PIN을 입력하세요.</p>
          )}
          <div className={`pindots ${error ? 'error' : ''}`}>
            {Array.from({length: PIN_LENGTH}, (_, i) => (
              <i key={i} className={pin.length > i ? 'on' : ''} />
            ))}
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="keypad">
            {KEYS.map(k => (
              <button key={k} onClick={() => press(k)}>
                {k}
              </button>
            ))}
            <button
              className="kp-clear"
              onClick={() => {
                setPin('');
                setError('');
              }}
            >
              지움
            </button>
            <button onClick={() => press('0')}>0</button>
            <button className="kp-back" onClick={() => setPin(p => p.slice(0, -1))}>
              ⌫
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
