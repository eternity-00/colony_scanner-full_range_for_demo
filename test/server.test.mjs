import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Controller,imagesOf} from '../server/controller.mjs';
import {VirtualDeviceAdapter} from '../server/virtual-device.mjs';

const request=(n,command,deviceId,args={})=>({requestId:`test_request_${n}`,command,deviceId,args});
const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code);
const profile={name:'test',title:'test',adapter:'virtual',layout:{tiers:8,columns:3},features:{simAlarm:true},autoRun:true};

test('device commands, role policy, retention and persistence (one scanner)',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'colony-test-'));let c=new Controller({dataDir:dir,adapter:new VirtualDeviceAdapter({stageMs:10}),autoTick:false,profile});
 try{
  assert.equal(c.snapshot().session.role,'analyst');
  assert.equal(c.snapshot().plates.length,0,'no demo plates');
  assert.deepEqual(c.snapshot().profile.layout,{tiers:8,columns:3,slots:24,tierShared:false,capacity:24});
  for(let i=0;i<4;i++)await rejects(c.execute(request(100+i,'role.login',0,{pin:'9999'})),'INVALID_PIN');
  await rejects(c.execute(request(104,'role.login',0,{pin:'9999'})),'INVALID_PIN');assert.ok(c.snapshot().session.lockedFor>0);
  // admin-only device commands are refused for the analyst
  await rejects(c.execute(request(106,'home',1)),'FORBIDDEN');
  c.session.lockUntil=0;await c.execute(request(105,'role.login',0,{pin:'0000'}));assert.equal(c.snapshot().session.role,'admin');
  c.session.idleAt=Date.now()-300001;c.tick(0);assert.equal(c.snapshot().session.role,'analyst');
  const registration=await c.execute(request(1,'register',1,{slot:16}),'test');const p=()=>c.snapshot().plates.find(x=>x.id===registration.plateId);
  assert.equal(p().slot,16);assert.equal((await c.execute(request(1,'register',1,{slot:16}),'test')).replayed,true);
  assert.equal(c.snapshot().captureHold,true,'registration holds the scheduler');
  await rejects(c.execute(request(2,'register',1,{slot:16})),'SLOT_OCCUPIED');
  await rejects(c.execute(request(40,'register',1,{slot:25})),'INVALID_SLOT');
  await c.execute(request(41,'registerDone',0));assert.equal(c.snapshot().captureHold,false);
  await c.execute(request(3,'capture',1,{plateId:p().id}));await rejects(c.execute(request(4,'pause',2)),'INVALID_DEVICE');
  await c.execute(request(5,'pause',1));c.tick(100);assert.equal(c.snapshot().devices[0].job.status,'paused');await c.execute(request(6,'resume',1));c.tick(100);
  assert.equal(p().runs.length,1);assert.equal(p().runs[0].images.length,6);assert.match(p().runs[0].images[0],/placeholder/);
  for(let i=0;i<5;i++){await c.execute(request(10+i,'capture',1,{plateId:p().id}));c.tick(100);}
  assert.equal(p().runs.filter(r=>r.imageState==='held').length,5);assert.equal(p().runs[0].imageState,'expired');assert.equal(p().runs[0].images,null);
  await c.execute(request(20,'sim.input',1,{pcConnected:false}));await c.execute(request(21,'capture',1,{plateId:p().id}));c.tick(100);assert.equal(p().runs.at(-1).transferred,false);
  await rejects(c.execute(request(22,'retry',1,{plateId:p().id})),'PC_OFFLINE');await c.execute(request(23,'sim.input',1,{pcConnected:true}));assert.equal((await c.execute(request(24,'retry',1,{plateId:p().id}))).count,1);
  await c.execute(request(25,'sim.input',1,{doorOpen:true}));await rejects(c.execute(request(26,'capture',1,{plateId:p().id})),'DOOR_OPEN');await c.execute(request(27,'sim.input',1,{doorOpen:false}));
  await c.execute(request(42,'role.login',0,{pin:'0000'}));await c.execute(request(28,'clearError',1));
  // alarm test hooks (profile feature) and settings
  const partial=await c.execute(request(29,'sim.alarm',1,{kind:'partial'}));assert.equal(partial.plateId,p().id);assert.equal(p().runs.at(-1).images.filter(x=>x===null).length,3);
  await c.execute(request(43,'sim.alarm',1,{kind:'clear'}));assert.ok(p().runs.every(r=>!r.sim));
  await c.execute(request(30,'settings',0,{alignment:true}));assert.equal(c.snapshot().settings.alignment,true);
  await rejects(c.execute(request(31,'settings',0,{alignment:'yes'})),'INVALID_VALUE');
  await rejects(c.execute(request(32,'routine',0,{cycleHours:12,days:90,delay:0})),'INVALID_ROUTINE');
  await c.execute(request(33,'routine',0,{cycleHours:6,days:14,delay:30,wellShots:5}));assert.equal(c.snapshot().routine.wellShots,5);
  // maintenance lock blocks device commands and the scheduler
  c.enterMaintenance('test');await rejects(c.execute(request(34,'capture',1,{plateId:p().id})),'MAINTENANCE');await c.execute(request(35,'autoRun',0,{enabled:true}));c.exitMaintenance();
  const runs=p().runs.length;await c.execute(request(36,'remove',1,{plateId:p().id}));assert.ok(p().removedAt);assert.equal(p().runs.length,runs);assert.equal(p().runs.filter(r=>r.imageState==='held').length,0);
  assert.ok(c.snapshot().io.some(x=>x.type==='NACK'));assert.doesNotThrow(()=>JSON.parse(readFileSync(join(dir,'state.json'),'utf8')));
  c.close();c=new Controller({dataDir:dir,adapter:new VirtualDeviceAdapter({stageMs:10}),autoTick:false,profile});assert.ok(c.snapshot().plates.find(x=>x.id===registration.plateId).removedAt);assert.equal(c.snapshot().settings.alignment,true);
 }finally{c.close();rmSync(dir,{recursive:true,force:true});}
});

test('operating-app records: per-well previews are derived from capture.wells, never replaced by demo names',()=>{
 const dir=mkdtempSync(join(tmpdir(),'colony-test-'));
 try{
  const capture={id:'m1',mosaic:true,wells:[1,2,3,5,6].map(well=>({well,preview:`0000000${well}-aaaa-bbbb-cccc-dddddddddddd-preview.jpg`,image:`x${well}.png`}))};
  const db={version:1,plates:[{id:'PL-1',deviceId:1,slot:3,registeredAt:1,removedAt:null,paused:false,runs:[{n:1,at:1,imageState:'held',image:'mosaic-1.png',transferred:true,capture}]}],routine:{cycleHours:12,days:42,delay:0},autoRun:false,logs:[],io:[],receipts:[],devices:[]};
  writeFileSync(join(dir,'state.json'),JSON.stringify(db));
  const c=new Controller({dataDir:dir,adapter:new VirtualDeviceAdapter({stageMs:10}),autoTick:false,profile});
  try{
   const r=c.snapshot().plates[0].runs[0];
   assert.equal(r.image,'mosaic-1.png');assert.equal(r.images.length,6);assert.equal(r.images[3],null);assert.match(r.images[0],/^\/api\/v1\/hardware\/files\/.*-preview\.jpg$/);
   assert.equal(imagesOf(null),null);
  }finally{c.close();}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('layout from the profile sizes the tray and demo seeding',()=>{
 const dir=mkdtempSync(join(tmpdir(),'colony-test-'));
 const c=new Controller({dataDir:dir,adapter:new VirtualDeviceAdapter({stageMs:10}),autoTick:false,profile:{...profile,layout:{tiers:8,columns:1},features:{demoPlates:true}}});
 try{assert.equal(c.snapshot().profile.layout.slots,8);assert.equal(c.snapshot().plates.length,8);assert.equal(c.snapshot().autoRun,true);}
 finally{c.close();rmSync(dir,{recursive:true,force:true});}
});

test('alarms: environment rule, ack, history, early positive, admin-only incubation limit',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'colony-test-'));const c=new Controller({dataDir:dir,adapter:new VirtualDeviceAdapter({stageMs:10}),autoTick:false,profile});
 const at=n=>c.evaluateAlarms(n);
 try{
  assert.deepEqual(c.snapshot().settings.alarms,{tempTolerance:1,tempMinutes:5,humidityMin:60,humidityMax:95,humidityMinutes:10});
  // analyst may change cycle/delay but not the incubation limit
  await c.execute(request(200,'routine',0,{cycleHours:6,days:42,delay:0}));
  await rejects(c.execute(request(201,'routine',0,{cycleHours:6,days:30,delay:0})),'FORBIDDEN');
  await rejects(c.execute(request(202,'alarmSettings',0,{tempMinutes:0})),'FORBIDDEN');
  await c.execute(request(203,'role.login',0,{pin:'0000'}));
  await c.execute(request(204,'routine',0,{cycleHours:6,days:30,delay:0}));assert.equal(c.snapshot().routine.days,30);
  await c.execute(request(205,'alarmSettings',0,{tempMinutes:0,humidityMinutes:0}));
  await rejects(c.execute(request(206,'environment',0,{temperature:99})),'INVALID_ENV');await rejects(c.execute(request(218,'alarmSettings',0,{humidityMin:80,humidityMax:70})),'INVALID_VALUE');
  await c.execute(request(207,'environment',0,{temperature:36}));assert.equal(c.snapshot().devices[0].targetTemperature,36);
  // temperature out of range for 0 minutes -> env alarm; back in range -> cleared and kept in history
  const now=Date.now();at(now);assert.equal(c.snapshot().alarms.filter(a=>!a.clearedAt).length,0);
  await c.execute(request(208,'sim.input',1,{temperature:40}));at(now+1000);
  let env=c.snapshot().alarms.find(a=>a.kind==='env'&&!a.clearedAt);assert.ok(env);assert.match(env.what,/온도 이상/);
  assert.equal((await c.execute(request(209,'alarm.ack',0,{id:env.id}))).count,1);assert.ok(c.snapshot().alarms.find(a=>a.id===env.id).ackAt);
  await c.execute(request(210,'sim.input',1,{temperature:36}));at(now+2000);
  env=c.snapshot().alarms.find(a=>a.id===env.id);assert.ok(env.clearedAt,'cleared when back in range');
  // early positive from the PC -> done alarm with reason positive; register a plate first
  const reg=await c.execute(request(211,'register',1,{slot:3}));await c.execute(request(212,'registerDone',0));
  await rejects(c.execute(request(213,'plateResult',1,{plateId:reg.plateId,result:'maybe'})),'INVALID_VALUE');
  await c.execute(request(214,'plateResult',1,{plateId:reg.plateId,result:'positive'}));
  const done=c.snapshot().alarms.find(a=>a.kind==='done'&&!a.clearedAt);assert.equal(done.reason,'positive');assert.equal(done.plateId,reg.plateId);
  // device fault alarm appears and clears with the fault
  await c.execute(request(215,'sim.input',1,{fault:'Z_LIMIT'}));at(now+3000);assert.ok(c.snapshot().alarms.find(a=>a.kind==='device'&&!a.clearedAt));
  await c.execute(request(216,'sim.input',1,{fault:null}));await c.execute(request(217,'clearError',1));at(now+4000);assert.ok(!c.snapshot().alarms.find(a=>a.kind==='device'&&!a.clearedAt));
  // environment history sampling
  c.lastEnvSample=0;c.sampleEnvironment(now+5000);assert.equal(c.snapshot().envHistory.length,1);assert.equal(c.snapshot().envHistory[0].t,36);
 }finally{c.close();rmSync(dir,{recursive:true,force:true});}
});

test('tierShared layout: the three cells of a tier are one plate',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'colony-test-'));const c=new Controller({dataDir:dir,adapter:new VirtualDeviceAdapter({stageMs:10}),autoTick:false,profile:{...profile,layout:{tiers:8,columns:3,tierShared:true}}});
 try{
  assert.equal(c.snapshot().profile.layout.capacity,8);assert.equal(c.snapshot().profile.layout.slots,24);
  await c.execute(request(300,'register',1,{slot:17}));	// tier 3, column 2
  await rejects(c.execute(request(301,'register',1,{slot:16})),'SLOT_OCCUPIED');	// same tier
  await rejects(c.execute(request(302,'register',1,{slot:18})),'SLOT_OCCUPIED');
  await c.execute(request(303,'register',1,{slot:19}));	// tier 2 is free
  assert.equal(c.snapshot().plates.length,2);
 }finally{c.close();rmSync(dir,{recursive:true,force:true});}
});
