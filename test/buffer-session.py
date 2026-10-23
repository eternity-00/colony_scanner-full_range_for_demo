"""Exercise the actual session process with fake V4L2/stream/worker executables."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
import uuid

SCRIPT = Path(__file__).parents[1] / 'device' / 'capture-session.py'

class SessionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='buffer-session-test-')
        self.root = Path(self.temp.name)
        self.output = self.root / 'output'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.executable('v4l2-ctl', """import sys
if '--list-formats-ext' in sys.argv:
 print("[0]: 'YUYV'\\n Size: Discrete 2x2")
else: print("Width/Height : 2/2\\nPixel Format : 'YUYV'")
""")
        self.stream = self.executable('stream', """import sys,json,time,os
from pathlib import Path
print(json.dumps({'event':'ready'}),flush=True)
for sequence,line in enumerate(sys.stdin):
 if os.environ.get('FAIL_STREAM') and sequence==1: sys.exit(1)
 ready,path=line.rstrip().split(' ',1)
 Path(path).write_bytes(b'01234567')
 print(json.dumps({'event':'frame','sequence':sequence,'frameMonotonic':float(ready)+.01,'eligibleMonotonic':float(ready),'readyMonotonic':float(ready),'bufferCapacity':3}),flush=True)
""")
        self.worker = self.executable('worker', """import sys,json,time,os
for line in sys.stdin:
 r=json.loads(line);time.sleep(.15)
 print(json.dumps({'event':'processed','id':r['id'],'result':{'id':r['id'],'processingPid':os.getpid()}}),flush=True)
""")
        self.env = {**os.environ, 'PATH': str(self.bin) + os.pathsep + os.environ['PATH'],
                    'COLONY_RECEIVE_DIR': str(self.output), 'COLONY_CAMERA_STREAM_BIN': str(self.stream),
                    'COLONY_CAPTURE_WORKER_SCRIPT': str(self.worker), 'COLONY_CAPTURE_COUNT': '6'}
        self.child = None
    def executable(self,name,body):
        path = self.bin/name
        path.write_text('#!/usr/bin/env python3\n'+body)
        path.chmod(0o755)
        return path
    def start(self,extra=None):
        self.child = subprocess.Popen(['python3',str(SCRIPT)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE,text=True,env={**self.env,**(extra or {})})
        return json.loads(self.child.stdout.readline())
    def send(self,request):
        self.child.stdin.write(json.dumps(request)+'\n')
        self.child.stdin.flush()
    def tearDown(self):
        if self.child:
            if self.child.poll() is None:
                self.child.terminate()
                self.child.wait(timeout=5)
            for stream in (self.child.stdin,self.child.stdout,self.child.stderr):
                stream.close()
        self.temp.cleanup()
    def test_all_raw_frames_are_buffered_without_waiting_for_conversion_and_stream_closes_first(self):
        ready = self.start()
        self.assertEqual(ready['event'],'ready')
        self.assertNotEqual(ready['processingPid'],ready['acquisitionPid'])
        events=[];started=time.monotonic()
        for _ in range(6):
            token=str(uuid.uuid4())
            self.send({'command':'capture','id':token,'readyMonotonic':time.monotonic()})
            while True:
                event=json.loads(self.child.stdout.readline());events.append(event)
                if event['event']=='acquired':
                    self.assertEqual(event['id'],token)
                    break
        self.assertLess(time.monotonic()-started,.7,'all raw acquisition must finish before the 0.9-second conversion queue')
        self.send({'command':'end'})
        for line in self.child.stdout:events.append(json.loads(line))
        self.assertEqual(self.child.wait(timeout=5),0,self.child.stderr.read())
        kinds=[e['event'] for e in events]
        self.assertEqual(kinds.count('acquired'),6)
        self.assertEqual(kinds.count('processed'),6)
        self.assertLess(kinds.index('acquisition-ended'),max(i for i,k in enumerate(kinds) if k=='processed'))
        self.assertEqual(kinds[-1],'closed')
        self.assertFalse(list(self.output.glob('.capture-session-*')))
    def test_plate_exceeding_queue_capacity_is_rejected_before_acquisition(self):
        first=self.start({'COLONY_CAPTURE_QUEUE_FRAMES':'3'})
        self.assertEqual(first['event'],'failed')
        self.assertIn('INVALID_BUFFER_CONFIGURATION',first['error'])
        self.assertNotEqual(self.child.wait(timeout=5),0)
    def test_camera_failure_kills_worker_and_cleans_temporary_raw_files(self):
        ready=self.start({'FAIL_STREAM':'1'})
        for _ in range(2):
            self.send({'command':'capture','id':str(uuid.uuid4())})
            while True:
                event=json.loads(self.child.stdout.readline())
                if event['event'] in ('acquired','failed'):break
        self.assertEqual(event['event'],'failed')
        self.assertNotEqual(self.child.wait(timeout=5),0)
        with self.assertRaises(ProcessLookupError):os.kill(ready['processingPid'],0)
        self.assertFalse(list(self.output.glob('.capture-session-*')))

if __name__=='__main__':unittest.main()
