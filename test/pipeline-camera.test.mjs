import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CameraService} from '../server/camera-service.mjs';
import {RealCameraAdapter} from '../server/real-camera-adapter.mjs';
import {VirtualDeviceAdapter} from '../server/virtual-device.mjs';
const flush=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};};
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'camera-pipeline-')),moves=[],frames=[];
 class Camera extends EventEmitter{
  directory=dir;job={status:'idle'};closed=0;ends=0;
  snapshot(){return {job:this.job};}
  async beginSession(){this.job={status:'running'};}
  captureFrame(){const acquired=deferred(),completed=deferred(),id=String(frames.length+1).padStart(8,'0')+'-0000-0000-0000-000000000000';const f={id,acquired,completed};frames.push(f);return {id,acquired:acquired.promise,completed:completed.promise};}
  async endSession(){this.ends++;await Promise.all(frames.map(f=>f.completed.promise));this.job.status='completed';}
  close(){this.closed++;for(const f of frames){f.acquired.reject(Error('stopped'));f.completed.reject(Error('stopped'));}}
 }
 const camera=new Camera(),motion={config:{wellColumns:3},wellOrder:()=>[1,2,3],wellPos:w=>({col:w-1,row:0,x:w,y:0}),wellSteps:w=>['MOVE '+w],loadSteps:()=>['LOAD'],returnSteps:()=>['RETURN'],tierOf:()=>1,refresh:async()=>{},stop:async()=>{},purge:async()=>{},run:steps=>new Promise(resolve=>moves.push({steps,resolve}))};
 const adapter=new RealCameraAdapter({base:new VirtualDeviceAdapter({stageMs:100}),camera,motion,dataDir:dir,stageMs:100});let mosaics=0;
 adapter.buildMosaic=()=>{mosaics++;const j=adapter.sim.get(1).job;j.processingWaiting=false;j.processingStatus='completed';};
 return {adapter,camera,frames,moves,dir,get mosaics(){return mosaics;},finish(i){const f=frames[i];f.completed.resolve({id:f.id,nativeYuy2:true,sourceFormat:'YUYV',continuousStream:true,width:3840,height:3040,files:{image:f.id+'.png',preview:f.id+'-preview.jpg',raw:f.id+'.yuy2'}});},close(){camera.close();adapter.close();rmSync(dir,{recursive:true,force:true});}};
}
async function start(x){await x.adapter.command(1,'capture',{slot:18});x.moves[0].resolve({seconds:1});await flush();x.adapter.tick(100);await flush();}
test('next XY moves after raw acquisition while PNG remains pending; mosaic waits for every conversion',async()=>{
 const x=setup();try{
  await start(x);assert.equal(x.frames.length,1);
  x.frames[0].acquired.resolve({});await flush();assert.deepEqual(x.moves[1].steps,['MOVE 2']);assert.equal(x.frames.length,1);
  x.moves[1].resolve({});await flush();assert.equal(x.frames.length,2,'frame 1 conversion is still pending');
  x.frames[1].acquired.resolve({});await flush();x.moves[2].resolve({});await flush();
  x.frames[2].acquired.resolve({});await flush();assert.equal(x.camera.ends,1);assert.equal(x.mosaics,0);
  assert.deepEqual(x.moves[3].steps,['RETURN']);assert.equal(x.adapter.get(1).job.step,3,'equipment return must start before conversion completes');
  x.moves[3].resolve({});await flush();x.adapter.tick(1000);assert.equal(x.adapter.get(1).job.step,5);assert.equal(x.adapter.get(1).job.status,'running','processing must hold final success');assert.equal(x.adapter.get(1).job.equipmentStatus,'completed');
  x.finish(2);x.finish(0);await flush();assert.equal(x.mosaics,0,'missing well 2 must hold completion');
  x.finish(1);await flush();assert.equal(x.mosaics,1);assert.deepEqual(x.adapter.get(1).job.wells.map(w=>w.well),[1,2,3]);
 }finally{x.close();}
});
test('conversion failure stops capture and suppresses mosaic and plate success',async()=>{
 const x=setup();try{
  await start(x);x.frames[0].acquired.resolve({});await flush();x.moves[1].resolve({});await flush();
  x.camera.emit('session-failed',Error('PNG conversion failed'));await flush();
  assert.equal(x.adapter.get(1).job.status,'failed');assert.equal(x.mosaics,0);assert.ok(x.camera.closed);
 }finally{x.close();}
});
test('processing failure after the last frame lets the equipment finish its return before failing the run',async()=>{
 const x=setup();try{
  await start(x);x.frames[0].acquired.resolve({});await flush();x.moves[1].resolve({});await flush();
  x.frames[1].acquired.resolve({});await flush();x.moves[2].resolve({});await flush();
  x.frames[2].acquired.resolve({});await flush();
  x.camera.emit('session-failed',Error('processing failed during return'));await flush();
  assert.equal(x.adapter.get(1).job.status,'running');assert.equal(x.adapter.get(1).job.equipmentStatus,'returning');
  x.moves[3].resolve({});await flush();assert.equal(x.adapter.get(1).job.status,'failed');assert.equal(x.mosaics,0);
 }finally{x.close();}
});
test('pause prevents the next capture request and stop cancels outstanding frames',async()=>{
 const x=setup();try{
  await start(x);await x.adapter.command(1,'pause');x.frames[0].acquired.resolve({});await flush();
  assert.equal(x.moves.length,1);await x.adapter.command(1,'stop');await new Promise(r=>setTimeout(r,120));
  assert.equal(x.adapter.get(1).job.status,'failed');assert.equal(x.frames.length,1);assert.equal(x.mosaics,0);
 }finally{x.close();}
});
test('session JSONL separates raw acquisition from conversion and rejects process failure',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'session-protocol-')),runner=join(dir,'session.py');
 writeFileSync(runner,`import sys,json,time
print(json.dumps({'event':'ready'}),flush=True)
for line in sys.stdin:
 r=json.loads(line)
 if r['command']=='end':
  print(json.dumps({'event':'acquisition-ended'}),flush=True)
  print(json.dumps({'event':'closed'}),flush=True);break
 print(json.dumps({'event':'acquired','id':r['id'],'meta':{'nativeYuy2':True}}),flush=True)
 time.sleep(.15)
 print(json.dumps({'event':'processed','id':r['id'],'result':{'id':r['id'],'ok':True}}),flush=True)
`);
 const previous=process.env.COLONY_CAPTURE_SESSION_SCRIPT;process.env.COLONY_CAPTURE_SESSION_SCRIPT=runner;
 const camera=new CameraService({directory:dir});
 try{
  await camera.beginSession();const frame=camera.captureFrame();let processed=false;frame.completed.then(()=>processed=true);
  await frame.acquired;assert.equal(processed,false);await camera.endSession();assert.equal((await frame.completed).id,frame.id);assert.equal(camera.job.status,'completed');
  writeFileSync(runner,`import sys,json\nprint(json.dumps({'event':'ready'}),flush=True)\nfor line in sys.stdin:\n print(json.dumps({'event':'failed','error':'USB disconnected'}),flush=True);sys.exit(1)\n`);
  await camera.beginSession();const bad=camera.captureFrame();await assert.rejects(bad.acquired,/USB disconnected/);await assert.rejects(bad.completed,/USB disconnected/);
  if(camera.child)await new Promise(r=>camera.child.once('close',r));assert.equal(camera.job.status,'failed');
  writeFileSync(runner,`import sys,json,signal,time\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nprint(json.dumps({'event':'ready'}),flush=True)\nfor line in sys.stdin:\n time.sleep(100)\n`);
  await camera.beginSession();const blocked=camera.captureFrame(),started=Date.now();camera.close();
  await assert.rejects(blocked.acquired,/중단/);await assert.rejects(blocked.completed,/중단/);
  if(camera.child)await new Promise(r=>camera.child.once('close',r));assert.ok(Date.now()-started<4500,'unresponsive stream must be killed within bounded time');

 }finally{camera.dispose();if(previous===undefined)delete process.env.COLONY_CAPTURE_SESSION_SCRIPT;else process.env.COLONY_CAPTURE_SESSION_SCRIPT=previous;rmSync(dir,{recursive:true,force:true});}
});
