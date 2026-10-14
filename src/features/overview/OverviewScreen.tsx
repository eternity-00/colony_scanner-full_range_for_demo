import type {AppState} from '../../api/types.ts';
import {SLOTS_PER_DEVICE} from '../../config/defines.ts';
import {ActIcon} from '../../shared/ActIcon.tsx';
import {Badge} from '../../shared/Badge.tsx';
import {scannerNext} from '../../shared/ScannerHead.tsx';
import {alertItems} from '../../utils/alerts.ts';
import {active, totalRuns} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  openDetail: (deviceId: number, slot?: number) => void;
  openRegister: (deviceId: number, slot?: number) => void;
  onDevice: () => void;
  /** 스캐너 상태 칸을 눌렀을 때 — 칸별로 보는 현황 화면. */
  onStatus: () => void;
  onNeedAdmin: (where: string, what: string) => void;
}

/**
 * 홈 (v2.1) — 현황 카드 하나와 큰 버튼 둘.
 *
 * 2.0 의 다섯 칸(등록 · 반출 · 스캐너 상태 · 할 일 · 알람)을 셋으로 줄였다(혜원님 10/14,
 * 「최대한 심플하게」). 할 일(반출 대기 · 미전송 · 문제 발생)은 알람과 같은 말을 하고 있어
 * 알람 하나로 합쳤다.
 *
 * (아래는 2.0 때의 설명)
 *
 * 2차 피드백(상무님 요구): 홈을 단순하게. 접종기 UI 홈처럼 윗줄에 큰 동작
 * 버튼, 아랫줄에 상태 요약 칸을 둔다. 1.6 까지의 홈(트레이 24칸)은 상세 탭
 * 왼쪽으로 옮겼다 — 칸 하나하나를 보는 일은 상세의 몫이다.
 *
 * 윗줄: 장비 앞에 선 사람이 맨 먼저 하는 두 가지, 등록과 반출.
 * 아랫줄: 스캐너가 지금 어떤지 · 내가 할 일 · 알람. 숫자만 짧게 적고,
 * 자세한 것은 눌러서 들어간다.
 */
const ALERT_TAG = {device: '오류', plate: '주의', done: '완료'} as const;

export function OverviewScreen({
  state,
  openDetail,
  openRegister,
  onDevice,
  onStatus,
  onNeedAdmin,
}: Props) {
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
  const free = SLOTS_PER_DEVICE - plates.length;
  const next = scannerNext(state, device);
  const capturing = device.job?.status === 'running' && device.job.type === 'capture';
  const alerts = alertItems(state, {
    onDevice,
    onPlate: (deviceId, slot) => openDetail(deviceId, slot),
    onNeedAdmin,
  });

  return (
    <div className="hm-page">
      {/* 현황 — 누르면 칸별로 보는 현황 화면. */}
      <section className="p-card hm-status">
        {/* 정보 칸은 누르는 꼴을 하지 않는다 — 누르는 것은 오른쪽 두 버튼뿐이다(혜원님 10/14).
            현황으로 가는 길은 글자 링크 하나로 둔다. */}
        <div className="hm-scan">
          <span className="hm-scan-head">
            <b>{device.name}</b>
            <Badge type={next.badgeType}>{next.badge}</Badge>
            <button className="hm-go" onClick={onStatus}>
              현황 보기
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </span>
          {/*
            * 크게 적는 것은 배양 중 · 반출 대기 · 빈 슬롯 셋이다. 장비 앞의 사람이 먼저 알아야 하는 것은
            * 「몇 판이 들어 있고, 몇 판을 꺼내야 하는지」다. 다음 촬영 시각은 아래 작은 줄로
            * 내렸다(혜원님 10/14).
            */}
          {/* 색은 트레이 원과 같은 뜻으로 맞춘다 — 배양 중 = 노랑(Well 있음), 반출 대기 = 초록(작업 완료). */}
          <span className="hm-big">
            <span className={plates.length ? 'grow' : 'calm'}>
              <small>배양 중</small>
              <b>
                {plates.length}
                <em>/ {SLOTS_PER_DEVICE} 매</em>
              </b>
            </span>
            <span className={done.length ? 'ready' : 'calm'}>
              <small>반출 대기</small>
              <b>
                {done.length}
                <em>매</em>
              </b>
            </span>
            <span className={free ? '' : 'calm'}>
              <small>빈 슬롯</small>
              <b>
                {free}
                <em>칸</em>
              </b>
            </span>
          </span>
          <span className="hm-small">
            <span>
              다음 촬영{' '}
              {/* 찍고 있는 동안은 다음 시각이 아직 없다. 빈칸 대신 「지금」이라고 답한다. */}
              <b className={capturing || next.scheduled ? '' : 'idle'}>
                {capturing ? '지금 촬영 중' : next.label}
              </b>
            </span>
          </span>
        </div>

        {/* 알람 — 전부 적고, 넘치면 끌어서 넘긴다. 줄을 누르면 그 일로. 「전체 보기」 팝업은 뺐다(혜원님 10/14). */}
        <div className="hm-alerts">
          <div className="p-card-head">
            <h3>알람</h3>
            <em className={alerts.length ? 'bad' : 'none'}>{alerts.length ? `${alerts.length}건` : '없음'}</em>
          </div>
          {alerts.length ? (
            <ul>
              {/* 맨 윗줄이 가장 급한 일이다(장비 오류 → 플레이트 문제 → 반출 대기 순). 그 줄만 크게. */}
              {alerts.map((a, i) => (
                <li key={a.id} className={i ? '' : 'top'}>
                  <button className={a.kind} disabled={!a.go} onClick={() => a.go?.()}>
                    <span className={`p-tag ${a.kind}`}>{ALERT_TAG[a.kind]}</span>
                    <b>{a.where}</b>
                    <small>{a.what}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hm-clear">처리할 알람이 없습니다</p>
          )}
        </div>
      </section>

      {/* 등록 · 반출 — 홈에서 가장 큰 두 칸. */}
      <div className="hm-acts">
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

    </div>
  );
}
