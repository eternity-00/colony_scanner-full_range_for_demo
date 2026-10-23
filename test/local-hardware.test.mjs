import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {McbMotion} from '../server/mcb-motion.mjs';
const config={axes:{cameraX:1,trayX:2,cameraY:3,trayZ:4},tiers:8,wellColumns:3,wellRows:2,trayOut:450,captureZ:720};

test('local motor bridge handles firmware replies, failures and concurrent requests',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'local-mcb-'));
 const sessionScript=join(dir,'serve.py');
 // stands in for `mcb.py --serve`: one JSON request per line, one reply line each
 writeFileSync(sessionScript,`import sys,json,time,os
for line in sys.stdin:
 r=json.loads(line)
 if r['args'].get('steps')==['FAIL']:
  print(json.dumps({'id':r['id'],'ok':False,'error':{'message':'MCB_TIMEOUT'}}),flush=True);continue
 time.sleep(.15)
 print(json.dumps({'id':r['id'],'ok':True,'result':{'pid':os.getpid(),'params':{str(i):{'USED':1,'RANGE':2600,'HDIR':-1,'HPARK':5} for i in range(1,5)},'seconds':.15}}),flush=True)
`);
 let motion;
 try{
  motion=new McbMotion({config,sessionScript});
  const pending=motion.refresh();
  await assert.rejects(motion.run(['PARAMS']),/MOTION_BUSY/);
  await pending;assert.equal(motion.machine[4].RANGE,2600);
  assert.deepEqual(motion.wellOrder(),[1,2,3,6,5,4]);
  await assert.rejects(motion.run(['FAIL']),/MCB_TIMEOUT/);
  assert.equal(motion.busy,false);
  const a=await motion.run(['PARAMS']),b=await motion.run(['PARAMS']);
  assert.equal(a.pid,b.pid,'requests share one session process');
 }finally{motion?.close();rmSync(dir,{recursive:true,force:true});}
});
