import {useEffect, useState} from 'react';
import type {AppState} from '../api/types.ts';
import {active, faultLabel, pending, plateBad, pos, totalRuns} from '../utils/plate.ts';

interface Props {
  state: AppState;
  /** 관리자가 장비 오류를 고치러 간다. */
  onDevice: () => void;
  /** 플레이트를 손보러 상세로 간다. */
  onPlate: (deviceId: number, slot: number) => void;
  /** 분석자가 장비 오류 줄을 눌렀을 때 — 할 수 없는 일이라고 알린다. */
  onNeedAdmin: (where: string, what: string) => void;
}

type Kind = 'device' | 'plate' | 'done';

interface Item {
  id: string;
  kind: Kind;
  /** 어디서 난 일인지 — SCANNER 3 · 8단 1열 */
  where: string;
  /** 무슨 일인지 */
  what: string;
  go?: () => void;
}

/** 목록에 한 번에 펼치는 최대 줄 수. 넘치면 「외 N건」으로 접는다. */
const MAX = 7;

/**
 * 헤더의 알림 종.
 *
 * 여기 모으는 것은 **손대기 전까지 사라지지 않는 일**뿐이다. 그래서 화면을 보지
 * 않는 동안 생긴 일도 놓치지 않는다 — 읽음 표시가 없어도 된다. 반대로 스스로
 * 사라지는 사건(도어를 여닫음, 촬영 한 회가 성공)은 알려도 할 일이 없어 넣지 않는다.
 * 지난 일의 기록은 장비 화면의 이벤트 로그가 맡는다.
 *
 * 세 가지를 센다 — 장비 오류 · 손봐야 하는 플레이트 · 반출을 기다리는 플레이트.
 * 줄마다 갈 곳이 다르다. 플레이트는 상세로, 장비 오류는 관리자면 장비 화면으로,
 * 분석자면 왜 못 고치는지를 알리는 팝업으로 간다.
 */
export function AlertBell({state, onDevice, onPlate, onNeedAdmin}: Props) {
  const [open, setOpen] = useState(false);
  const isAdmin = state.session.role === 'admin';

  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [open]);

  const name = (id: number) => state.devices.find(d => d.id === id)?.name ?? `SCANNER ${id}`;
  const need = totalRuns(state);
  const plates = active(state);

  const items: Item[] = [
    ...state.devices
      .filter(d => faultLabel(d))
      .map<Item>(d => ({
        id: `d${d.id}`,
        kind: 'device',
        where: d.name,
        what: faultLabel(d) as string,
        // 관리자는 고치러 가고, 분석자는 왜 못 고치는지를 듣는다.
        go: isAdmin ? onDevice : () => onNeedAdmin(d.name, faultLabel(d) as string),
      })),
    ...plates.filter(plateBad).map<Item>(p => ({
      id: `b${p.id}`,
      kind: 'plate',
      where: `${name(p.deviceId)} · ${pos(p.slot)}`,
      what: p.runs.at(-1)?.imageState === 'failed' ? '촬영 실패' : `미전송 ${pending(p)}건`,
      go: () => onPlate(p.deviceId, p.slot),
    })),
    ...plates
      .filter(p => p.runs.length >= need)
      .map<Item>(p => ({
        id: `w${p.id}`,
        kind: 'done',
        where: `${name(p.deviceId)} · ${pos(p.slot)}`,
        what: `촬영 완료 ${p.runs.length}/${need}`,
        go: () => onPlate(p.deviceId, p.slot),
      })),
  ];

  const faulted = items.some(i => i.kind === 'device');
  const shown = items.slice(0, MAX);

  return (
    <span className="bell-wrap">
      <button
        className="hd-bell"
        onClick={() => setOpen(v => !v)}
        aria-label={`알림 ${items.length}건`}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M5 18h14l-2-3V10a5 5 0 0 0-10 0v5z" />
          <path d="M10 21h4" />
        </svg>
        {items.length > 0 && <i className={faulted ? 'bad' : ''}>{items.length}</i>}
      </button>

      {open && (
        <>
          <div className="pop-away" role="presentation" onMouseDown={() => setOpen(false)} />
          <section className="alert-pop" role="dialog" aria-label="알림">
            <div className="pop-head">
              <h2>알림</h2>
              <button className="pop-x" onClick={() => setOpen(false)} aria-label="닫기">
                ×
              </button>
            </div>

            {items.length === 0 ? (
              <p className="pop-empty">지금 처리할 일이 없습니다.</p>
            ) : (
              <ul className="alert-list">
                {shown.map(i => (
                  <li key={i.id} className={i.kind}>
                    <button
                      disabled={!i.go}
                      onClick={() => {
                        setOpen(false);
                        i.go?.();
                      }}
                    >
                      <b>{i.where}</b>
                      <span>{i.what}</span>
                    </button>
                  </li>
                ))}
                {items.length > MAX && <li className="alert-more">외 {items.length - MAX}건</li>}
              </ul>
            )}
          </section>
        </>
      )}
    </span>
  );
}
