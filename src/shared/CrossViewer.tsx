import {useState} from 'react';
import type {Plate, Run} from '../api/types.ts';
import {SHOT_LABEL, WELLS} from '../config/defines.ts';
import {fmt} from '../utils/datetime.ts';
import {pos} from '../utils/plate.ts';
import {Badge} from './Badge.tsx';
import {ImageDetail, type DetailImage} from './ImageDetail.tsx';
import {Modal} from './Modal.tsx';

interface Props {
  plate: Plate;
  run: Run;
  /** 처음 보여줄 Well(1부터). */
  well?: number;
  onClose: () => void;
}

const file = (name?: string) => (name ? `/api/v1/hardware/files/${name}` : '');

/**
 * 십자 촬영 보기 — 한 Well 의 다섯 장(중앙 · X+ · Y− · X− · Y+)을 십자 모양으로 크게 펼친다.
 * 이동 프레임은 가장 최근 십자 회차 하나만 장비에 남으므로(보관 정책), 이 화면은 그 회차를 본다.
 * 카메라 X 축 이동은 영상의 세로로, Y 축 이동은 가로로 나타난다(지그 축 배치).
 */
export function CrossViewer({plate, run, well: initial = 1, onClose}: Props) {
  const [well, setWell] = useState(initial);
  const [detail, setDetail] = useState<number | null>(null);
  const wells = run.capture?.wells ?? [];
  const current = wells.find(w => w.well === well);
  const shots = current?.shots ?? [];
  const byShot = (k: string) => shots.find(s => s.shot === k);
  const cross = run.capture?.cross;
  const originals: DetailImage[] = shots.map(s => ({
    src: file(s.image),
    label: `Well ${well} ${SHOT_LABEL[s.shot] ?? s.shot}${s.clamped ? ' (축 끝 잘림)' : ''}`,
    raw: s.raw ? file(s.raw) : null,
  }));
  const cell = (k: string) => {
    const s = byShot(k);
    if (!s) return <span className="cv-empty">{SHOT_LABEL[k] ?? k} 없음</span>;
    const at = shots.indexOf(s);
    return (
      <button className={`cv-shot ${k === 'C' ? 'centre' : ''}`} onClick={() => setDetail(at)} aria-label={`Well ${well} ${SHOT_LABEL[k]} 크게 보기`}>
        <img src={file(s.preview)} alt={`Well ${well} ${SHOT_LABEL[k]}`} />
        <b>
          {SHOT_LABEL[k] ?? k}
          {s.measured && <small> {s.measured.mm.toFixed(1)} mm</small>}
          {s.clamped && <em> · 축 끝 잘림</em>}
        </b>
      </button>
    );
  };

  return (
    <Modal wide bare title={`십자 촬영 · ${plate.id} · ${pos(plate.slot)} · ${run.n}회차`} onClose={onClose}>
      <div className="shot-meta">
        <span className="sm-time">{fmt(run.at)}</span>
        <Badge type="info">Well당 {run.capture?.wellShots ?? 5}장</Badge>
        {cross && (
          <Badge type="info">
            이동 {cross.mm} mm ({cross.x} / {cross.y} step · {cross.source === 'measured' ? '실측 보정' : cross.source === 'calibration' ? '보정값' : '격자'})
          </Badge>
        )}
        <span className="cv-wells">
          {Array.from({length: WELLS}, (_, i) => i + 1).map(n => (
            <button key={n} className={n === well ? 'selected' : ''} onClick={() => setWell(n)} disabled={!wells.some(w => w.well === n && (w.shots?.length ?? 0) > 1)}>
              Well {n}
            </button>
          ))}
        </span>
      </div>
      {shots.length > 1 ? (
        <div className="cv-grid">
          <span />
          {cell('Y-')}
          <span />
          {cell('X-')}
          {cell('C')}
          {cell('X+')}
          <span />
          {cell('Y+')}
          <span />
        </div>
      ) : (
        <p className="cv-none">이 Well 의 십자 이동 프레임이 없습니다{run.capture?.crossDropped ? ' (최근 1회 보관 정책으로 삭제됨)' : ''}.</p>
      )}
      <p className="shot-note">가운데가 정렬된 중앙 프레임입니다. 카메라 X 이동은 영상 세로, Y 이동은 영상 가로로 나타납니다. 누르면 원본(3840×3040)을 봅니다.</p>
      {detail !== null && <ImageDetail images={originals} initial={detail} title={`${plate.id} · Well ${well} 십자 촬영 원본`} onClose={() => setDetail(null)} />}
    </Modal>
  );
}
