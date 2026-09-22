import {useEffect, useRef, useState, type ReactNode} from 'react';
import {command, getState, subscribe} from './api/client.ts';
import type {AppState, CommandArgs, CommandError, ConnectionStatus, Plate} from './api/types.ts';
import {ADMIN_IDLE_LIMIT_SEC, ADMIN_IDLE_WARN_MS, type TabKey} from './config/defines.ts';
import {RoleDialog} from './features/auth/RoleDialog.tsx';
import {CaptureScreen} from './features/capture/CaptureScreen.tsx';
import {DetailScreen} from './features/detail/DetailScreen.tsx';
import {DeviceScreen} from './features/device/DeviceScreen.tsx';
import {HistoryScreen} from './features/history/HistoryScreen.tsx';
import {OverviewScreen} from './features/overview/OverviewScreen.tsx';
import {RegisterScreen} from './features/register/RegisterScreen.tsx';
import {SettingsScreen} from './features/settings/SettingsScreen.tsx';
import {Header} from './layout/Header.tsx';
import {MenuDrawer} from './layout/MenuDrawer.tsx';
import {Modal} from './shared/Modal.tsx';
import {ShotViewer, type ShotTarget} from './shared/ShotViewer.tsx';
import {platesFor} from './utils/plate.ts';

interface Notice {
  bad: boolean;
  text: string;
}

interface ConfirmModal {
  title: string;
  text: string;
  run: () => void;
  danger: boolean;
}

/** 관리자 세션을 살려두기 위해 조작을 서버에 알리는 최소 간격(ms). */
const TOUCH_INTERVAL_MS = 10000;

/** 데모용 자동 촬영 주입 간격(ms). */
const DEMO_CAPTURE_MS = 18000;

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [, setConnection] = useState<ConnectionStatus>('loading');
  const [tab, setTab] = useState<TabKey>('overview');
  const [detail, setDetail] = useState({deviceId: 1, slot: 1});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModal | null>(null);
  const [viewer, setViewer] = useState<ShotTarget | null>(null);
  const [roleDialog, setRoleDialog] = useState(false);
  const [registerDevice, setRegisterDevice] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exitAsk, setExitAsk] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [operator, setOperator] = useState(
    () => localStorage.getItem('colony-operator') || '김분석',
  );

  // 최초 상태를 한 번 읽고, 이후에는 SSE 로 받는다.
  useEffect(() => {
    let live = true;
    getState()
      .then(s => live && setState(s))
      .catch((e: Error) => setNotice({bad: true, text: e.message}));
    const stop = subscribe(
      s => live && setState(s),
      status => setConnection(status),
    );
    return () => {
      live = false;
      stop();
    };
  }, []);

  // 화면을 만지는 동안은 관리자 권한이 풀리지 않게 서버에 알린다.
  useEffect(() => {
    let last = 0;
    const touch = () => {
      if (Date.now() - last > TOUCH_INTERVAL_MS) {
        last = Date.now();
        command('session.touch', 0).catch(() => {});
      }
    };
    document.addEventListener('pointerdown', touch);
    document.addEventListener('keydown', touch);
    return () => {
      document.removeEventListener('pointerdown', touch);
      document.removeEventListener('keydown', touch);
    };
  }, []);

  const openDetail = (deviceId: number, slot = 1) => {
    setDetail({deviceId, slot});
    setTab('detail');
  };

  const openRegister = (deviceId: number) => {
    setRegisterDevice(deviceId);
    setTab('register');
  };

  const stateRef = useRef(state);
  stateRef.current = state;

  // 데모: 쉬고 있는 스캐너에 주기적으로 촬영을 넣어 화면이 멈춰 보이지 않게 한다.
  useEffect(() => {
    const t = setInterval(() => {
      const s = stateRef.current;
      if (!s) return;
      const idle = s.devices.filter(
        d =>
          d.connected &&
          !d.fault &&
          !d.doorOpen &&
          !['running', 'paused'].includes(d.job?.status ?? ''),
      );
      const busy = s.devices.filter(d => ['running', 'paused'].includes(d.job?.status ?? '')).length;
      if (!idle.length || busy >= 2) return;
      const d = idle[Math.floor(Math.random() * idle.length)];
      const plates = platesFor(s, d.id).filter(p => !p.paused);
      if (!plates.length) return;
      const p = plates[Math.floor(Math.random() * plates.length)];
      command('capture', d.id, {plateId: p.id}).catch(() => {});
    }, DEMO_CAPTURE_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const doExit = async () => {
    setExitAsk(false);
    setExiting(true);
    try {
      await fetch('/api/exit', {method: 'POST'});
    } catch {
      /* 종료 요청이 끊겨도 오버레이는 그대로 둔다. */
    }
  };

  const execute = async (
    cmd: string,
    deviceId: number,
    args: CommandArgs = {},
    next?: TabKey | null,
    confirm = false,
  ): Promise<unknown> => {
    const run = async () => {
      setConfirmModal(null);
      try {
        const result = await command(cmd, deviceId, args);
        if (next === 'detail') {
          setDetail({deviceId, slot: typeof args.slot === 'number' ? args.slot : 1});
          setTab('detail');
        } else if (next) {
          setTab(next);
        }
        return result;
      } catch (e) {
        const error = e as CommandError;
        setNotice({bad: true, text: `${error.code || 'ERROR'} · ${error.message}`});
        if (cmd === 'role.login') throw e;
        return null;
      }
    };

    if (confirm) {
      setConfirmModal({
        title: cmd === 'remove' ? '플레이트 반출' : '위험 동작 확인',
        text:
          cmd === 'remove'
            ? '보유 영상 파일을 삭제하고 슬롯을 비웁니다. 촬영 이력은 유지됩니다.'
            : '외부 가상장비의 진행 작업을 즉시 중단합니다.',
        run: () => void run(),
        danger: true,
      });
      return null;
    }
    return run();
  };

  if (!state) {
    return (
      <div className="boot">
        <h1>COLONY SCANNER</h1>
        <p>장비 제어 서버에 연결 중…</p>
        {notice && <p>{notice.text}</p>}
      </div>
    );
  }

  const openViewer = (plate: Plate, run: ShotTarget['run'], wellIndex: number) =>
    setViewer({plate, run, wellIndex});

  const screens: Record<TabKey, ReactNode> = {
    overview: (
      <OverviewScreen state={state} openDetail={openDetail} openRegister={openRegister} />
    ),
    detail: (
      <DetailScreen
        state={state}
        deviceId={detail.deviceId}
        slot={detail.slot}
        setSlot={(deviceId, slot) => setDetail({deviceId, slot})}
        send={execute}
        setTab={setTab}
        openRegister={openRegister}
        openViewer={openViewer}
      />
    ),
    register: (
      <RegisterScreen state={state} send={execute} setTab={setTab} device={registerDevice} />
    ),
    running: <CaptureScreen state={state} send={execute} openDetail={openDetail} />,
    history: (
      <HistoryScreen
        state={state}
        openDetail={openDetail}
        openPlateViewer={plate => setViewer({plate})}
      />
    ),
    device: <DeviceScreen state={state} send={execute} />,
    settings: (
      <SettingsScreen
        state={state}
        send={execute}
        operator={operator}
        setOperator={setOperator}
        onRole={() => setRoleDialog(true)}
      />
    ),
  };

  const idleLeft = Math.max(0, ADMIN_IDLE_LIMIT_SEC - Math.floor(state.session.idleFor / 1000));
  const expiring = state.session.role === 'admin' && state.session.idleFor >= ADMIN_IDLE_WARN_MS;

  return (
    <div className="app">
      <Header
        state={state}
        tab={tab}
        operator={operator}
        onRole={() => setRoleDialog(true)}
        onMenu={() => setMenuOpen(true)}
      />
      <main>{screens[tab]}</main>

      {menuOpen && <div className="drawer-scrim" onClick={() => setMenuOpen(false)} />}
      <MenuDrawer
        open={menuOpen}
        tab={tab}
        onSelect={key => {
          setTab(key);
          setMenuOpen(false);
        }}
        onExit={() => {
          setMenuOpen(false);
          setExitAsk(true);
        }}
        onClose={() => setMenuOpen(false)}
      />

      {notice && (
        <button className={`toast ${notice.bad ? 'bad' : ''}`} onClick={() => setNotice(null)}>
          {notice.text}
        </button>
      )}

      {expiring && (
        <div className="session-warning">관리자 권한이 {idleLeft}초 후 자동 해제됩니다.</div>
      )}

      {confirmModal && (
        <Modal
          title={confirmModal.title}
          onClose={() => setConfirmModal(null)}
          onConfirm={confirmModal.run}
          danger={confirmModal.danger}
        >
          <p>{confirmModal.text}</p>
        </Modal>
      )}

      {roleDialog && (
        <RoleDialog state={state} send={execute} onClose={() => setRoleDialog(false)} />
      )}

      {exitAsk && (
        <Modal
          title="가상 머신 종료"
          confirmLabel="종료하고 나가기"
          danger
          onConfirm={doExit}
          onClose={() => setExitAsk(false)}
        >
          <p>
            Colony Scanner 데모를 종료하고 바탕화면으로 돌아갑니다. 진행 중인 촬영이 있으면
            중단됩니다.
          </p>
        </Modal>
      )}

      {exiting && (
        <div className="exit-overlay">
          <div className="spin" />
          <b>가상 머신을 종료하고 있습니다</b>
          <span>바탕화면으로 이동합니다…</span>
        </div>
      )}

      {viewer && <ShotViewer target={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}
