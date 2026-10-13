import type {AppState, CommandArgs, CommandError} from './types.ts';

/**
 * 명령마다 붙이는 requestId. 서버는 8~100자 [A-Za-z0-9_-] 만 받고, 같은 값이
 * 다시 오면 앞선 결과를 그대로 돌려준다(재전송 방지).
 *
 * crypto.randomUUID 는 「안전한 문맥」에서만 있다 — https 이거나 localhost 일 때.
 * 파이 화면은 http://127.0.0.1 이라 늘 있었지만, 같은 서버를 다른 기기에서
 * http://<파이 주소> 로 열면 없어서 「crypto.randomUUID is not a function」 으로
 * 모든 명령이 실패했다. PIN 입력도 그중 하나였다.
 * getRandomValues 는 문맥을 가리지 않으므로 그것으로 만들고, 그마저 없으면
 * 시각 + Math.random 으로 내려간다 — 한 화면에서 쓰는 값이라 그 정도로 충분하다.
 */
const id = () => {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replaceAll('-', '');
  if (c?.getRandomValues) {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

export async function getState(): Promise<AppState> {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error('장비 제어 서버 상태를 읽을 수 없습니다.');
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

export function subscribe(onState: (state: AppState) => void): () => void {
  const stream = new EventSource('/api/events');
  stream.addEventListener('state', event => onState(JSON.parse(event.data) as AppState));
  return () => stream.close();
}
