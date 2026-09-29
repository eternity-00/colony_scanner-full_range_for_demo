import {useEffect, useRef, type ReactNode} from 'react';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  onConfirm?: () => void;
  /** 아직 누를 수 없는 확인. PIN 처럼 본문을 다 채워야 열리는 팝업이 쓴다. */
  confirmDisabled?: boolean;
  onClose: () => void;
  danger?: boolean;
  /** 하단 기본 버튼 줄을 그리지 않는다. 본문에서 직접 그릴 때 쓴다. */
  bare?: boolean;
  wide?: boolean;
}

export function Modal({
  title,
  children,
  confirmLabel,
  onConfirm,
  confirmDisabled = false,
  onClose,
  danger = false,
  bare = false,
  wide = false,
}: Props) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // 본문이 먼저 눌리길 바라는 버튼을 지정했으면 그쪽을 잡는다.
    // 아니면 닫기 ×로 — 팝업 안에 포커스를 가둬 두기 위한 것이다.
    const pick = ref.current
      ?.closest('.modal')
      ?.querySelector<HTMLElement>('[data-autofocus]');
    (pick || ref.current)?.focus();
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div
      className="modal-bg"
      role="presentation"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <button ref={ref} className="modal-x" onClick={onClose} aria-label="닫기">
          ×
        </button>
        <h2>{title}</h2>
        {children}
        {!bare && (
          <div className="actions">
            {onConfirm && <button onClick={onClose}>취소</button>}
            {onConfirm ? (
              <button
                className={danger ? 'danger' : 'primary'}
                disabled={confirmDisabled}
                onClick={onConfirm}
              >
                {confirmLabel || '확인'}
              </button>
            ) : (
              <button className="primary" onClick={onClose}>
                닫기
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
