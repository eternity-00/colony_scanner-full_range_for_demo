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
            {/* 값이 없을 때의 줄표는 짧은 것(–)을 쓴다. 긴 줄표(—)는 좁은 칩 안에서 선처럼 보인다. */}
            WELL <b>{well ?? '–'}</b> / {WELLS}
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
          * 일시정지·재개는 정상 운영이라 사용자도 쓴다.
          * 비상 정지는 고장 상황의 조치라 관리자에게만 보인다.
          */}
        <div className="actions right">
          <button disabled={!running} onClick={() => send('pause', d.id)}>
            일시정지
          </button>
          <button disabled={d.job?.status !== 'paused'} onClick={() => send('resume', d.id)}>
            재개
          </button>
          {isAdmin && (
            <button
              className="danger"
              disabled={!['running', 'paused'].includes(d.job?.status ?? '')}
              onClick={() => send('stop', d.id, {}, null, true)}
            >
              비상 정지
            </button>
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
