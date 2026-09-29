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
      {/*
        * 이 화면에서 봐야 하는 것은 사진이다. 그래서 카메라 옆을 비우고,
        * 장비를 움직이는 버튼(일시정지·재개·비상 정지)은 머리 줄로 올렸다.
        * 「상세」도 화면 이동이라 사진 자리를 차지할 이유가 없다.
        */}
      <div className="row between">
        <h2>{d.name}</h2>
        <div className="jtags">
          <button className="jbtn" disabled={!running} onClick={() => send('pause', d.id)}>
            일시정지
          </button>
          <button
            className="jbtn"
            disabled={d.job?.status !== 'paused'}
            onClick={() => send('resume', d.id)}
          >
            재개
          </button>
          {isAdmin && (
            <button
              className="jbtn danger"
              disabled={!['running', 'paused'].includes(d.job?.status ?? '')}
              onClick={() => send('stop', d.id, {}, null, true)}
            >
              비상 정지
            </button>
          )}
          <button
            className="jbtn"
            onClick={() => {
              const plates = platesFor(state, d.id);
              const target = d.job?.plateId
                ? plates.find(p => p.id === d.job?.plateId)
                : plates[0];
              openDetail(d.id, target?.slot || 1);
            }}
          >
            상세
          </button>
          <span className="wellbadge">
            {/* 값이 없을 때의 줄표는 짧은 것(–)을 쓴다. 긴 줄표(—)는 좁은 칩 안에서 선처럼 보인다. */}
            WELL <b>{well ?? '–'}</b> / {WELLS}
          </span>
          {/*
            * 단계 줄(이송 → … → PC 저장)을 없애고 지금 단계만 배지에 넣었다.
            * 이 화면에서 봐야 하는 건 사진이고, 여섯 단계를 늘어놓느라 사진이
            * 70px 작아지는 건 맞바꿈이 안 맞는다.
            */}
          <Badge type={tone(d)}>
            {status(d)}
            {job && stages[job.step] ? ` · ${stages[job.step]}` : ''}
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
      </div>

    </section>
  );
}
