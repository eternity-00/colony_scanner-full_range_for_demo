import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {McbMotion} from '../server/mcb-motion.mjs';
import {RealCameraAdapter} from '../server/real-camera-adapter.mjs';
import {VirtualDeviceAdapter} from '../server/virtual-device.mjs';
import {AlignmentStore} from '../server/alignment.mjs';
import {Controller} from '../server/controller.mjs';

const config={axes:{cameraX:1,trayX:2,cameraY:3,trayZ:4},tiers:8,wellColumns:3,wellRows:2,trayOut:450,captureZ:720,alignment:{backlashMarginFullSteps:0,tolerancePx:40}};
const params={1:{USED:1,RANGE:-500,HDIR:1,HPARK:5},2:{USED:1,RANGE:460,HDIR:-1,HPARK:5},3:{USED:1,RANGE:300,HDIR:-1,HPARK:5},4:{USED:1,RANGE:2800,HDIR:-1,HPARK:5}};
// 2 px per step on each camera axis, no backlash: a 200 px offset needs 100 steps
const calibration={frame:{width:3840,height:3040},ustep:{cameraX:1,cameraY:1},pixelsPerStep:{xx:2,xy:0,yx:0,yy:2},approach:{x:1,y:1},backlash:{x:0,y:0},ring:{radius:1950,polarity:-1}};
const flush=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};};
const centred={ok:true,offset:{x:3,y:-2},radius:1950,polarity:-1,support:5};

function setup({alignment=true,calibrated=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'alignment-app-')),moves=[],frames=[],aligns=[];
 class Camera extends EventEmitter{
  directory=dir;job={status:'idle'};hardware={connected:true};
  snapshot(){return {job:this.job};}
  async check(){return this.hardware;}
  async beginSession(){this.job={status:'running'};return {bufferCapacity:3,width:3840,height:3040};}
  captureFrame(readyMonotonic,fromAlign=null){const acquired=deferred(),completed=deferred(),id=String(frames.length+1).padStart(8,'0')+'-0000-0000-0000-000000000000';const f={id,fromAlign,acquired,completed};frames.push(f);return {id,acquired:acquired.promise,completed:completed.promise};}
  alignFrame(options,readyMonotonic){const a={id:'align-'+aligns.length,options,readyMonotonic,...deferred()};aligns.push(a);return {id:a.id,result:a.promise};}
  async endSession(){await Promise.all(frames.map(f=>f.completed.promise));this.job.status='completed';}
  close(){for(const f of frames){f.acquired.reject(Error('stopped'));f.completed.reject(Error('stopped'));}for(const a of aligns)a.reject(Error('stopped'));}
 }
 const camera=new Camera(),motion=new McbMotion({config});motion.machine=params;motion.refresh=async()=>params;motion.stop=async()=>{};motion.purge=async()=>({});
 motion.run=steps=>new Promise(resolve=>moves.push({steps,resolve}));
 const store=new AlignmentStore(join(dir,'camera-alignment.json'));if(calibrated)store.setCalibration(calibration);
 const adapter=new RealCameraAdapter({base:new VirtualDeviceAdapter({stageMs:100}),camera,motion,dataDir:dir,stageMs:100,alignment:store});
 adapter.configure({alignment});
 let mosaics=0;adapter.buildMosaic=()=>{mosaics++;const j=adapter.sim.get(1).job;j.processingWaiting=false;j.processingStatus='completed';};
 return {adapter,camera,motion,store,frames,moves,aligns,dir,get mosaics(){return mosaics;},close(){camera.close();adapter.close();rmSync(dir,{recursive:true,force:true});}};
}
async function start(x){await x.adapter.command(1,'capture',{slot:18,plateId:'p'});x.moves[0].resolve({seconds:1});await flush();x.adapter.tick(100);await flush();await flush();}

test('alignment off keeps the previous grid capture: one move and one exposure per well at the firmware speed',async()=>{
 const x=setup({alignment:false});try{
  await start(x);assert.deepEqual(x.moves[0].steps,x.motion.loadSteps(18));assert.equal(x.aligns.length,0);assert.equal(x.frames.length,1);assert.equal(x.frames[0].fromAlign,null);
  assert.deepEqual(x.moves[0].steps[1].parallel,['MOVE 4 1925','MOVE 1 -83','MOVE 3 75'],'no speed override');
  x.frames[0].acquired.resolve({});await flush();assert.deepEqual(x.moves[1].steps,x.motion.wellSteps(2));
 }finally{x.close();}
});

test('alignment on runs the camera axes at the alignment speed and restores the firmware speed afterwards',async()=>{
 const x=setup();try{
  await x.adapter.command(1,'capture',{slot:18,plateId:'p'});
  assert.deepEqual(x.moves[0].steps[1].parallel,['MOVE 4 1925','MOVE 1 -83 190','MOVE 3 75 190'],'camera axes slowed, Z untouched');
  await x.adapter.command(1,'stop');await flush();
  assert.equal(x.motion.speedOverride,null);assert.deepEqual(x.motion.wellSteps(2),[{parallel:['MOVE 1 -250','MOVE 3 75']}]);
 }finally{x.close();}
});

test('alignment on: the well is centred from the located rim, the centred frame is the capture, offsets are remembered',async()=>{
 const x=setup();try{
  await start(x);assert.equal(x.frames.length,0,'no exposure before the rim has been checked');
  assert.deepEqual(x.moves[0].steps,x.motion.loadSteps(18,{x:0,y:0},null),'nothing remembered yet, zero backlash: plain load');
  assert.equal(x.aligns.length,1);assert.equal(x.aligns[0].options.radius,1950);
  // well 1: rim 200 px right, 100 px up -> X -100 steps, Y +50 steps
  x.aligns[0].resolve({ok:true,offset:{x:200,y:-100},radius:1950,polarity:-1,support:5});await flush();await flush();
  assert.deepEqual(x.moves[1].steps,x.motion.xySteps({x:-183,y:125}));x.moves[1].resolve({});await flush();await flush();
  x.aligns[1].resolve(centred);await flush();await flush();
  assert.equal(x.frames.length,1);assert.equal(x.frames[0].fromAlign,x.aligns[1].id,'the frame judged centred is the capture');
  x.frames[0].acquired.resolve({onSchedule:true});await flush();await flush();
  // well 2 starts where the plate shift seen at well 1 puts it, not on the bare grid
  assert.deepEqual(x.moves[2].steps,x.motion.xySteps({x:-350,y:125}),'well 2 predicted from the shift of well 1');
  const job=()=>x.adapter.sim.get(1).job;
  assert.equal(job().alignment[1].aligned,true);assert.deepEqual(job().alignment[1].offset,{x:-100,y:50});assert.equal(job().alignment[1].predictedFrom,'grid');
  assert.deepEqual(x.store.offset(1),{x:-100,y:50});assert.deepEqual(job().plateModel.shift,{x:-100,y:50});
  x.moves[2].resolve({});await flush();await flush();
  // well 2 centred at once: pitch along the row matches the grid, so the model is a pure shift
  x.aligns[2].resolve(centred);await flush();await flush();assert.equal(x.frames[1].fromAlign,x.aligns[2].id);
  x.frames[1].acquired.resolve({onSchedule:true});await flush();await flush();
  assert.equal(job().alignment[2].predictedFrom,'plate-shift');assert.equal(job().plateModel.scale,1);assert.equal(job().plateModel.rotation,0);
  assert.deepEqual(x.moves[3].steps,x.motion.xySteps({x:-500,y:125}),'well 3 predicted from wells 1 and 2 (-517 clamped to the range end)');
  x.moves[3].resolve({});await flush();await flush();x.aligns[3].resolve(centred);await flush();await flush();
  assert.equal(job().alignment[3].predictedFrom,'plate-model');
 }finally{x.close();}
});

test('a correction that makes the offset much worse stops the well instead of wandering',async()=>{
 const x=setup();try{
  await start(x);x.aligns[0].resolve({ok:true,offset:{x:200,y:0},radius:1950,polarity:-1,support:5});await flush();await flush();
  x.moves[1].resolve({});await flush();await flush();
  x.aligns[1].resolve({ok:true,offset:{x:-900,y:300},radius:1950,polarity:-1,support:5});await flush();await flush();
  assert.equal(x.frames.length,1,'captured where it is');const info=x.adapter.get(1).job.alignment[1];assert.equal(info.error,'ALIGNMENT_DIVERGED');assert.equal(info.iterations,1);
 }finally{x.close();}
});

test('a well that cannot be located is captured where it is and flagged',async()=>{
 const x=setup();try{
  await start(x);x.aligns[0].resolve({ok:false,error:'WELL_NOT_FOUND'});await flush();await flush();
  assert.equal(x.frames.length,1);assert.equal(x.frames[0].fromAlign,x.aligns[0].id);
  const info=x.adapter.get(1).job.alignment[1];assert.equal(info.aligned,false);assert.equal(info.error,'WELL_NOT_FOUND');
  assert.deepEqual(x.store.offset(1),{x:0,y:0},'an unaligned position is not remembered');
 }finally{x.close();}
});

test('capture with alignment on is refused until the camera is calibrated',async()=>{
 const x=setup({calibrated:false});try{
  await assert.rejects(x.adapter.command(1,'capture',{slot:18,plateId:'p'}),e=>e.code==='ALIGNMENT_UNCALIBRATED');
  assert.equal(x.moves.length,0);
  await assert.rejects(x.adapter.command(1,'calibrate',{kind:'alignment'}),e=>e.code==='INVALID_SLOT');
  assert.equal(x.adapter.snapshot()[0].hardware.alignment.calibrated,false);
 }finally{x.close();}
});

test('alignment calibration probes both axes by image registration, centres the well, stores the result and returns the plate',async()=>{
 const x=setup({calibrated:false});try{
  await x.adapter.command(1,'calibrate',{kind:'alignment',slot:18});
  assert.equal(x.adapter.get(1).job.type,'calibrate');
  assert.deepEqual(x.moves[0].steps,x.motion.loadSteps(18,{x:0,y:0}));x.moves[0].resolve({});await flush();await flush();
  const ring={ok:true,radius:1900,polarity:-1,support:5},settled=[...x.motion.xySteps({x:-103,y:55}),...x.motion.xySteps({x:-83,y:75})];
  assert.deepEqual(x.moves[1].steps,settled);x.moves[1].resolve({});await flush();await flush();
  x.aligns[0].resolve({...ring,x:2100,y:1400,offset:{x:180,y:-120}});await flush();await flush();
  assert.deepEqual(x.moves[2].steps,x.motion.xySteps({x:-43,y:75}));x.moves[2].resolve({});await flush();await flush();
  assert.equal(x.aligns[1].options.detect,false);x.aligns[1].resolve({ok:false,error:'DETECTION_SKIPPED',shift:{x:100,y:4,strength:0.6}});await flush();await flush();
  assert.deepEqual(x.moves[3].steps,x.motion.xySteps({x:-83,y:75}));x.moves[3].resolve({});await flush();await flush();
  x.aligns[2].resolve({ok:false,error:'DETECTION_SKIPPED',shift:{x:4,y:0,strength:0.5}});await flush();await flush();
  assert.deepEqual(x.moves[4].steps,settled);x.moves[4].resolve({});await flush();await flush();
  x.aligns[3].resolve({...ring,x:2100,y:1400,offset:{x:180,y:-120}});await flush();await flush();
  assert.deepEqual(x.moves[5].steps,x.motion.xySteps({x:-83,y:115}));x.moves[5].resolve({});await flush();await flush();
  x.aligns[4].resolve({ok:false,error:'DETECTION_SKIPPED',shift:{x:0,y:120,strength:0.6}});await flush();await flush();
  assert.deepEqual(x.moves[6].steps,x.motion.xySteps({x:-83,y:75}));x.moves[6].resolve({});await flush();await flush();
  x.aligns[5].resolve({ok:false,error:'DETECTION_SKIPPED',shift:{x:0,y:6,strength:0.6}});await flush();await flush();
  // settle with the measured backlash (2 steps each), centre, diagnostic free look
  assert.deepEqual(x.moves[7].steps,[...x.motion.xySteps({x:-85,y:73}),...x.motion.xySteps({x:-83,y:75})]);x.moves[7].resolve({});await flush();await flush();
  x.aligns[6].resolve({...ring,x:2100,y:1400,offset:{x:180,y:-120}});await flush();await flush();
  assert.deepEqual(x.moves[8].steps,[...x.motion.xySteps({x:-157,y:117}),...x.motion.xySteps({x:-155,y:117})]);x.moves[8].resolve({});await flush();await flush();
  x.aligns[7].resolve(centred);await flush();await flush();
  x.aligns[8].resolve({ok:true,x:1923,y:1518,offset:{x:3,y:-2},radius:1960,polarity:1,support:6});await flush();await flush();
  assert.deepEqual(x.moves[9].steps,x.motion.returnSteps(18));x.moves[9].resolve({});await flush();await flush();
  x.adapter.tick(100);await flush();
  const j=x.adapter.get(1).job;assert.equal(j.status,'completed',j.error);
  const c=x.store.calibration;assert.deepEqual(c.pixelsPerStep,{xx:2.5,xy:0.1,yx:0,yy:3});assert.deepEqual(c.backlash,{x:2,y:2});assert.deepEqual(c.ring,{radius:1900,polarity:-1});
  assert.deepEqual(x.store.offset(1),{x:-72,y:42});assert.ok(x.adapter.snapshot()[0].hardware.alignment.calibrated);
 }finally{x.close();}
});

test('the alignment setting is persisted by the controller and handed to the adapter',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'alignment-settings-'));
 const settings=[],adapter=new VirtualDeviceAdapter({stageMs:10});adapter.configure=s=>settings.push({...s});
 let c=new Controller({features:{demoPlates:true},dataDir:dir,adapter,autoTick:false});
 try{
  assert.equal(c.snapshot().settings.alignment,false);assert.equal(settings.at(-1).alignment,false);
  await c.execute({requestId:'settings_request_1',command:'settings',deviceId:0,args:{alignment:true}});
  assert.equal(settings.at(-1).alignment,true);
  await assert.rejects(c.execute({requestId:'settings_request_2',command:'settings',deviceId:0,args:{alignment:'yes'}}),e=>e.code==='INVALID_VALUE');
  c.close();c=new Controller({features:{demoPlates:true},dataDir:dir,adapter:new VirtualDeviceAdapter({stageMs:10}),autoTick:false});
  assert.equal(c.snapshot().settings.alignment,true,'the setting survives a restart');
 }finally{c.close();rmSync(dir,{recursive:true,force:true});}
});

test('focus mode holds the first well under the camera, streams focus snapshots and returns on focusStop',async()=>{
 const x=setup({calibrated:false});try{
  await x.adapter.command(1,'calibrate',{kind:'focus',slot:18});
  const job=()=>x.adapter.sim.get(1).job;assert.equal(job().type,'calibrate');assert.equal(job().focus.stage,'loading');
  assert.deepEqual(x.moves[0].steps,x.motion.loadSteps(18,{x:0,y:0},null));x.moves[0].resolve({});await flush();await flush();
  assert.equal(job().focus.stage,'holding');assert.equal(x.aligns.length,1);assert.equal(x.aligns[0].options.snapshot,'focus');assert.equal(x.aligns[0].options.detect,false);
  x.aligns[0].resolve({ok:false,error:'DETECTION_SKIPPED',snapshot:{full:'focus-full.jpg',crop:'focus-crop.jpg',sharpness:123.4}});await flush();await flush();
  assert.equal(job().focus.sharpness,123.4);assert.equal(job().focus.frames,1);assert.equal(x.aligns.length,2,'keeps taking frames');
  await assert.rejects(x.adapter.command(1,'capture',{slot:18,plateId:'p'}),e=>e.code==='DEVICE_BUSY');
  await x.adapter.command(1,'focusStop');
  x.aligns[1].resolve({ok:false,error:'DETECTION_SKIPPED',snapshot:{full:'focus-full.jpg',crop:'focus-crop.jpg',sharpness:150}});await flush();await flush();
  assert.equal(job().focus.best,150);assert.equal(job().focus.stage,'returning');
  assert.deepEqual(x.moves[1].steps,x.motion.returnSteps(18));x.moves[1].resolve({});await flush();await flush();
  x.adapter.tick(100);await flush();assert.equal(job().status,'completed',job().error);assert.equal(x.motion.speedOverride,null);
  await assert.rejects(x.adapter.command(1,'focusStop'),e=>e.code==='NO_FOCUS_JOB');
 }finally{x.close();}
});
