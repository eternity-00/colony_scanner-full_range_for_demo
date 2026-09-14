import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Controller} from '../server/controller.mjs';

const request=(n,command,deviceId,args={})=>({requestId:`test_request_${n}`,command,deviceId,args});
test('virtual scanner command, I/O, safety and persistence flow',()=>{
 const dir=mkdtempSync(join(tmpdir(),'colony-test-'));
 let c=new Controller({dataDir:dir,stageMs:10,autoTick:false});
 try{
  assert.equal(c.snapshot().devices.length,4);
  assert.equal(c.snapshot().plates.filter(p=>!p.removedAt).length,63);
  const registeredAt=Date.now();
  const registration=c.execute(request(1,'register',3,{slot:16,registeredAt}));
  const p=()=>c.snapshot().plates.find(p=>p.id===registration.plateId);
  assert.equal(p().slot,16);
  const replay=c.execute(request(1,'register',3,{slot:16,registeredAt}));
  assert.equal(replay.replayed,true);
  assert.throws(()=>c.execute(request(2,'register',3,{slot:16,registeredAt:Date.now()})),e=>e.code==='SLOT_OCCUPIED');
  c.execute(request(3,'capture',3,{plateId:p().id}));
  assert.throws(()=>c.execute(request(4,'home',3)),e=>e.code==='DEVICE_BUSY');
  c.execute(request(5,'pause',3));c.tick(100);assert.equal(c.snapshot().devices[2].job.status,'paused');
  c.execute(request(6,'resume',3));c.tick(100);
  assert.equal(p().runs.length,1);assert.equal(p().runs[0].imageState,'held');assert.ok(existsSync(join(dir,'images',p().runs[0].image)));
  for(let i=0;i<5;i++){c.execute(request(10+i,'capture',3,{plateId:p().id}));c.tick(100);}
  assert.equal(p().runs.length,6);assert.equal(p().runs.filter(r=>r.imageState==='held').length,5);assert.equal(p().runs[0].imageState,'expired');
  c.execute(request(20,'sim.input',3,{pcConnected:false}));c.execute(request(21,'capture',3,{plateId:p().id}));c.tick(100);
  assert.equal(p().runs.at(-1).transferred,false);
  assert.throws(()=>c.execute(request(22,'retry',3,{plateId:p().id})),e=>e.code==='PC_OFFLINE');
  c.execute(request(23,'sim.input',3,{pcConnected:true}));assert.equal(c.execute(request(24,'retry',3,{plateId:p().id})).count,1);
  c.execute(request(25,'sim.input',3,{doorOpen:true}));assert.throws(()=>c.execute(request(26,'capture',3,{plateId:p().id})),e=>e.code==='DOOR_OPEN');
  c.execute(request(27,'sim.input',3,{doorOpen:false}));c.execute(request(28,'clearError',3));
  c.execute(request(29,'sim.input',3,{failCamera:true}));c.execute(request(30,'capture',3,{plateId:p().id}));c.tick(10);c.tick(10);
  assert.equal(p().runs.at(-1).imageState,'failed');
  c.execute(request(31,'sim.input',3,{failCamera:false}));c.execute(request(32,'clearError',3));
  const runs=p().runs.length;c.execute(request(33,'remove',3,{plateId:p().id}));assert.ok(p().removedAt);assert.equal(p().runs.length,runs);assert.equal(p().runs.filter(r=>r.imageState==='held').length,0);
  assert.ok(c.snapshot().io.some(x=>x.direction==='TX'));assert.ok(c.snapshot().io.some(x=>x.type==='ACK'));assert.ok(c.snapshot().io.some(x=>x.type==='NACK'));
  assert.doesNotThrow(()=>JSON.parse(readFileSync(join(dir,'state.json'),'utf8')));
  c.close();c=new Controller({dataDir:dir,stageMs:10,autoTick:false});
  assert.ok(c.snapshot().plates.find(x=>x.id===registration.plateId).removedAt);
 }finally{c.close();rmSync(dir,{recursive:true,force:true});}
});
