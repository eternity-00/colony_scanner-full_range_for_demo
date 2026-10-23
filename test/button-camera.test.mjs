import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// this scenario keeps a second, purely virtual scanner next to the real one
process.env.SCANNER_COUNT=process.env.SCANNER_COUNT||'2';
const {VirtualDeviceAdapter}=await import('../server/virtual-device.mjs');
const {RealCameraAdapter}=await import('../server/real-camera-adapter.mjs');
const {Controller}=await import('../server/controller.mjs');
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'scanner1-'));
 class Camera extends EventEmitter{
  directory=dir;job={status:'idle'};calls=0;
  snapshot(){return {job:this.job};}
  capture(format){assert.equal(format,'YUYV');this.calls++;this.job={id:`capture-${this.calls}`,status:'running'};return this.snapshot();}
  settle(ok=true){this.job.status=ok?'completed':'failed';this.job.error=ok?null:'USB failed';writeFileSync(join(dir,'abcd.png'),'frame');this.emit('settled',{job:this.job,last:{id:'abcd',nativeYuy2:true,sourceFormat:'YUYV',width:3840,height:3040,files:{image:'abcd.png',raw:'abcd.yuy2'}}});}
  close(){this.settle(false);}
 }
 const camera=new Camera(),base=new VirtualDeviceAdapter({stageMs:100}),adapter=new RealCameraAdapter({base,camera,dataDir:dir,stageMs:100}),controller=new Controller({features:{demoPlates:true},dataDir:dir,adapter,autoTick:false});
 const capture=id=>controller.execute({requestId:`request-${id}-${camera.calls}`,command:'capture',deviceId:id,args:{plateId:`DEMO-${id}-01`}});
 return {camera,base,adapter,controller,capture,close(){controller.close();rmSync(dir,{recursive:true,force:true});}};
}
test('scanner 1 preserves six stages, waits for actual frame, other scanners remain virtual',async()=>{
 const x=setup();try{
  await x.capture(1);assert.equal(x.camera.calls,0);assert.equal(x.adapter.get(1).job.step,0);
  x.adapter.tick(100);assert.equal(x.adapter.get(1).job.step,1);
  x.adapter.tick(100);assert.equal(x.camera.calls,1);assert.equal(x.adapter.get(1).job.step,2);
  await x.capture(2);x.adapter.tick(600);assert.equal(x.adapter.get(2).job.status,'completed');assert.equal(x.camera.calls,1);assert.equal(x.adapter.get(1).job.step,2);
  assert.equal(x.controller.snapshot().plates[0].runs.length,0);
  x.camera.settle();x.adapter.tick(1);assert.equal(x.adapter.get(1).job.step,3);
  x.adapter.tick(100);assert.equal(x.adapter.get(1).job.step,4);
  x.adapter.tick(100);assert.equal(x.adapter.get(1).job.step,5);
  x.adapter.tick(100);assert.equal(x.adapter.get(1).job.status,'completed');
  const run=x.controller.snapshot().plates[0].runs[0];assert.equal(run.image,'abcd.png');assert.equal(run.capture.width,3840);assert.equal(run.transferred,true);
 }finally{x.close();}
});
test('camera failure and stop do not produce successful sample images',async()=>{
 const x=setup();try{
  await x.capture(1);x.adapter.tick(200);x.camera.settle(false);
  assert.equal(x.adapter.get(1).job.status,'failed');assert.equal(x.controller.snapshot().plates[0].runs[0].image,null);
 }finally{x.close();}
 const y=setup();try{
  await y.capture(1);y.adapter.tick(200);await y.adapter.command(1,'stop',{},'stop-test');
  assert.equal(y.adapter.get(1).job.status,'failed');assert.equal(y.controller.snapshot().plates[0].runs.length,1);
 }finally{y.close();}
});
test('pause retains frame without advancing and resume completes the virtual sequence',async()=>{
 const x=setup();try{
  await x.capture(1);x.adapter.tick(200);await x.adapter.command(1,'pause');x.camera.settle();x.adapter.tick(1000);
  assert.equal(x.adapter.get(1).job.status,'paused');assert.equal(x.controller.snapshot().plates[0].runs.length,0);
  await x.adapter.command(1,'resume');x.adapter.tick(300);assert.equal(x.adapter.get(1).job.status,'completed');
 }finally{x.close();}
});
