import type React from 'react';
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

/** 수납도. 단 수·열 수는 프로필 배치(state.profile.layout)를 따른다 — 테스트베드 8×1, 정식 N×3. */
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
  const {tiers, columns} = state.profile?.layout ?? {tiers: 8, columns: 3};

  return (
    <div
      className={`tray ${compact ? 'compact' : ''} ${registration ? 'registration' : ''} cols-${columns}`}
      style={{'--tray-cols': columns} as React.CSSProperties}
    >
      {Array.from({length: tiers}, (_, row) => {
        const tier = tiers - row;
        return (
          <div className="tray-row" key={tier}>
            <span className="tier">{tier}단</span>
            {Array.from({length: columns}, (_, c) => c + 1).map(col => {
              const slot = row * columns + col;
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
                  {/* 등록 화면은 상태 원 대신 빈 칸 번호 / 「사용 중」을 적는다. 번호는 다른 화면과 같은 「2-1」 꼴. */}
                  <b>{registration && plate ? '사용 중' : columns > 1 ? `${tier}-${col}` : `${tier}단`}</b>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
