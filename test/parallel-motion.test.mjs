import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {McbMotion} from '../server/mcb-motion.mjs';
import {RealCameraAdapter} from '../server/real-camera-adapter.mjs';
import {VirtualDeviceAdapter} from '../server/virtual-device.mjs';

const config={axes:{cameraX:1,trayX:2,cameraY:3,trayZ:4},tiers:8,wellColumns:3,wellRows:2,trayOut:450,captureZ:720};
const params={1:{USED:1,RANGE:-500,HDIR:1,HPARK:5},2:{USED:1,RANGE:460,HDIR:-1,HPARK:5},3:{USED:1,RANGE:300,HDIR:-1,HPARK:5},4:{USED:1,RANGE:2800,HDIR:-1,HPARK:5}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('load overlaps first-well XY with Z and preserves tray extraction order',()=>{
 const motion=new McbMotion({config});motion.machine=params;
 assert.deepEqual(motion.loadSteps(18),['ENSURE_HOMED',{parallel:['MOVE 4 1925','MOVE 1 -83','MOVE 3 75']},'MOVE 2 450','MOVE 4 720']);
 assert.deepEqual(motion.wellSteps(2),[{parallel:['MOVE 1 -250','MOVE 3 75']}]);
});

test('capture waits for the movement barrier and skips duplicate first-well positioning',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'parallel-camera-')),pending=[];
 class Camera extends EventEmitter{
  directory=dir;job={status:'idle'};calls=0;
  snapshot(){return {job:this.job};}
  capture(){this.calls++;this.job={id:'camera-'+this.calls,status:'running'};return this.snapshot();}
  settle(){this.job.status='completed';writeFileSync(join(dir,'abcd.png'),'frame');this.emit('settled',{job:this.job,last:{id:'abcd',nativeYuy2:true,sourceFormat:'YUYV',width:3840,height:3040,files:{image:'abcd.png',raw:'abcd.yuy2',preview:'abcd-preview.jpg'}}});}
  close(){}
 }
 const camera=new Camera(),motion=new McbMotion({config});motion.machine=params;motion.refresh=async()=>params;motion.stop=async()=>{};
 motion.run=steps=>new Promise(resolve=>pending.push({steps,resolve}));
 const adapter=new RealCameraAdapter({base:new VirtualDeviceAdapter({stageMs:100}),camera,dataDir:dir,stageMs:100,motion});
 try{
  await adapter.command(1,'capture',{slot:18,plateId:'DEMO-1-18'},'parallel-capture-test');
  adapter.tick(1000);assert.equal(camera.calls,0);assert.equal(adapter.get(1).job.step,0);
  pending[0].resolve({motors:{},seconds:1});await flush();
  adapter.tick(100);await flush();assert.equal(camera.calls,1);assert.equal(pending.length,1,'first XY position was already prepared during Z');
  camera.settle();await flush();assert.equal(camera.calls,1);assert.deepEqual(pending[1].steps,motion.wellSteps(2));
  pending[1].resolve({motors:{},seconds:.2});await flush();assert.equal(camera.calls,2,'the next frame must wait for both XY axes');
 }finally{adapter.close();rmSync(dir,{recursive:true,force:true});}
});
