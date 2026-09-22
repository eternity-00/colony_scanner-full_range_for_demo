import {useState} from 'react';
import type {AppState} from '../../api/types.ts';
import type {SendCommand} from '../../config/defines.ts';
import {Modal} from '../../shared/Modal.tsx';

interface Props {
  state: AppState;
  send: SendCommand;
  onClose: () => void;
}

const PIN_LENGTH = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function RoleDialog({state, send, onClose}: Props) {
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
    } catch (e) {
      setPin('');
      setError(e instanceof Error ? e.message : '알 수 없는 오류입니다.');
    }
  };

  return (
    <Modal title="권한 전환" onClose={onClose}>
      {state.session.role === 'admin' ? (
        <>
          <p>관리자 권한이 열려 있습니다.</p>
          <button
            onClick={async () => {
              await send('role.logout', 0);
              onClose();
            }}
          >
            분석자로 전환
          </button>
        </>
      ) : (
        <>
          <p>관리자 전환을 위해 {PIN_LENGTH}자리 PIN을 입력하세요.</p>
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
          <button
            className="primary pin-go"
            disabled={pin.length !== PIN_LENGTH || state.session.lockedFor > 0}
            onClick={login}
          >
            관리자 전환
          </button>
        </>
      )}
    </Modal>
  );
}
