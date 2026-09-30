import type {AppState, Device} from '../../api/types.ts';
import {SHORT_STAGES, STAGES, STAGES_SHOWN, WELLS, type SendCommand} from '../../config/defines.ts';
import {ActIcon} from '../../shared/ActIcon.tsx';
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
  // 촬영은 앞의 네 단계만 그린다(STAGES_SHOWN 주석). 다른 작업은 세 단계 그대로.
  const stages =
    job && job.type !== 'capture' ? SHORT_STAGES : STAGES.slice(0, STAGES_SHOWN);

  return (
    <section className="card job">
      <div className="row between">
        <h2>{d.name}</h2>
        {/*
          * 진행 단계는 머리 줄에 눕힌다. 아래를 비워 사진이 그만큼 커진다.
          * 글자 넷을 고르게 깔고 그 아래 가는 선이 찬다 — 점과 이음선을 쓰면
          * 대기일 때 넷이 모두 같은 회색이라 줄이 통째로 흐려 보였다.
          *
          * 채우는 폭은 회차가 아니라 단계로 센다. 지나온 단계는 다 찬 것으로,
          * 지금 도는 단계는 절반으로 친다 — 단계 안에서 얼마나 왔는지는
          * 장비가 말해 주지 않으므로 가운데로 두는 편이 덜 거짓말이다.
          */}
        <div className="stagebar">
          <div className="st-lbl">
            {stages.map((label, i) => (
              <span
                key={label}
                className={
                  !job
                    ? ''
                    : i < job.step
                      ? 'done'
                      : i === job.step && job.status === 'running'
                        ? 'now'
                        : ''
                }
              >
                {label}
              </span>
            ))}
          </div>
          <div className="st-bar">
            <i
              style={{
                width: job
                  ? `${Math.min(100, ((job.step + (job.status === 'running' ? 0.5 : 0)) / stages.length) * 100)}%`
                  : 0,
              }}
            />
          </div>
        </div>
        <div className="jtags">
          <span className="wellbadge">
            {/* 값이 없을 때의 줄표는 짧은 것(–)을 쓴다. 긴 줄표(—)는 좁은 칩 안에서 선처럼 보인다. */}
            WELL <b>{well ?? '–'}</b> / {WELLS}
          </span>
          {/* 퍼센트는 빼 둔다. 바로 옆 머리 줄이 어느 단계인지를 이미 말하고,
              숫자가 250ms 마다 바뀌면 그 옆에서 읽어야 할 상태 글자가 흔들린다. */}
          <Badge type={tone(d)}>{status(d)}</Badge>
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
            <ActIcon name="pause" />
            일시정지
          </button>
          <button disabled={d.job?.status !== 'paused'} onClick={() => send('resume', d.id)}>
            <ActIcon name="play" />
            재개
          </button>
          {isAdmin && (
            <button
              className="danger"
              disabled={!['running', 'paused'].includes(d.job?.status ?? '')}
              onClick={() => send('stop', d.id, {}, null, true)}
            >
              <ActIcon name="stop" />
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
            <ActIcon name="find" />
            플레이트 상세
          </button>
        </div>
      </div>

    </section>
  );
}
