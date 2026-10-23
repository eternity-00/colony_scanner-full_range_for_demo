#!/usr/bin/env python3
"""MCB (STM32 motor board) link over the Pi 4 UART.

Protocol: MCB firmware docs/uart_protocol.md (115200 8N1, one command per line,
OK / ERR replies, asynchronous EVT notifications).

Used by local_agent.py ("mcb" command): one local request runs a list of steps in
order and waits for each motion to finish (EVT ... DONE / HOMED / HOMEALL DONE).

  {"command": "mcb", "args": {"steps": ["ENSURE_HOMED", "MOVE 4 1000"], "timeout": 120}}
  {"command": "mcb", "args": {"steps": ["PARAMS"]}}      -> result["params"]
  {"command": "mcb", "args": {"stop": true}}

Special steps: ENSURE_HOMED (HOME ALL only when a used motor is not homed),
PARAMS (read GET ALL into the result).

Command line (on the Pi 4):
  python3 mcb.py PING VER STATUS          run commands, motions wait for their EVT
  python3 mcb.py -i                       interactive
  python3 mcb.py --ping-test 100          link test
  python3 mcb.py --serve                  JSON lines session for the app (UART kept open)
"""
import argparse
import fcntl
import json
import os
import re
import sys
import time
from pathlib import Path

import serial

PORT = os.environ.get('COLONY_MCB_PORT', '/dev/serial0')
BAUD = 115200
LOCK = Path(os.environ.get('COLONY_MCB_LOCK', '~/.local/state/colony-scanner/.mcb.lock')).expanduser()
LINE_RE = re.compile(r'^[A-Z0-9 +-]{1,100}$')
MULTILINE = ('STATUS', 'GET ALL', 'INFO')	# replies that end with END


class McbError(RuntimeError):
    pass


def parse_kv(text):
    return {k: int(v) if re.fullmatch(r'-?\d+', v) else v for k, v in re.findall(r'([A-Z]+)=(\S+)', text)}


def parallel_commands(step):
    """Validate a group before any axis starts. A group uses distinct MOVE axes."""
    if not isinstance(step, dict) or set(step) != {'parallel'}:
        raise ValueError('INVALID_PARALLEL_STEP')
    commands = step['parallel']
    if not isinstance(commands, list) or not 1 <= len(commands) <= 6:
        raise ValueError('INVALID_PARALLEL_MOVES')
    result, motors = [], set()
    for command in commands:
        if not isinstance(command, str):
            raise ValueError('INVALID_PARALLEL_MOVE')
        command = command.strip().upper()
        match = re.fullmatch(r'MOVE ([1-6]) -?\d+(?: \d+)?', command)
        if not match or not LINE_RE.fullmatch(command):
            raise ValueError('INVALID_PARALLEL_MOVE: ' + command)
        motor = int(match[1])
        if motor in motors:
            raise ValueError('DUPLICATE_PARALLEL_MOTOR')
        motors.add(motor)
        result.append(command)
    return result


class Link:
    def __init__(self, port=PORT):
        self.ser = serial.Serial(port, BAUD, timeout=0.2)
        self.buf = b''
        self.log = []

    def close(self):
        self.ser.close()

    def readline(self, deadline):
        while b'\n' not in self.buf:
            if time.monotonic() > deadline:
                raise McbError('MCB_TIMEOUT')
            self.buf += self.ser.read(max(1, self.ser.in_waiting))	# return as soon as data arrives
        raw, self.buf = self.buf.split(b'\n', 1)
        line = raw.decode(errors='replace').strip()
        if line:
            self.log.append(line)
        return line

    def send(self, line, deadline):
        """Send one command; return its reply lines (several up to END for STATUS / GET ALL / INFO)."""
        self.log.append('> ' + line)
        self.ser.write((line + '\n').encode())
        multi = line.split()[0] == 'STATUS' and len(line.split()) == 1 or line in MULTILINE
        lines = []
        while True:
            reply = self.readline(deadline)
            if not reply or reply.startswith('EVT'):
                continue
            if reply.startswith('ERR'):
                raise McbError(f'MCB_ERROR: {line} -> {reply}')
            lines.append(reply)
            if not multi or reply == 'END':
                return lines

    def wait_event(self, match, fail, deadline):
        while True:
            line = self.readline(deadline)
            if not line.startswith('EVT'):
                continue
            if re.search(r'EVT M\d FAULT', line):
                raise McbError('MCB_FAULT: ' + line)
            if fail and fail(line):
                raise McbError('MCB_MOTION_FAILED: ' + line)
            if match(line):
                return line

    def status(self, deadline):
        return {int(ln[1]): parse_kv(ln) for ln in self.send('STATUS', deadline) if re.match(r'^M\d ', ln)}

    def params(self, deadline):
        return {int(ln[1]): parse_kv(ln) for ln in self.send('GET ALL', deadline) if re.match(r'^M\d ', ln)}

    def run_parallel(self, commands, deadline):
        """Send all MOVE lines immediately, then wait for every ACK and DONE.

        A short move may finish before another axis acknowledges its command.
        Keep completion events during the ACK phase instead of discarding them.
        """
        motors = {int(command.split()[1]) for command in commands}
        acknowledged, completed = set(), set()
        for command in commands:
            self.log.append('> ' + command)
        self.ser.write(('\n'.join(commands) + '\n').encode())
        while acknowledged != motors or completed != motors:
            line = self.readline(deadline)
            if line.startswith('ERR'):
                raise McbError('MCB_PARALLEL_ERROR: ' + line)
            if re.search(r'EVT M\d FAULT', line) or line.startswith('EVT BOOT'):
                raise McbError('MCB_PARALLEL_FAULT: ' + line)
            ack = re.match(r'^OK M([1-6])\b', line)
            done = re.match(r'^EVT M([1-6]) DONE\b', line)
            if ack and int(ack[1]) in motors:
                acknowledged.add(int(ack[1]))
            elif done and int(done[1]) in motors:
                if parse_kv(line).get('RES') != 'DONE':
                    raise McbError('MCB_PARALLEL_MOTION_FAILED: ' + line)
                completed.add(int(done[1]))

    def run_step(self, step, deadline):
        """One command; motions wait for their completion event. Returns the reply lines."""
        if step == 'ENSURE_HOMED':
            motors = self.status(deadline)
            if not motors:
                raise McbError('MCB_EMPTY_STATUS')
            if all(m.get('HOMED') == 1 for m in motors.values()):
                return []
            step = 'HOME ALL'
        if not LINE_RE.match(step):
            raise McbError('INVALID_STEP: ' + step)
        words = step.split()
        reply = self.send(step, deadline)
        cmd = words[0]
        if cmd == 'HOME' and words[1:] == ['ALL']:
            self.wait_event(lambda l: l.startswith('EVT HOMEALL DONE'),
                            lambda l: l.startswith('EVT HOMEALL FAIL'), deadline)
        elif cmd == 'HOME' and len(words) > 1:
            m = words[1]
            self.wait_event(lambda l: l.startswith(f'EVT M{m} HOMED'),
                            lambda l: l.startswith(f'EVT M{m} HOMEFAIL'), deadline)
        elif cmd in ('MOVE', 'JOG') and len(words) > 1:
            m = words[1]
            line = self.wait_event(lambda l: l.startswith(f'EVT M{m} DONE'), None, deadline)
            if 'RES=DONE' not in line and 'RES=SENSOR' not in line:
                raise McbError('MCB_MOTION_FAILED: ' + line)
        return reply


def stop(port=PORT):
    """STOP ALL without the lock, so it can interrupt a running request."""
    with serial.Serial(port, BAUD, timeout=0.2) as ser:
        ser.write(b'STOP ALL\n')
    return {'sent': 'STOP ALL'}


class Locked:
    """Exclusive use of the UART between agent requests and the command line tool."""

    def __enter__(self):
        LOCK.parent.mkdir(parents=True, exist_ok=True)
        self.file = LOCK.open('a')
        try:
            fcntl.flock(self.file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            self.file.close()
            raise McbError('MCB_BUSY')
        return self

    def __exit__(self, *exc):
        self.file.close()


def run(args, link=None):
    """local_agent.py "mcb" command; `link` = an open Link to reuse (serve())."""
    if args.get('stop'):
        return stop()
    steps = args.get('steps')
    if not isinstance(steps, list) or not steps:
        raise ValueError('steps must be a non-empty list')
    # Validate the whole request before opening the UART or moving a motor.
    normalized = []
    for step in steps:
        if isinstance(step, dict):
            normalized.append({'parallel': parallel_commands(step)})
        elif isinstance(step, str) and (step.strip().upper() == 'ENSURE_HOMED' or LINE_RE.fullmatch(step.strip().upper())):
            normalized.append(step.strip().upper())
        else:
            raise ValueError('INVALID_STEP')
    deadline = time.monotonic() + min(max(float(args.get('timeout', 120)), 1), 600)
    result = {'replies': []}
    with Locked():
        own = link is None
        if own:
            link = Link()
        link.log, link.buf = [], b''
        started = time.monotonic()
        try:
            link.ser.reset_input_buffer()
            for step in normalized:
                if isinstance(step, dict):
                    link.run_parallel(step['parallel'], deadline)
                elif step == 'PARAMS':
                    result['params'] = link.params(deadline)
                else:
                    # reply lines per step (SET / SAVE / GET ALL / STATUS ... for the admin tool)
                    result['replies'].append({'step': step, 'reply': link.run_step(step, deadline)})
            result['motors'] = link.status(deadline)
        except (McbError, serial.SerialException) as error:
            # A failed parallel move can leave another axis running; halt it before
            # rejecting the request, and never execute later recipe steps.
            try:
                link.ser.write(b'STOP ALL\n')
            except (OSError, serial.SerialException):
                pass
            raise McbError(f'{error} | log: ' + ' / '.join(link.log[-12:]))
        finally:
            if own:
                link.close()
        result.update(log=link.log, seconds=round(time.monotonic() - started, 2))
        return result


def serve():
    """Persistent session for the app: one JSON request per stdin line
    ({"id": .., "args": <run() args>}), one reply line each. The UART stays open
    between requests (no process start / port open per move); the lock is taken
    per request, so the command line tool can still use the port in between."""
    link = None
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            args = request.get('args', {})
            if not isinstance(args, dict):
                raise ValueError('args must be an object')
            if args.get('stop'):
                result = stop()
            else:
                if link is None:
                    link = Link()
                result = run(args, link)
            reply = {'id': request.get('id'), 'ok': True, 'result': result}
        except Exception as error:
            if isinstance(error, (OSError, serial.SerialException)) and link is not None:
                link.close()
                link = None
            reply = {'id': request.get('id') if isinstance(request, dict) else None, 'ok': False,
                     'error': {'code': type(error).__name__, 'message': str(error)}}
        print(json.dumps(reply, ensure_ascii=False), flush=True)
    if link is not None:
        link.close()


def main():
    ap = argparse.ArgumentParser(description='MCB command line over the Pi 4 UART')
    ap.add_argument('-p', '--port', default=PORT)
    ap.add_argument('-i', '--interactive', action='store_true')
    ap.add_argument('-t', '--timeout', type=float, default=300, help='seconds per command')
    ap.add_argument('--ping-test', type=int, metavar='N', help='send PING N times and count replies')
    ap.add_argument('--serve', action='store_true', help='JSON lines session for the app (stdin / stdout)')
    ap.add_argument('commands', nargs='*')
    a = ap.parse_args()
    if a.serve:
        serve()
        return 0
    with Locked():
        link = Link(a.port)
        link.ser.reset_input_buffer()
        try:
            if a.ping_test:
                ok, t0 = 0, time.monotonic()
                for _ in range(a.ping_test):
                    try:
                        ok += link.send('PING', time.monotonic() + 1) == ['OK PONG']
                    except McbError:
                        pass
                print(f'PING {ok}/{a.ping_test} ok, {time.monotonic() - t0:.1f} s')
                return 0 if ok == a.ping_test else 1
            commands = a.commands if not a.interactive else (ln.strip() for ln in sys.stdin)
            for cmd in commands:
                if not cmd:
                    continue
                link.log.clear()
                try:
                    link.run_step(cmd.strip().upper(), time.monotonic() + a.timeout)
                except McbError as error:
                    link.log.append(str(error))
                print('\n'.join(link.log), flush=True)
        finally:
            link.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
