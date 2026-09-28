import {useState} from 'react';
import {Modal} from './Modal.tsx';

interface Props {
  title: string;
  /** 시간 · 일 · 분 같은 단위. 숫자 오른쪽에 붙는다. */
  unit: string;
  value: number;
  min: number;
  max: number;
  /** 입력값이 이 배수여야 한다. 1이면 제약 없음. */
  step?: number;
  /** 한 번에 넣을 수 있는 자주 쓰는 값. */
  presets?: readonly number[];
  onConfirm: (value: number) => void;
  onClose: () => void;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * 숫자 입력용 터치 키패드.
 *
 * LCD는 터치뿐이라 <input type="number"> 의 위·아래 화살표는 손가락으로 누를 수
 * 없을 만큼 작다. 값을 누르면 이 키패드가 뜨고, 자주 쓰는 값은 한 번에 고른다.
 * PIN 키패드(.keypad)와 같은 크기·배치를 쓴다 — 같은 장비에서 손이 기억하는 위치다.
 */
export function NumberPad({
  title,
  unit,
  value,
  min,
  max,
  step = 1,
  presets,
  onConfirm,
  onClose,
}: Props) {
  const [text, setText] = useState(String(value));

  const n = Number(text);
  const empty = text === '';
  // 왜 안 되는지 말해 주지 않으면 사용자는 키패드만 계속 누른다.
  const error = empty
    ? `${min} ~ ${max} 사이의 값을 입력하세요.`
    : n < min || n > max
      ? `${min} ~ ${max} 사이만 넣을 수 있습니다.`
      : step > 1 && n % step !== 0
        ? `${step}${unit} 단위로만 넣을 수 있습니다.`
        : '';

  const press = (key: string) => setText(t => (t === '0' ? key : (t + key).slice(0, 4)));

  return (
    <Modal title={title} onClose={onClose} bare>
      <div className={`padview ${error && !empty ? 'error' : ''}`}>
        <b>{empty ? '—' : text}</b>
        <i>{unit}</i>
      </div>
      <p className={`pad-hint ${error ? 'bad' : ''}`}>
        {error || `입력 가능 범위 ${min} ~ ${max}${unit}`}
      </p>
      {presets && presets.length > 0 && (
        <div className="pad-presets">
          {presets.map(p => (
            <button
              key={p}
              className={n === p && !empty ? 'on' : ''}
              onClick={() => setText(String(p))}
            >
              {p}
              <em>{unit}</em>
            </button>
          ))}
        </div>
      )}
      <div className="keypad">
        {KEYS.map(k => (
          <button key={k} onClick={() => press(k)}>
            {k}
          </button>
        ))}
        <button className="kp-clear" onClick={() => setText('')}>
          지움
        </button>
        <button onClick={() => press('0')}>0</button>
        <button className="kp-back" onClick={() => setText(t => t.slice(0, -1))}>
          ⌫
        </button>
      </div>
      <div className="actions">
        <button onClick={onClose}>취소</button>
        <button className="primary" disabled={!!error} onClick={() => onConfirm(n)}>
          확인
        </button>
      </div>
    </Modal>
  );
}
