"""Exercise the actual UART parser against a PTY, without moving any hardware."""
import importlib.util
import os
from pathlib import Path
import pty
import tempfile
import threading
import unittest

class LocalUartTest(unittest.TestCase):
    def test_firmware_multiline_and_events(self):
        master, slave = pty.openpty()
        with tempfile.TemporaryDirectory(prefix='colony-uart-test-') as folder:
            spec = importlib.util.spec_from_file_location('local_mcb', Path(__file__).parents[1]/'device/mcb.py')
            mcb = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mcb)
            mcb.PORT = os.ttyname(slave)
            mcb.LOCK = Path(folder)/'.mcb.lock'
            # Link's default is evaluated at import; inject only the simulated port.
            original = mcb.Link
            mcb.Link = lambda: original(os.ttyname(slave))
            seen = []
            def firmware():
                buf = b''
                while True:
                    try: buf += os.read(master, 4096)
                    except OSError: return
                    while b'\n' in buf:
                        raw, buf = buf.split(b'\n', 1)
                        cmd = raw.decode().strip(); seen.append(cmd)
                        if cmd == 'GET ALL':
                            reply = 'OK PARAMS\r\n' + ''.join(f'M{i} USED=1 RANGE=2600 HDIR=-1 HPARK=5\r\n' for i in range(1,5)) + 'END\r\n'
                        elif cmd == 'STATUS':
                            reply = 'EVT SENS 1 0 0 0 0 0\r\nOK SYS FW=13\r\n' + ''.join(f'M{i} HOMED=1 POS=0\r\n' for i in range(1,5)) + 'END\r\n'
                        elif cmd == 'MOVE 1 20': reply = 'OK M1 TGT=20\r\nEVT M1 DONE POS=20 RES=DONE\r\n'
                        else: reply = 'ERR ARGS\r\n'
                        os.write(master, reply.encode())
            threading.Thread(target=firmware, daemon=True).start()
            result = mcb.run({'steps':['PARAMS','ENSURE_HOMED','MOVE 1 20'],'timeout':3})
            self.assertEqual(result['params'][4]['RANGE'],2600)
            self.assertNotIn('HOME ALL',seen)
            self.assertEqual(len(result['motors']),4)
            with self.assertRaisesRegex(mcb.McbError,'MCB_ERROR'):
                mcb.run({'steps':['BAD'],'timeout':2})
        os.close(slave); os.close(master)

if __name__ == '__main__': unittest.main()
