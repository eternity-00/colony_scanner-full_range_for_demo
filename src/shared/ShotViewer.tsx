import type {Plate, Run} from '../api/types.ts';
import {WELLS} from '../config/defines.ts';
import {fmt} from '../utils/datetime.ts';
import {imgSrc, pos, shots} from '../utils/plate.ts';
import {Badge} from './Badge.tsx';
import {Modal} from './Modal.tsx';

export interface ShotTarget {
  plate: Plate;
  /** 회차를 지정하지 않으면 머리글만 보여준다(반출된 플레이트). */
  run?: Run;
  /** 목록에서 눌러 들어온 Well 을 강조한다. */
  wellIndex?: number;
}

interface Props {
  target: ShotTarget;
  onClose: () => void;
}

/** 한 회차의 Well 6장을 펼쳐 보는 모달. */
export function ShotViewer({target, onClose}: Props) {
  const {plate, run, wellIndex} = target;
  const images = run ? shots(run) : [];

  return (
    <Modal
      wide
      bare
      title={`${plate.id} · ${pos(plate.slot)}${run ? ` · ${run.n}회차` : ''}`}
      onClose={onClose}
    >
      <div className="shot-meta">
        <span className="sm-pos">{pos(plate.slot)}</span>
        {run && (
          <>
            <span className="sm-time">{fmt(run.at)}</span>
            <Badge type={run.transferred ? 'good' : 'warn'}>
              {run.transferred ? '전송 완료' : '미전송'}
            </Badge>
          </>
        )}
        <span className="sm-count">
          Well 1–{WELLS} · {WELLS}장
        </span>
      </div>
      {run && (
        <div className="well-set">
          {Array.from({length: WELLS}, (_, i) => {
            const file = images[i];
            return (
              <figure
                key={i}
                className={`well-card ${wellIndex === i ? 'sel' : ''} ${file ? '' : 'miss'}`}
              >
                {file ? (
                  <img src={imgSrc(file)} alt={`Well ${i + 1}`} />
                ) : (
                  <span className="wc-miss">미촬영</span>
                )}
                <b className="wc-no">{i + 1}</b>
                <figcaption>Well {i + 1}</figcaption>
              </figure>
            );
          })}
        </div>
      )}
      {/*
        * 이 화면이 무엇을 위한 것인지 한 줄로 못박는다. 여기서 할 수 있는 건
        * 「찍혔는지」를 눈으로 확인하는 일뿐이고, 콜로니 집계와 판정은 PC
        * 프로그램의 몫이다. 적어 두지 않으면 장비 앞에서 판정을 기다리게 된다.
        * 글자는 흐리게 — 읽고 나면 다시 볼 줄이 아니다.
        */}
      <p className="shot-note">
        촬영 여부를 눈으로 확인하는 화면입니다. 콜로니 집계와 분석은 PC 프로그램에서 하세요.
      </p>
    </Modal>
  );
}
