import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Controller} from '../server/controller.mjs';
import {VirtualDeviceAdapter} from '../server/virtual-device.mjs';

const request=(n,command,deviceId,args={})=>({requestId:`test_request_${n}`,command,deviceId,args});
const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code);
test('device commands, role policy, retention and persistence',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'colony-test-'));let c=new Controller({dataDir:dir,adapter:new VirtualDeviceAdapter({stageMs:10}),autoTick:false});
 try{
  assert.equal(c.snapshot().session.role,'analyst');
  for(let i=0;i<4;i++)await rejects(c.execute(request(100+i,'role.login',0,{pin:'9999'})),'INVALID_PIN');
  await rejects(c.execute(request(104,'role.login',0,{pin:'9999'})),'INVALID_PIN');assert.ok(c.snapshot().session.lockedFor>0);
  c.session.lockUntil=0;await c.execute(request(105,'role.login',0,{pin:'0000'}));assert.equal(c.snapshot().session.role,'admin');
  c.session.idleAt=Date.now()-300001;c.tick(0);assert.equal(c.snapshot().session.role,'analyst');
  const registeredAt=Date.now(),registration=await c.execute(request(1,'register',3,{slot:16,registeredAt}),'test');const p=()=>c.snapshot().plates.find(x=>x.id===registration.plateId);
  assert.equal(p().slot,16);assert.equal((await c.execute(request(1,'register',3,{slot:16,registeredAt}),'test')).replayed,true);
  await rejects(c.execute(request(2,'register',3,{slot:16,registeredAt:Date.now()})),'SLOT_OCCUPIED');
  await c.execute(request(3,'capture',3,{plateId:p().id}));await rejects(c.execute(request(4,'home',3)),'DEVICE_BUSY');
  await c.execute(request(5,'pause',3));c.tick(100);assert.equal(c.snapshot().devices[2].job.status,'paused');await c.execute(request(6,'resume',3));c.tick(100);
  assert.equal(p().runs.length,1);assert.match(p().runs[0].image,/^https:\/\//);
  for(let i=0;i<5;i++){await c.execute(request(10+i,'capture',3,{plateId:p().id}));c.tick(100);}
  assert.equal(p().runs.filter(r=>r.imageState==='held').length,5);assert.equal(p().runs[0].imageState,'expired');
  await c.execute(request(20,'sim.input',3,{pcConnected:false}));await c.execute(request(21,'capture',3,{plateId:p().id}));c.tick(100);assert.equal(p().runs.at(-1).transferred,false);
  await rejects(c.execute(request(22,'retry',3,{plateId:p().id})),'PC_OFFLINE');await c.execute(request(23,'sim.input',3,{pcConnected:true}));assert.equal((await c.execute(request(24,'retry',3,{plateId:p().id}))).count,1);
  await c.execute(request(25,'sim.input',3,{doorOpen:true}));await rejects(c.execute(request(26,'capture',3,{plateId:p().id})),'DOOR_OPEN');await c.execute(request(27,'sim.input',3,{doorOpen:false}));await c.execute(request(28,'clearError',3));
  const runs=p().runs.length;await c.execute(request(33,'remove',3,{plateId:p().id}));assert.ok(p().removedAt);assert.equal(p().runs.length,runs);assert.equal(p().runs.filter(r=>r.imageState==='held').length,0);
  assert.ok(c.snapshot().io.some(x=>x.type==='NACK'));assert.doesNotThrow(()=>JSON.parse(readFileSync(join(dir,'state.json'),'utf8')));
  c.close();c=new Controller({dataDir:dir,adapter:new VirtualDeviceAdapter({stageMs:10}),autoTick:false});assert.ok(c.snapshot().plates.find(x=>x.id===registration.plateId).removedAt);
 }finally{c.close();rmSync(dir,{recursive:true,force:true});}
});
