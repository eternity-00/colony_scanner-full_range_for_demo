import type {AppState} from '../api/types.ts';
import {WELL_LABEL} from '../config/defines.ts';
import {platesFor, pos, wellState} from '../utils/plate.ts';

interface Props {
  state: AppState;
  deviceId: number;
  selected?: number;
  onSelect?: (slot: number) => void;
  /** 현황 카드 안에 들어가는 작은 트레이. */
  compact?: boolean;
  /** 등록 화면: 비어있는 칸만 고를 수 있다. */
  registration?: boolean;
}

/** 8단 × 3열 = 24슬롯 수납도. */
export function Tray({
  state,
  deviceId,
  selected,
  onSelect,
  compact = false,
  registration = false,
}: Props) {
  const plates = platesFor(state, deviceId);
  const bySlot = new Map(plates.map(p => [p.slot, p]));
  const device = state.devices.find(d => d.id === deviceId);

  return (
    <div className={`tray ${compact ? 'compact' : ''} ${registration ? 'registration' : ''}`}>
      {Array.from({length: 8}, (_, row) => {
        const tier = 8 - row;
        return (
          <div className="tray-row" key={tier}>
            <span className="tier">{tier}단</span>
            {[1, 2, 3].map(col => {
              const slot = row * 3 + col;
              const plate = bySlot.get(slot);
              const chosen = selected === slot;
              const cell = registration
                ? plate
                  ? 'ok'
                  : 'empty'
                : wellState(state, plate, device);
              return (
                <button
                  key={slot}
                  className={`cell w-${cell} ${chosen ? 'selected' : ''}`}
                  disabled={(compact && !onSelect) || (registration && !!plate)}
                  onClick={() => onSelect?.(slot)}
                  title={`${pos(slot)} · ${plate ? plate.id : '빈 슬롯'} · ${WELL_LABEL[cell]}`}
                >
                  <b>
                    {tier}-{col}
                  </b>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
