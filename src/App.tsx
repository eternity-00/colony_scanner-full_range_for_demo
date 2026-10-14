import {useEffect, useState, type ReactNode} from 'react';
import {command, getState, subscribe} from './api/client.ts';
import type {AppState, CommandArgs, CommandError, Plate} from './api/types.ts';
import {
  ADMIN_ACTION,
  ADMIN_IDLE_LIMIT_SEC,
  ADMIN_IDLE_WARN_MS,
  tabsFor,
  type TabKey,
} from './config/defines.ts';
import {RoleDialog} from './features/auth/RoleDialog.tsx';
import {UserCard} from './features/auth/UserCard.tsx';
import {CaptureScreen} from './features/capture/CaptureScreen.tsx';
import {DetailScreen} from './features/detail/DetailScreen.tsx';
import {DeviceScreen} from './features/device/DeviceScreen.tsx';
import {HistoryScreen} from './features/history/HistoryScreen.tsx';
import {OverviewScreen} from './features/overview/OverviewScreen.tsx';
import {RegisterScreen} from './features/register/RegisterScreen.tsx';
import {SettingsScreen} from './features/settings/SettingsScreen.tsx';
import {StatusScreen} from './features/status/StatusScreen.tsx';
import {Header} from './layout/Header.tsx';
import {MenuDrawer} from './layout/MenuDrawer.tsx';
import {Modal} from './shared/Modal.tsx';
import {ShotViewer, type ShotTarget} from './shared/ShotViewer.tsx';
import {hms, ymd} from './utils/datetime.ts';
import {useLayoutWidth} from './utils/viewport.ts';

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

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');
  const [detail, setDetail] = useState({deviceId: 1, slot: 1});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmModal | null>(null);
  const [viewer, setViewer] = useState<ShotTarget | null>(null);
  const [roleDialog, setRoleDialog] = useState(false);
  const [userCard, setUserCard] = useState(false);
  /** 분석자가 장비 오류를 눌렀을 때 뜨는 안내. */
  const [adminAsk, setAdminAsk] = useState<{where: string; what: string} | null>(null);
  // 관리자 권한이 없어 막힌 동작. PIN 이 맞으면 retry 로 그대로 이어서 보낸다.
  const [gate, setGate] = useState<{reason: string; retry: () => void} | null>(null);
  const [registerAt, setRegisterAt] = useState<{deviceId: number; slot?: number}>({deviceId: 1});
  const [menu, setMenu] = useState(false);
  const [exitAsk, setExitAsk] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [operator, setOperator] = useState(
    () => localStorage.getItem('colony-operator') || '김분석',
  );
  const layoutWidth = useLayoutWidth();

  // 최초 상태를 한 번 읽고, 이후에는 SSE 로 받는다.
  useEffect(() => {
    let live = true;
    getState()
      .then(s => live && setState(s))
      .catch((e: Error) => setNotice({bad: true, text: e.message}));
    const stop = subscribe(s => live && setState(s));
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

  const openRegister = (deviceId: number, slot?: number) => {
    setRegisterAt({deviceId, slot});
    setTab('register');
  };

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
        // 서버가 권한으로 막은 것이면 오류 토스트 대신 확인 팝업을 띄운다.
        // 화면에서 버튼을 잠그는 것과 달리, 어느 경로로 들어와도 여기서 걸린다.
        if (error.code === 'FORBIDDEN' && cmd !== 'role.login') {
          setGate({reason: ADMIN_ACTION[cmd] || '이 동작', retry: () => void run()});
          return null;
        }
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
            : '스캐너의 진행 작업을 즉시 중단합니다.',
        run: () => void run(),
        danger: true,
      });
      return null;
    }
    return run();
  };

  if (!state) {
    return (
      <div className="boot" data-w={layoutWidth}>
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
      <OverviewScreen
        state={state}
        send={execute}
        openDetail={openDetail}
        openRegister={openRegister}
        onDevice={() => setTab('device')}
        onStatus={() => setTab('status')}
        onNeedAdmin={(where, what) => setAdminAsk({where, what})}
      />
    ),
    status: <StatusScreen state={state} openDetail={openDetail} openRegister={openRegister} />,
    detail: (
      <DetailScreen
        state={state}
        deviceId={detail.deviceId}
        slot={detail.slot}
        setSlot={(deviceId, slot) => setDetail({deviceId, slot})}
        send={execute}
        openRegister={openRegister}
        openViewer={openViewer}
      />
    ),
    register: (
      <RegisterScreen
        state={state}
        send={execute}
        setTab={setTab}
        device={registerAt.deviceId}
        slot={registerAt.slot}
      />
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
        onExit={() => setExitAsk(true)}
        state={state}
        send={execute}
        operator={operator}
        setOperator={setOperator}
        onRole={() => setRoleDialog(true)}
      />
    ),
  };

  const isAdmin = state.session.role === 'admin';
  // 관리자 권한이 5분 무조작으로 풀리면, 보고 있던 관리자 화면에서도 빠져나온다.
  const visible = tabsFor(isAdmin).some(([key]) => key === tab) ? tab : 'overview';

  const idleLeft = Math.max(0, ADMIN_IDLE_LIMIT_SEC - Math.floor(state.session.idleFor / 1000));
  const expiring = isAdmin && state.session.idleFor >= ADMIN_IDLE_WARN_MS;

  return (
    <div className="app" data-w={layoutWidth}>
      <Header
        state={state}
        tab={visible}
        clock={hms(state.serverTime)}
        day={ymd(state.serverTime)}
        operator={operator}
        onMenu={() => setMenu(true)}
        onAccount={() => setUserCard(true)}
      />
      <main>{screens[visible]}</main>
      <MenuDrawer
        open={menu}
        tab={visible}
        isAdmin={isAdmin}
        onSelect={key => {
          setTab(key);
          setMenu(false);
        }}
        onClose={() => setMenu(false)}
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

      {adminAsk && (
        <Modal
          title="관리자 확인이 필요합니다"
          confirmLabel="관리자 전환"
          onConfirm={() => {
            setAdminAsk(null);
            setRoleDialog(true);
          }}
          onClose={() => setAdminAsk(null)}
        >
          <div className="ask-fault">
            <b>{adminAsk.where}</b>
            <span>{adminAsk.what}</span>
          </div>
          <p>
            오류 해제와 원점 복귀는 <b>관리자 권한</b>이 필요합니다. 관리자에게 문의하시거나 PIN 을
            넣어 전환하세요.
          </p>
        </Modal>
      )}

      {userCard && (
        <UserCard
          state={state}
          send={execute}
          operator={operator}
          onSettings={() => {
            setUserCard(false);
            setTab('settings');
          }}
          onUpgrade={() => {
            setUserCard(false);
            setRoleDialog(true);
          }}
          onClose={() => setUserCard(false)}
        />
      )}

      {roleDialog && (
        <RoleDialog state={state} send={execute} onClose={() => setRoleDialog(false)} />
      )}

      {gate && (
        <RoleDialog
          state={state}
          send={execute}
          reason={gate.reason}
          onAuthed={gate.retry}
          onClose={() => setGate(null)}
        />
      )}

      {exitAsk && (
        <Modal
          title="종료"
          confirmLabel="종료하고 나가기"
          danger
          onConfirm={doExit}
          onClose={() => setExitAsk(false)}
        >
          <p>
            Colony Scanner 를 종료하고 바탕화면으로 돌아갑니다. 진행 중인 촬영이 있으면
            중단됩니다.
          </p>
        </Modal>
      )}

      {exiting && (
        <div className="exit-overlay">
          <div className="spin" />
          <b>종료하고 있습니다</b>
          <span>바탕화면으로 이동합니다…</span>
        </div>
      )}

      {viewer && <ShotViewer target={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}
