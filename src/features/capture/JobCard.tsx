import type {AppState, Device} from '../../api/types.ts';
import {SHORT_STAGES, STAGES, WELLS, type SendCommand} from '../../config/defines.ts';
import {Badge} from '../../shared/Badge.tsx';
import {platesFor, status, tone} from '../../utils/plate.ts';

interface Props {
  device: Device;
  state: AppState;
  send: SendCommand;
  openDetail: (deviceId: number, slot?: number) => void;
}

export function JobCard({device: d, state, send, openDetail}: Props) {
  const isAdmin = state.session.role === 'admin';
  const job = d.job && ['running', 'paused'].includes(d.job.status) ? d.job : null;
  const well = job ? Math.min(WELLS, Math.floor((job.progress / 100) * WELLS) + 1) : null;
  const running = d.job?.status === 'running';
  const stages = job && job.type !== 'capture' ? SHORT_STAGES : STAGES;

  return (
    <section className="card job">
      <div className="row between">
        <h2>{d.name}</h2>
        <div className="jtags">
          <span className="wellbadge">
            WELL <b>{well ?? '—'}</b> / {WELLS}
          </span>
          <Badge type={tone(d)}>
            {status(d)}
            {running ? ` · ${d.job?.progress}%` : ''}
          </Badge>
        </div>
      </div>

      <div className="cam-row">
        <div className="cam-wrap">
          <div className={`cam-shot ${running ? 'live' : 'off'}`}>
            {running ? (
              <img src={`/api/images/well-${(((d.id - 1) * 2) % 9) + 1}.png`} alt="" />
            ) : (
              <span>촬영 대기</span>
            )}
          </div>
        </div>
        {/*
          * 사용자에게는 카메라와 단계 진행만 남긴다. 장비를 움직이는 세 버튼은
          * 잠그지 않고 감춘다 — 버튼 열이 사라지면 카메라가 그만큼 넓어지고,
          * 이 화면에서 사용자가 할 일은 어차피 보는 것뿐이다.
          */}
        <div className="actions right">
          {isAdmin && (
            <>
              <button disabled={!running} onClick={() => send('pause', d.id)}>
                일시정지
              </button>
              <button disabled={d.job?.status !== 'paused'} onClick={() => send('resume', d.id)}>
                재개
              </button>
              <button
                className="danger"
                disabled={!['running', 'paused'].includes(d.job?.status ?? '')}
                onClick={() => send('stop', d.id, {}, null, true)}
              >
                비상 정지
              </button>
            </>
          )}
          <button
            onClick={() => {
              const plates = platesFor(state, d.id);
              const target = d.job?.plateId
                ? plates.find(p => p.id === d.job?.plateId)
                : plates[0];
              openDetail(d.id, target?.slot || 1);
            }}
          >
            플레이트 상세
          </button>
        </div>
      </div>

      <div className="stages big">
        {stages.map((label, i) => (
          <div
            key={label}
            className={
              !job ? '' : i < job.step ? 'done' : i === job.step && job.status === 'running' ? 'now' : ''
            }
          >
            <i />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
