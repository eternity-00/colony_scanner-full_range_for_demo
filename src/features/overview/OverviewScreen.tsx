import {useState} from 'react';
import type {AppState} from '../../api/types.ts';
import {SLOTS_PER_DEVICE} from '../../config/defines.ts';
import {ActIcon} from '../../shared/ActIcon.tsx';
import {Badge} from '../../shared/Badge.tsx';
import {Modal} from '../../shared/Modal.tsx';
import {scannerNext} from '../../shared/ScannerHead.tsx';
import {alertItems} from '../../utils/alerts.ts';
import {active, pending, plateBad, totalRuns} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  openDetail: (deviceId: number, slot?: number) => void;
  openRegister: (deviceId: number, slot?: number) => void;
  onDevice: () => void;
  /** 스캐너 상태 칸을 눌렀을 때 — 칸별로 보는 현황 화면. */
  onStatus: () => void;
  onNeedAdmin: (where: string, what: string) => void;
}

/** 할 일 칸의 한 줄. 누르면 그 일을 하러 간다. */
interface Todo {
  key: 'wait' | 'send' | 'fault';
  label: string;
  value: number;
  unit: string;
  /** 줄 앞의 선 그림. 24 격자, 선 굵기 2. */
  path: string;
  go?: () => void;
}

/** 칸 이름 앞의 선 그림. */
const HEAD_ICON = {
  scanner: 'M4 5h16v14H4zM4 9.7h16M4 14.3h16M9.3 5v14M14.7 5v14',
  todo: 'M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2 2.3-2.2M4 18l1.2 1.2 2.3-2.2',
  alarm: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4',
};

/**
 * 색 없는 선 아이콘. 색은 글자와 같다 — 색 칩을 붙이면 칸마다 색이 하나씩 늘어
 * 정작 빨강(문제)이 묻힌다. 모양만으로 칸을 가른다.
 */
const Glyph = ({path}: {path: string}) => (
  <svg className="hsum-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
);


/**
 * 홈 (v2.0) — 큰 버튼 둘과 요약 칸 셋.
 *
 * 2차 피드백(상무님 요구): 홈을 단순하게. 접종기 UI 홈처럼 윗줄에 큰 동작
 * 버튼, 아랫줄에 상태 요약 칸을 둔다. 1.6 까지의 홈(트레이 24칸)은 상세 탭
 * 왼쪽으로 옮겼다 — 칸 하나하나를 보는 일은 상세의 몫이다.
 *
 * 윗줄: 장비 앞에 선 사람이 맨 먼저 하는 두 가지, 등록과 반출.
 * 아랫줄: 스캐너가 지금 어떤지 · 내가 할 일 · 알람. 숫자만 짧게 적고,
 * 자세한 것은 눌러서 들어간다.
 */
export function OverviewScreen({
  state,
  openDetail,
  openRegister,
  onDevice,
  onStatus,
  onNeedAdmin,
}: Props) {
  const [alertsOpen, setAlertsOpen] = useState(false);
  const device = state.devices[0];
  if (!device) return null;

  const plates = active(state).filter(p => p.deviceId === device.id);
  const need = totalRuns(state);
  const done = plates.filter(p => p.runs.length >= need).sort((a, b) => a.slot - b.slot);
  /*
   * 반출은 따로 탭이 없다. 상세에서 꺼낼 칸을 골라 둔 채로 연다 — 촬영을 다 마친
   * 판 중 첫 칸, 그런 판이 없으면 맨 앞 칸. 상세의 「플레이트 반출」이 확인을 받는다.
   */
  const removeTarget = done[0] ?? [...plates].sort((a, b) => a.slot - b.slot)[0];
  const openRemove = () => removeTarget && openDetail(device.id, removeTarget.slot);
  const unsent = plates.filter(p => pending(p) > 0);
  const bad = plates.filter(plateBad);
  const free = SLOTS_PER_DEVICE - plates.length;
  const next = scannerNext(state, device);
  const capturing = device.job?.status === 'running' && device.job.type === 'capture';
  const alerts = alertItems(state, {
    onDevice,
    onPlate: (deviceId, slot) => openDetail(deviceId, slot),
    onNeedAdmin,
  });

  const todos: Todo[] = [
    {
      key: 'wait',
      label: '반출 대기',
      value: done.length,
      unit: '매',
      path: 'M12 3v10M8 9l4 4 4-4M4 20h16',
      go: done.length ? openRemove : undefined,
    },
    {
      key: 'send',
      label: '미전송',
      value: unsent.reduce((a, p) => a + pending(p), 0),
      unit: '건',
      path: 'M12 19V7M6.5 12.5L12 7l5.5 5.5M4 4h16',
      go: unsent.length ? () => openDetail(device.id, unsent[0].slot) : undefined,
    },
    {
      key: 'fault',
      label: '문제 발생',
      value: bad.length,
      unit: '매',
      path: 'M12 4.5l8.5 15h-17zM12 10v4M12 17h.01',
      go: bad.length ? () => openDetail(device.id, bad[0].slot) : undefined,
    },
  ];
  const todoSum = todos.reduce((a, t) => a + t.value, 0);

  return (
    <div className="home">
      {/* 윗줄 — 홈에서 가장 큰 두 칸. */}
      <div className="home-acts">
        <button className="home-act primary" onClick={() => openRegister(device.id)} disabled={!free}>
          <ActIcon name="plus" />
          <span>
            <b>플레이트 등록</b>
            <small>{free ? `빈 슬롯 ${free}칸` : '빈 슬롯 없음'}</small>
          </span>
        </button>
        <button className="home-act" onClick={openRemove} disabled={!plates.length}>
          <ActIcon name="eject" />
          <span>
            <b>플레이트 반출</b>
            <small>{done.length ? `반출 대기 ${done.length}매` : `배양 중 ${plates.length}매`}</small>
          </span>
        </button>
      </div>

      {/*
        * 아랫줄 — 요약 셋. 세 칸이 같은 뼈대를 쓴다: 머리(이름 · 오른쪽 끝의
        * 한 마디) / 몸(그 칸의 주인공) / 발(누르면 어디로 가는지). 칸마다 생김새가
        * 다르면 눈이 칸마다 읽는 법을 새로 배운다.
        */}
      <div className="home-sum">
        {/* 스캐너 상태 — 누르면 칸별로 보는 현황으로 간다. */}
        <button className="card hsum" onClick={onStatus}>
          <span className="hsum-head">
            <Glyph path={HEAD_ICON.scanner} />
            <small>스캐너 상태</small>
            <Badge type={next.badgeType}>{next.badge}</Badge>
          </span>
          {/*
            * 크게 적는 것은 다음 촬영 시각이다. 장비 앞에 선 사람이 궁금한 것은
            * 「지금 몇 단계인지」가 아니라 「언제 찍히는지」다 — 단계는 몇 초마다 바뀌어
            * 지나가며 볼 값이 아니고, 촬영 중인지는 배지가 말한다. 단계는 촬영 화면에서 본다.
            */}
          <span className="hsum-body">
            <small>다음 촬영</small>
            {/* 찍고 있는 동안은 다음 시각이 아직 없다. 빈칸 대신 「지금」이라고 답한다. */}
            <b className={`hsum-big ${capturing ? 'now' : next.scheduled ? '' : 'idle'}`}>
              {capturing ? '지금 촬영 중' : next.label}
            </b>
          </span>
          <span className="hsum-facts">
            <span>
              <small>배양 중</small>
              <b>
                {plates.length}
                <em>/ {SLOTS_PER_DEVICE}칸</em>
              </b>
            </span>
            <span>
              <small>빈 슬롯</small>
              <b>
                {free}
                <em>칸</em>
              </b>
            </span>
          </span>
        </button>

        {/* 할 일 — 줄마다 그 일을 하러 간다. 0 인 줄은 누를 데가 없다. */}
        <section className="card hsum">
          <span className="hsum-head">
            <Glyph path={HEAD_ICON.todo} />
            <small>할 일</small>
            <em className={todoSum ? '' : 'none'}>{todoSum ? `${todoSum}건` : '없음'}</em>
          </span>
          <div className="hsum-todo">
            {todos.map(t => (
              <button key={t.key} className={t.key} disabled={!t.go} onClick={t.go}>
                <Glyph path={t.path} />
                <span>{t.label}</span>
                <b>
                  {t.value}
                  <em>{t.unit}</em>
                </b>
              </button>
            ))}
          </div>
        </section>

        {/* 알람 — 위에서부터 몇 줄을 바로 보여 준다. 줄을 누르면 그 일로, 아래 「전체 보기」는 목록 팝업. */}
        <section className="card hsum">
          <span className="hsum-head">
            <Glyph path={HEAD_ICON.alarm} />
            <small>알람</small>
            <em className={alerts.length ? 'bad' : 'none'}>{alerts.length ? `${alerts.length}건` : '없음'}</em>
          </span>
          {alerts.length ? (
            <>
              <ul className="hsum-alerts">
                {alerts.slice(0, 3).map(i => (
                  <li key={i.id} className={i.kind}>
                    <button disabled={!i.go} onClick={() => i.go?.()}>
                      <b>{i.where.replace(`${device.name} · `, '')}</b>
                      <span>{i.what}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button className="hsum-more" onClick={() => setAlertsOpen(true)}>
                전체 보기
              </button>
            </>
          ) : (
            <span className="hsum-body hsum-clear">
              <b>처리할 알람이 없습니다</b>
            </span>
          )}
        </section>
      </div>

      {alertsOpen && (
        <Modal title={`알람 · ${alerts.length}건`} onClose={() => setAlertsOpen(false)} bare>
          <ul className="alert-list home-alert-list">
            {alerts.map(i => (
              <li key={i.id} className={i.kind}>
                <button
                  disabled={!i.go}
                  onClick={() => {
                    setAlertsOpen(false);
                    i.go?.();
                  }}
                >
                  <b>{i.where}</b>
                  <span>{i.what}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}

    </div>
  );
}
