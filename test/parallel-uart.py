"""Check grouped ACK/DONE handling, including completion before the final ACK."""
import importlib.util
from collections import deque
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('mcb',Path(__file__).parents[1]/'device/mcb.py')
mcb=importlib.util.module_from_spec(spec);spec.loader.exec_module(mcb)
GROUP=['MOVE 4 875','MOVE 1 -83','MOVE 3 75']

class FakeSerial:
    def __init__(self): self.writes=[]
    def write(self,data): self.writes.append(data);return len(data)
    def reset_input_buffer(self): pass
    def close(self): pass

def link_with(lines):
    link=object.__new__(mcb.Link);link.ser=FakeSerial();link.log=[];link.buf=b''
    queue=deque(lines)
    def read(deadline):
        assert link.ser.writes[0]==('\n'.join(GROUP)+'\n').encode(),'all axes must be commanded before waiting'
        if not queue: raise mcb.McbError('MCB_TIMEOUT')
        line=queue.popleft();link.log.append(line);return line
    link.readline=read
    link.status=lambda deadline:{i:{'MOV':0,'HOMED':1} for i in (1,3,4)}
    return link

class ParallelTests(unittest.TestCase):
    def test_fast_move_completion_before_other_ack_is_retained(self):
        link=link_with(['OK M4 TGT=875','EVT M4 DONE POS=875 RES=DONE','EVT M1 DONE POS=-83 RES=DONE','OK M1 TGT=-83','OK M3 TGT=75','EVT M3 DONE POS=75 RES=DONE'])
        link.run_parallel(GROUP,time.monotonic()+1)
        self.assertEqual(len(link.ser.writes),1)

    def test_fault_or_missing_completion_stops_all_and_blocks_next_step(self):
        cases=[['OK M4 TGT=875','EVT M1 FAULT'],['OK M4 TGT=875','OK M1 TGT=-83','OK M3 TGT=75','EVT M1 DONE POS=-83 RES=DONE','EVT M3 DONE POS=75 RES=DONE'],['ERR M3 LIMIT']]
        for lines in cases:
            with self.subTest(lines=lines),tempfile.TemporaryDirectory() as folder:
                link=link_with(lines)
                with patch.object(mcb,'LOCK',Path(folder)/'.lock'),patch.object(mcb,'Link',return_value=link):
                    with self.assertRaises(mcb.McbError):mcb.run({'steps':[{'parallel':GROUP},'MOVE 2 450'],'timeout':1})
                self.assertEqual(link.ser.writes[-1],b'STOP ALL\n')
                self.assertNotIn(b'MOVE 2 450\n',link.ser.writes)

    def test_invalid_later_group_is_rejected_before_any_motion(self):
        with patch.object(mcb,'Link') as open_uart:
            with self.assertRaisesRegex(ValueError,'DUPLICATE_PARALLEL_MOTOR'):
                mcb.run({'steps':['MOVE 4 875',{'parallel':['MOVE 1 -83','MOVE 1 -250']}]})
            open_uart.assert_not_called()

if __name__=='__main__': unittest.main()
