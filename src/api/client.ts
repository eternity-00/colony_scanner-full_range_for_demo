import type {AppState, CommandArgs, CommandError, ConnectionStatus} from './types.ts';

const id = () => crypto.randomUUID().replaceAll('-', '');

export async function getState(): Promise<AppState> {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error('가상장비 서버 상태를 읽을 수 없습니다.');
  return res.json() as Promise<AppState>;
}

export async function command(
  command: string,
  deviceId: number,
  args: CommandArgs = {},
): Promise<unknown> {
  const requestId = id();
  const res = await fetch('/api/commands', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({requestId, command, deviceId, args}),
  });
  const data = await res.json().catch(() => ({message: '서버 응답을 읽을 수 없습니다.'}));
  if (!res.ok) throw Object.assign(new Error(data.message) as CommandError, {code: data.code});
  return data;
}

export function subscribe(
  onState: (state: AppState) => void,
  onStatus: (status: ConnectionStatus) => void,
): () => void {
  const stream = new EventSource('/api/events');
  stream.addEventListener('state', event => onState(JSON.parse(event.data) as AppState));
  stream.onopen = () => onStatus('live');
  stream.onerror = () => onStatus('reconnecting');
  return () => stream.close();
}
