import type {AppState} from '../../api/types.ts';
import {ActIcon} from '../../shared/ActIcon.tsx';
import {Badge} from '../../shared/Badge.tsx';
import {scannerNext} from '../../shared/ScannerHead.tsx';
import {active, slotsPerDevice, totalRuns, wellState} from '../../utils/plate.ts';

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
 * 홈 (v2.1) — 윗줄 큰 버튼 둘(등록 · 반출), 가운데 스캐너 한 줄, 아랫줄 정보 넷.
 *
 * 디자인 캔버스 「홈 화면 배치안」에서 혜원님이 고른 꼴(10/14). 알람 목록은 홈에서 빼고
 * 메뉴의 현황에서 본다. 대신 「문제 발생」 칸이 손봐야 할 플레이트 수를 말한다.
 *
 * 누르는 것(버튼 둘 · 스캐너 줄)과 읽는 것(정보 넷)을 꼴로 가른다 — 버튼은 그림자 없이
 * 남색 테두리, 정보 칸은 그림자 없는 납작한 면. 진한 남색 판은 너무 무거워 등록 · 반출
 * 모두 연한 남색 면으로 둔다(캔버스 「플레이트 등록 버튼안」 E안에서 출발, 10/22).
 * 정보 칸 색은 트레이 원과 같은 뜻이다: 배양 중 = 노랑, 반출 대기 = 초록, 문제 발생 = 빨강.
 * 세는 법도 트레이 원과 같다 — 한 칸은 한 곳에만 들어가서
 * 넷을 더하면 슬롯 수(24)가 된다. 문제가 난 판은 다 찍었어도 반출 대기가 아니라 문제로 센다.
 *
 * 2차 피드백(상무님 요구): 홈을 단순하게, 등록 · 반출로 바로 들어가게.
 */
export function OverviewScreen({state, openDetail, openRegister, onStatus}: Props) {
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
  const free = slotsPerDevice(state) - plates.length;
  const states = plates.map(p => wellState(state, p, device));
  const growing = states.filter(w => w === 'ok' || w === 'busy').length;
  const ready = states.filter(w => w === 'done').length;
  const bad = states.filter(w => w === 'bad').length;
  const next = scannerNext(state, device);
  const capturing = device.job?.status === 'running' && device.job.type === 'capture';

  return (
    <div className="hm-page">
      {/* 등록 · 반출 — 홈에서 가장 큰 두 칸. */}
      <div className="hm-acts">
        <button className="home-act reg" onClick={() => openRegister(device.id)} disabled={!free}>
          <ActIcon name="plus" />
          <span>
            <b>플레이트 등록</b>
            <small>{free ? `빈 슬롯 ${free}칸` : '빈 슬롯 없음 · 반출 먼저'}</small>
          </span>
          <svg className="ha-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <button className="home-act out" onClick={openRemove} disabled={!plates.length}>
          <ActIcon name="eject" />
          <span>
            <b>플레이트 반출</b>
            <small>{ready ? `반출 대기 ${ready}매` : `배양 중 ${plates.length}매`}</small>
          </span>
          <svg className="ha-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      {/* 스캐너 한 줄 — 이름 · 상태 · 다음 촬영, 오른쪽 끝에 「현황 보기」. 줄 전체가 현황으로
          가는 버튼이다 — 오른쪽 작은 단추만 노리고 누르지 않아도 된다. */}
      <button className="hm-bar" onClick={onStatus}>
        <b>{device.name}</b>
        <Badge type={next.badgeType}>{next.badge}</Badge>
        <span className="hm-next">
          다음 촬영{' '}
          {/* 찍고 있는 동안은 다음 시각이 아직 없다. 빈칸 대신 「지금」이라고 답한다. */}
          <b className={capturing || next.scheduled ? '' : 'idle'}>
            {capturing ? '지금 촬영 중' : next.label}
          </b>
        </span>
        <span className="hm-go">
          현황 보기
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
      </button>

      {/* 정보 넷 — 읽는 칸. 0 이면 판까지 회색으로 가라앉힌다. 빈 슬롯은 회색 판. */}
      <div className="hm-big">
        <span className={growing ? 'grow' : 'calm'}>
          <small>배양 중</small>
          <b>
            {growing}
            <em>매</em>
          </b>
        </span>
        <span className={ready ? 'ready' : 'calm'}>
          <small>반출 대기</small>
          <b>
            {ready}
            <em>매</em>
          </b>
        </span>
        <span className={free ? 'free' : 'calm'}>
          <small>빈 슬롯</small>
          <b>
            {free}
            <em>칸</em>
          </b>
        </span>
        <span className={bad ? 'bad' : 'calm'}>
          <small>문제 발생</small>
          <b>
            {bad}
            <em>매</em>
          </b>
        </span>
      </div>
    </div>
  );
}
