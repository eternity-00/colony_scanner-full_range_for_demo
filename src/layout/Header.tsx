import {useEffect, useState} from 'react';
import type {AppState} from '../api/types.ts';
import {TABS, type TabKey} from '../config/defines.ts';
import {Logo} from '../shared/Logo.tsx';
import {TabIcon} from '../shared/TabIcon.tsx';
import {faultLabel, tempAbnormal} from '../utils/plate.ts';

interface Props {
  state: AppState;
  tab: TabKey;
  /** 관리자가 알림에서 곧장 장비 화면으로 넘어간다. */
  onDevice: () => void;
}

const NAME = new Map(TABS.map(([key, ko, en]) => [key, {ko, en}]));

/**
 * 헤더 (D2).
 *
 * 왼쪽 색면에 지금 보고 있는 화면을 못박고, 그 오른쪽에 작은 라벨 + 큰 값을 한 쌍씩
 * 늘어놓는다. 칩을 늘어놓는 것보다 읽는 순서가 생긴다.
 *
 * 여기에는 **장비 전체에 하나뿐인 값**만 둔다. 배양 진행이나 다음 촬영처럼
 * 플레이트마다 다른 값은 하나만 골라 적는 순간 나머지를 가리는 거짓말이 된다 —
 * 그건 스캐너 카드의 NEXT 와 상세 화면이 각자 말한다.
 *
 * 시계와 계정은 좌측 레일로 내려갔다.
 */
export function Header({state, tab, onDevice}: Props) {
  const [alert, setAlert] = useState(false);
  const devices = state.devices;
  const faulted = devices.filter(d => faultLabel(d));
  const faults = faulted.length;
  const linked = devices.filter(d => d.connected).length;
  const abnormal = devices.some(tempAbnormal);
  const name = NAME.get(tab);
  const isAdmin = state.session.role === 'admin';

  useEffect(() => {
    if (!alert) return;
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && setAlert(false);
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [alert]);

  const avg = (pick: (d: (typeof devices)[number]) => number) =>
    (devices.reduce((a, d) => a + pick(d), 0) / (devices.length || 1)).toFixed(1);

  return (
    <header>
      <span className="hd-mode">
        <TabIcon tab={tab} />
        <span className="hd-mode-t">
          <b>{name?.ko}</b>
          <em>{name?.en}</em>
        </span>
      </span>

      <span className="hd-meta">
        <span className="hm">
          <small>인큐베이터</small>
          <b>Incubator #1</b>
        </span>
        <span className="hm">
          <small>온도 · CO₂</small>
          <b className={abnormal ? 'bad' : ''}>
            {avg(d => d.temperature)} ℃ · {avg(d => d.co2)} %
          </b>
        </span>
        <span className="hm">
          <small>유선 연결</small>
          <b className={linked === devices.length ? '' : 'bad'}>
            {linked} / {devices.length}
          </b>
        </span>
      </span>

      <span className="hd-right">
        {/* 알림은 장비 문제 건수다. 0 이면 숫자를 붙이지 않는다 — 없는 것을
            0 으로 적으면 눈이 한 번 더 확인해야 한다.
            목록은 화면을 덮는 팝업이 아니라 종 밑에 붙는 말풍선이다 — 읽는
            자리라, 누른 곳에 붙어 있어야 어디서 나온 것인지가 눈으로 이어진다. */}
        <span className="bell-wrap">
          <button
            className="hd-bell"
            onClick={() => setAlert(v => !v)}
            aria-label={`장비 알림 ${faults}건`}
            aria-expanded={alert}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
              <path d="M5 18h14l-2-3V10a5 5 0 0 0-10 0v5z" />
              <path d="M10 21h4" />
            </svg>
            {faults > 0 && <i>{faults}</i>}
          </button>
          {alert && (
            <>
              <div className="pop-away" role="presentation" onMouseDown={() => setAlert(false)} />
              <section className="alert-pop" role="dialog" aria-label="장비 알림">
                <div className="pop-head">
                  <h2>장비 알림</h2>
                  <button className="pop-x" onClick={() => setAlert(false)} aria-label="닫기">
                    ×
                  </button>
                </div>
                {faults === 0 ? (
                  <p className="pop-empty">지금 문제가 있는 장비가 없습니다.</p>
                ) : (
                  <>
                    <ul className="alert-list">
                      {faulted.map(d => (
                        <li key={d.id}>
                          <b>{d.name}</b>
                          <span>{faultLabel(d)}</span>
                        </li>
                      ))}
                    </ul>
                    {/*
                      * 알리기만 하면 끝이 아니다. 분석자는 장비를 고칠 수 없으니
                      * 다음에 할 일(관리자를 부르는 것)을 적어 주고, 관리자는
                      * 고칠 수 있는 화면으로 바로 넘겨준다.
                      */}
                    {isAdmin ? (
                      <button
                        className="primary alert-go"
                        onClick={() => {
                          setAlert(false);
                          onDevice();
                        }}
                      >
                        장비 화면으로
                      </button>
                    ) : (
                      <p className="alert-ask">
                        <b>관리자에게 문의하세요.</b>
                        <span>오류 해제와 원점 복귀는 관리자 권한이 필요합니다.</span>
                      </p>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </span>
        <span className="wm">
          <Logo size={23} />
          <b>
            Colony<i>Scanner</i>
          </b>
        </span>
      </span>
    </header>
  );
}
