import {useState} from 'react';
import type {Plate, Run} from '../api/types.ts';
import {SHOT_LABEL, WELLS} from '../config/defines.ts';
import {fmt} from '../utils/datetime.ts';
import {failedWells, imgSrc, pos, shots} from '../utils/plate.ts';
import {Badge} from './Badge.tsx';
import {ImageDetail, type DetailImage} from './ImageDetail.tsx';
import {Modal} from './Modal.tsx';

/** 실장비 회차의 원본 목록: 6-well 모자이크 + Well 별 원본 PNG(+ YUY2 원본 내려받기). */
const detailImages = (run: Run): DetailImage[] => {
  const list: DetailImage[] = [];
  if (run.image) list.push({src: `/api/images/${run.image}`, label: '6-well 모자이크'});
  for (const w of run.capture?.wells ?? []) {
    if (w.image)
      list.push({
        src: `/api/v1/hardware/files/${w.image}`,
        label: `Well ${w.well} 원본${w.alignment ? (w.alignment.aligned ? ' · 정렬됨' : ' · 미정렬') : ''}${w.shots?.length ? ' · 중앙' : ''}`,
        raw: w.raw ? `/api/v1/hardware/files/${w.raw}` : null,
      });
    // 십자 촬영: 가운데 외 네 장도 원본 목록에 넣는다.
    for (const s of (w.shots ?? []).filter(s => s.shot !== 'C'))
      list.push({src: `/api/v1/hardware/files/${s.image}`, label: `Well ${w.well} 십자 ${SHOT_LABEL[s.shot] ?? s.shot}`, raw: s.raw ? `/api/v1/hardware/files/${s.raw}` : null});
  }
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
  const code = run?.capture?.barcode;
  const cross = run?.capture?.wellShots === 5;
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
        {cross && <Badge type="info">십자 촬영 · Well당 5장</Badge>}
        {code && (
          <Badge type={code.value ? 'good' : code.scanned ? 'warn' : 'info'}>
            {code.value ? `바코드 ${code.value}` : code.scanned ? '바코드 미인식' : '바코드 판독 불가'}
          </Badge>
        )}
        {run?.change && run.change.max !== null && <Badge type="info">변화 {run.change.max.toFixed(2)}</Badge>}
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
                {cross && file && (
                  <span className="wc-shots" aria-label="십자 촬영 5장">
                    {(run.capture?.wells?.find(w => w.well === i + 1)?.shots ?? []).map(s => (
                      <button
                        key={s.id}
                        title={SHOT_LABEL[s.shot] ?? s.shot}
                        onClick={() => {
                          const at = originals.findIndex(o => o.src.endsWith(`/${s.image}`));
                          setDetail(at >= 0 ? at : 0);
                        }}
                      >
                        <img src={`/api/v1/hardware/files/${s.preview}`} alt={`Well ${i + 1} ${SHOT_LABEL[s.shot] ?? s.shot}`} />
                        <small>{SHOT_LABEL[s.shot] ?? s.shot}</small>
                      </button>
                    ))}
                  </span>
                )}
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
