import type {AppState} from '../../api/types.ts';
import {ActIcon} from '../../shared/ActIcon.tsx';
import {Badge} from '../../shared/Badge.tsx';
import {scannerNext} from '../../shared/ScannerHead.tsx';
import {EnvCard} from '../../shared/EnvCard.tsx';
import {TabIcon} from '../../shared/TabIcon.tsx';
import {ALERT_TAG, alertItems} from '../../utils/alerts.ts';
import {hm} from '../../utils/datetime.ts';
import {active, attentionCount, endSoon, plateDone, slotsPerDevice, wellState} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  openDetail: (deviceId: number, slot?: number) => void;
  openRegister: (deviceId: number, slot?: number) => void;
  openRemove: (deviceId: number, slot?: number) => void;
  onRecent: () => void;
  onDevice: () => void;
  /** 스캐너 상태 칸을 눌렀을 때 — 칸별로 보는 현황 화면. */
  onStatus: () => void;
  onNeedAdmin: (where: string, what: string) => void;
}

/**
 * 홈 (v2.3) — 맨 윗줄 배양 현황 셋(배양 중 · 확인 필요 · 종료 예정), 둘째 줄 버튼 셋(추가 · 제거 · 최근 영상),
 * 그 아래 요약 줄과 스캐너 한 줄(2026-10-26 배치 변경).
 *
 * M3 홈: 플레이트 추가 · 제거 · 최근 영상 확인이 홈의 세 버튼이고, 배양 현황은
 * 「배양 중 · 확인 필요 · 종료 예정」 세 칸이다(2026-10-26 결정: 반출 대기는 확인 필요에 합친다).
 * 확인 필요 = 문제 발생 플레이트 + 반출 대기 플레이트 + 걸려 있는 장비·환경 알람 수.
 * 종료 예정 = 남은 배양 시간이 설정값(기본 24시간) 안인 플레이트 수.
 * 이슈가 없으면 요약 줄이 조용해진다(알람 0건이면 로그를 한 줄로 접는다, A14).
 */
export function OverviewScreen({state, openDetail, openRegister, openRemove, onRecent, onStatus, onDevice, onNeedAdmin}: Props) {
  const device = state.devices[0];
  if (!device) return null;

  const plates = active(state).filter(p => p.deviceId === device.id);
  const done = plates.filter(p => plateDone(state, p)).sort((a, b) => a.slot - b.slot);
  const removeTarget = done[0] ?? [...plates].sort((a, b) => a.slot - b.slot)[0];
  const free = slotsPerDevice(state) - plates.length;
  const states = plates.map(p => wellState(state, p, device));
  const growing = states.filter(w => w === 'ok' || w === 'busy').length;
  const attention = attentionCount(state, device.id);
  const soon = plates.filter(p => endSoon(state, p)).length;
  const withImages = plates.filter(p => p.runs.some(r => r.imageState === 'held')).length;
  const next = scannerNext(state, device);
  const capturing = device.job?.status === 'running' && device.job.type === 'capture';
  const alerts = alertItems(state, {onDevice, onPlate: openDetail, onNeedAdmin}).filter(a => a.kind !== 'shot');
  const quiet = alerts.length === 0;
  const logs = state.logs.slice(0, quiet ? 1 : 2);

  const go = (
    <svg className="ha-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );

  return (
    <div className={`hm-page ${quiet ? 'quiet' : ''}`}>
      {/* 배양 현황 셋 — 맨 윗줄, 읽는 칸. 0 이면 판까지 회색으로 가라앉힌다. */}
      <div className="hm-big three">
        <span className={growing ? 'grow' : 'calm'}>
          <small>배양 중</small>
          <b>
            {growing}
            <em>매</em>
          </b>
        </span>
        <button className={attention ? 'bad' : 'calm'} onClick={onStatus}>
          <small>확인 필요</small>
          <b>
            {attention}
            <em>건</em>
          </b>
          <i>문제 · 반출 대기 · 장비 알람</i>
        </button>
        <span className={soon ? 'ready' : 'calm'}>
          <small>종료 예정</small>
          <b>
            {soon}
            <em>매</em>
          </b>
          <i>{state.settings.endSoonHours}시간 안에 배양 종료</i>
        </span>
      </div>
      {/* 추가 · 제거 · 최근 영상 — 현황 바로 아래 줄(2026-10-26 요청: 현황이 맨 위, 버튼은 둘째 줄). */}
      <div className="hm-acts three">
        <button className="home-act reg" onClick={() => openRegister(device.id)} disabled={!free}>
          <ActIcon name="plus" />
          <span>
            <b>추가</b>
            <small>{free ? `빈 슬롯 ${free}칸` : '빈 슬롯 없음 · 제거 먼저'}</small>
          </span>
          {go}
        </button>
        <button className="home-act out" onClick={() => removeTarget && openRemove(device.id, removeTarget.slot)} disabled={!plates.length}>
          <ActIcon name="eject" />
          <span>
            <b>제거</b>
            <small>{done.length ? `반출 대기 ${done.length}매` : `배양 중 ${plates.length}매`}</small>
          </span>
          {go}
        </button>
        <button className="home-act recent" onClick={onRecent} disabled={!plates.length}>
          <TabIcon tab="recent" />
          <span>
            <b>최근 영상</b>
            <small>{withImages ? `영상 보관 ${withImages}매` : '보관 중인 영상 없음'}</small>
          </span>
          {go}
        </button>
      </div>

      {/* 환경 · 알람 · 로그 요약 줄. 이슈 없을 때는 조용하고, 있을 때만 색이 든다. */}
      <div className="hm-strip">
        <EnvCard state={state} compact />
        <button className={`hm-alerts ${alerts.length ? 'has' : ''}`} onClick={onStatus} aria-label="알람 목록 보기">
          <small>
            알람 <b>{alerts.length}</b>건
          </small>
          {alerts.length ? (
            <ul>
              {alerts.slice(0, 2).map(a => (
                <li key={a.id}>
                  <span className={`p-tag ${a.kind}`}>{ALERT_TAG[a.kind]}</span>
                  <b>{a.where}</b>
                  <span>{a.what}</span>
                  <time>{hm(a.at)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <span className="hm-quiet">처리할 알람이 없습니다</span>
          )}
        </button>
        <div className="hm-logs">
          <small>최근 로그</small>
          {logs.length ? (
            <ul>
              {logs.map(l => (
                <li key={l.id} className={l.level.toLowerCase()}>
                  <time>{hm(l.at)}</time>
                  <span>{l.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="hm-quiet">기록 없음</span>
          )}
        </div>
      </div>

      <button className="hm-bar" onClick={onStatus}>
        <b>{device.name}</b>
        <Badge type={next.badgeType}>{next.badge}</Badge>
        <span className="hm-next">
          다음 촬영{' '}
          <b className={capturing || next.scheduled ? '' : 'idle'}>{capturing ? '지금 촬영 중' : next.label}</b>
        </span>
        <span className="hm-go">
          현황 보기
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </span>
      </button>

    </div>
  );
}
