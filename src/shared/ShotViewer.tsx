import {useState} from 'react';
import type {Plate, Run} from '../api/types.ts';
import {WELLS} from '../config/defines.ts';
import {fmt} from '../utils/datetime.ts';
import {failedWells, imgSrc, pos, shots} from '../utils/plate.ts';
import {Badge} from './Badge.tsx';
import {ImageDetail, type DetailImage} from './ImageDetail.tsx';
import {Modal} from './Modal.tsx';

/** 실장비 회차의 원본 목록: 6-well 모자이크 + Well 별 원본 PNG(+ YUY2 원본 내려받기). */
const detailImages = (run: Run): DetailImage[] => {
  const list: DetailImage[] = [];
  if (run.image) list.push({src: `/api/images/${run.image}`, label: '6-well 모자이크'});
  for (const w of run.capture?.wells ?? [])
    if (w.image)
      list.push({
        src: `/api/v1/hardware/files/${w.image}`,
        label: `Well ${w.well} 원본${w.alignment ? (w.alignment.aligned ? ' · 정렬됨' : ' · 미정렬') : ''}`,
        raw: w.raw ? `/api/v1/hardware/files/${w.raw}` : null,
      });
  return list;
};

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
  const [detail, setDetail] = useState<number | null>(null);
  const originals = run ? detailImages(run) : [];
  const al = run?.capture?.alignment;
  const alignedSet = new Set(al?.alignedWells ?? []);
  const unalignedSet = new Set(al?.unalignedWells ?? []);

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
          Well 1–{WELLS} · {images.filter(Boolean).length}장
          {run && failedWells(run).length ? ` · ${failedWells(run).length}장 실패` : ''}
        </span>
        {al?.enabled && (
          <Badge type={unalignedSet.size ? 'warn' : 'good'}>
            웰 중심 정렬 {alignedSet.size}/{WELLS}
          </Badge>
        )}
        {originals.length > 0 && (
          <button className="sm-detail" onClick={() => setDetail(0)}>
            원본 크게 보기
          </button>
        )}
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
                  <span className={`wc-miss ${run.imageState === 'held' ? 'fail' : ''}`}>
                    {run.imageState === 'held' ? '촬영 실패' : '미촬영'}
                  </span>
                )}
                <b className="wc-no">{i + 1}</b>
                <figcaption>
                  Well {i + 1}
                  {alignedSet.has(i + 1) && <em className="wc-al ok"> 정렬</em>}
                  {unalignedSet.has(i + 1) && <em className="wc-al warn"> 미정렬</em>}
                </figcaption>
                {file && originals.length > 0 && (
                  <button
                    className="wc-zoom"
                    aria-label={`Well ${i + 1} 원본 크게 보기`}
                    onClick={() => {
                      const at = originals.findIndex(o => o.label.startsWith(`Well ${i + 1} `));
                      setDetail(at >= 0 ? at : 0);
                    }}
                  >
                    확대
                  </button>
                )}
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
      <p className="shot-note">미리보기입니다. 정확한 집계는 PC 프로그램에서 확인하세요.</p>
      {detail !== null && (
        <ImageDetail
          images={originals}
          initial={detail}
          title={`${plate.id} · ${pos(plate.slot)}${run ? ` · ${run.n}회차` : ''} 원본`}
          onClose={() => setDetail(null)}
        />
      )}
    </Modal>
  );
}
