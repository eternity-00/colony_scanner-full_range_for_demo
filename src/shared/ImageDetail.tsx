import {useEffect, useRef, useState, type PointerEvent as ReactPointerEvent} from 'react';

export interface DetailImage {
  src: string;
  label: string;
  /** 원본(YUY2) 내려받기 주소가 있으면 버튼을 하나 더 둔다. */
  raw?: string | null;
}

interface Props {
  images: DetailImage[];
  title?: string;
  initial?: number;
  onClose: () => void;
}

interface View {
  scale: number;
  x: number;
  y: number;
}
interface Size {
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const limit = (view: View, image: Size, area: Size): View => ({
  ...view,
  x: clamp(view.x, -Math.max(0, (image.width * view.scale - area.width) / 2), Math.max(0, (image.width * view.scale - area.width) / 2)),
  y: clamp(view.y, -Math.max(0, (image.height * view.scale - area.height) / 2), Math.max(0, (image.height * view.scale - area.height) / 2)),
});

/**
 * 촬영 영상 자세히 보기 — 원본 해상도 PNG 를 끌어서 이동하고 휠·두 손가락으로 확대한다.
 * 운영 앱(테스트베드)의 ImageDetail.jsx 를 그대로 옮긴 것이다.
 */
export function ImageDetail({images, title = '촬영 영상 자세히 보기', initial = 0, onClose}: Props) {
  const [selected, setSelected] = useState(Math.min(initial, Math.max(0, images.length - 1)));
  const [image, setImage] = useState<{src: string | null} & Size>({src: null, width: 0, height: 0});
  const [area, setArea] = useState<Size>({width: 0, height: 0});
  const [view, setView] = useState<View>({scale: 1, x: 0, y: 0});
  const [error, setError] = useState<string | false>(false);
  const [dragging, setDragging] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, {x: number; y: number}>());
  const gesture = useRef<{view: View; midX: number; midY: number; distance: number; count: number} | null>(null);
  const current = images[selected] || images[0];
  const values = useRef({view, image, area});
  const close = useRef(onClose);
  close.current = onClose;
  values.current = {view, image, area};

  const fit = () => {
    const {image, area} = values.current;
    if (image.width && area.width)
      setView({scale: clamp(Math.min(area.width / image.width, area.height / image.height), 0.02, 8), x: 0, y: 0});
  };
  const zoom = (scale: number, clientX?: number, clientY?: number) => {
    const el = stage.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX === undefined ? 0 : clientX - rect.left - rect.width / 2;
    const y = clientY === undefined ? 0 : clientY - rect.top - rect.height / 2;
    setView(old => {
      const next = clamp(scale, 0.02, 8);
      const ratio = next / old.scale;
      return limit({scale: next, x: x - (x - old.x) * ratio, y: y - (y - old.y) * ratio}, values.current.image, values.current.area);
    });
  };

  useEffect(() => {
    pointers.current.clear();
    gesture.current = null;
    setDragging(false);
  }, [current?.src]);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      const {width, height} = entries[0].contentRect;
      setArea({width, height});
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (image.src === current?.src) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image.src, current?.src, image.width, image.height, area.width, area.height]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        close.current();
        return;
      }
      if (e.key === 'Tab' && dialog.current) {
        const elements = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),select,a[href],input,[tabindex="0"]')];
        const first = elements[0];
        const last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
        return;
      }
      if ((e.target as HTMLElement).matches?.('select,input')) return;
      const {view, image, area} = values.current;
      if (['+', '=', '-', '0', '1', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
      if (e.key === '+' || e.key === '=') zoom(view.scale * 1.25);
      else if (e.key === '-') zoom(view.scale / 1.25);
      else if (e.key === '0') fit();
      else if (e.key === '1') setView({scale: 1, x: 0, y: 0});
      else if (e.key.startsWith('Arrow'))
        setView(old =>
          limit(
            {...old, x: old.x + (e.key === 'ArrowLeft' ? 60 : e.key === 'ArrowRight' ? -60 : 0), y: old.y + (e.key === 'ArrowUp' ? 60 : e.key === 'ArrowDown' ? -60 : 0)},
            image,
            area,
          ),
        );
    };
    const canvas = stage.current;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(values.current.view.scale * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY);
    };
    document.addEventListener('keydown', keys, true);
    canvas?.addEventListener('wheel', wheel, {passive: false});
    return () => {
      document.removeEventListener('keydown', keys, true);
      canvas?.removeEventListener('wheel', wheel);
      previous?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startGesture = () => {
    const el = stage.current;
    if (!el) return;
    const points = [...pointers.current.values()];
    const view = values.current.view;
    const rect = el.getBoundingClientRect();
    if (!points.length) {
      gesture.current = null;
      setDragging(false);
      return;
    }
    const a = points[0];
    const b = points[1] || a;
    gesture.current = {view, midX: (a.x + b.x) / 2 - rect.left - rect.width / 2, midY: (a.y + b.y) / 2 - rect.top - rect.height / 2, distance: Math.hypot(a.x - b.x, a.y - b.y), count: points.length};
    setDragging(true);
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    stage.current?.focus();
    try {
      stage.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    pointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
    startGesture();
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = stage.current;
    if (!el || !pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, {x: e.clientX, y: e.clientY});
    const points = [...pointers.current.values()];
    const a = points[0];
    const b = points[1] || a;
    const initial = gesture.current;
    const rect = el.getBoundingClientRect();
    const midX = (a.x + b.x) / 2 - rect.left - rect.width / 2;
    const midY = (a.y + b.y) / 2 - rect.top - rect.height / 2;
    const scale = initial.count > 1 && initial.distance ? clamp((initial.view.scale * Math.hypot(a.x - b.x, a.y - b.y)) / initial.distance, 0.02, 8) : initial.view.scale;
    const ratio = scale / initial.view.scale;
    setView(limit({scale, x: midX - (initial.midX - initial.view.x) * ratio, y: midY - (initial.midY - initial.view.y) * ratio}, values.current.image, values.current.area));
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    startGesture();
  };

  if (!current) return null;
  const failed = error === current.src;
  const loaded = image.src === current.src && !!image.width && !failed;
  const choose = (index: number) => {
    setError(false);
    setSelected(index);
  };

  return (
    <div className="image-detail-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <section ref={dialog} className="image-detail-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="image-detail-heading">
          <div>
            <h2>{title}</h2>
            <small>
              {failed
                ? '영상을 불러올 수 없습니다.'
                : loaded
                  ? `${current.label} · ${image.width} × ${image.height} · ${Math.round(view.scale * 100)}%`
                  : '영상 불러오는 중…'}
            </small>
          </div>
          <button ref={closeButton} onClick={onClose} aria-label="자세히 보기 닫기">
            ×
          </button>
        </div>
        <div className="image-detail-tools">
          {images.length > 1 && (
            <select aria-label="촬영 영상 선택" value={selected} onChange={e => choose(Number(e.target.value))}>
              {images.map((item, i) => (
                <option key={item.src} value={i}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
          <button disabled={!loaded} onClick={fit}>
            화면 맞춤
          </button>
          <button disabled={!loaded} onClick={() => setView({scale: 1, x: 0, y: 0})}>
            원본 크기 100%
          </button>
          <button disabled={!loaded} aria-label="영상 축소" onClick={() => zoom(view.scale / 1.25)}>
            −
          </button>
          <input aria-label="영상 확대 비율" type="range" min="2" max="800" value={Math.round(view.scale * 100)} disabled={!loaded} onChange={e => zoom(Number(e.target.value) / 100)} />
          <button disabled={!loaded} aria-label="영상 확대" onClick={() => zoom(view.scale * 1.25)}>
            ＋
          </button>
          <a href={current.src} download>
            영상 다운로드
          </a>
          {current.raw && (
            <a href={current.raw} download>
              원본 다운로드
            </a>
          )}
        </div>
        <div
          ref={stage}
          className={`image-detail-canvas ${dragging ? 'dragging' : ''}`}
          tabIndex={0}
          aria-label="확대 영상 영역"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onLostPointerCapture={up}
          onDoubleClick={() => (view.scale === 1 ? fit() : setView({scale: 1, x: 0, y: 0}))}
        >
          {failed ? (
            <p role="alert">영상을 불러올 수 없습니다. 영상 보관 상태를 확인하세요.</p>
          ) : (
            <div className="image-detail-centre" style={{width: loaded ? image.width : 1, height: loaded ? image.height : 1}}>
              <img
                key={current.src}
                src={current.src}
                alt={current.label || '촬영 영상'}
                draggable="false"
                style={{transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})`, visibility: loaded ? 'visible' : 'hidden'}}
                onLoad={e => setImage({src: current.src, width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight})}
                onError={() => setError(current.src)}
              />
            </div>
          )}
        </div>
        <p className="image-detail-help">끌어서 이동 · 마우스 휠 또는 두 손가락으로 확대 · 두 번 눌러 원본 크기 · Esc로 닫기</p>
      </section>
    </div>
  );
}
