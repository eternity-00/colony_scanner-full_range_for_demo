import type {AppState} from '../../api/types.ts';
import {SLOTS_PER_DEVICE} from '../../config/defines.ts';
import {ActIcon} from '../../shared/ActIcon.tsx';
import {Badge} from '../../shared/Badge.tsx';
import {scannerNext} from '../../shared/ScannerHead.tsx';
import {active, plateBad, totalRuns} from '../../utils/plate.ts';

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
 * 홈 (v2.1) — 위에 스캐너 한 줄과 정보 넷(현황), 아래에 큰 버튼 둘(등록 · 반출).
 * 처음엔 버튼이 위였는데 현황을 먼저 읽게 위아래를 바꿨다(혜원님 10/14).
 *
 * 디자인 캔버스 「홈 화면 배치안」에서 혜원님이 고른 꼴(10/14). 알람 목록은 홈에서 빼고
 * 메뉴의 현황에서 본다. 대신 「문제 발생」 칸이 손봐야 할 플레이트 수를 말한다.
 *
 * 누르는 것(버튼 둘 · 현황 보기)과 읽는 것(정보 넷)을 꼴로 가른다 — 버튼은 꽉 찬 면 ·
 * 굵은 테두리와 깔린 그림자, 정보 칸은 그림자 없는 납작한 면.
 * 정보 칸 색은 트레이 원과 같은 뜻이다: 배양 중 = 노랑(Well 있음), 반출 대기 = 초록
 * (작업 완료), 문제 발생 = 빨강.
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
  const free = SLOTS_PER_DEVICE - plates.length;
  const bad = plates.filter(plateBad).length;
  const next = scannerNext(state, device);
  const capturing = device.job?.status === 'running' && device.job.type === 'capture';

  return (
    <div className="hm-page">
      {/* 스캐너 한 줄 — 이름 · 상태 · 다음 촬영, 오른쪽 끝에 현황으로 가는 버튼. */}
      <div className="hm-bar">
        <b>{device.name}</b>
        <Badge type={next.badgeType}>{next.badge}</Badge>
        <span className="hm-next">
          다음 촬영{' '}
          {/* 찍고 있는 동안은 다음 시각이 아직 없다. 빈칸 대신 「지금」이라고 답한다. */}
          <b className={capturing || next.scheduled ? '' : 'idle'}>
            {capturing ? '지금 촬영 중' : next.label}
          </b>
        </span>
        <button className="hm-go" onClick={onStatus}>
          현황 보기
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      {/* 정보 넷 — 읽는 칸. 0 이면 색을 빼고 숫자를 회색으로. */}
      <div className="hm-big">
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
        <span className={bad ? 'bad' : 'calm'}>
          <small>문제 발생</small>
          <b>
            {bad}
            <em>매</em>
          </b>
        </span>
      </div>

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
