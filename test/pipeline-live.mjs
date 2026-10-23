// Explicit hardware diagnostic: six real frames and motor moves, temporary outputs,
// no production history. Run only with the application idle and stopped.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CameraService} from '../server/camera-service.mjs';
import {McbMotion,loadMcbConfig} from '../server/mcb-motion.mjs';
import {RealCameraAdapter} from '../server/real-camera-adapter.mjs';
import {VirtualDeviceAdapter} from '../server/virtual-device.mjs';
const config=loadMcbConfig(process.argv[2]);
const dir=mkdtempSync(join(tmpdir(),'colony-pipeline-live-'));
process.env.COLONY_RECEIVE_DIR=dir;
const camera=new CameraService({directory:dir}),motion=new McbMotion({config});
const adapter=new RealCameraAdapter({base:new VirtualDeviceAdapter(),camera,motion,dataDir:dir});
let timer;const events=[];
adapter.on('event',e=>{if(e.type==='job.stage')events.push({event:'stage',step:e.step,at:Date.now()});});
camera.on('acquired',e=>{const row={event:'acquired',id:e.id,at:Date.now(),sequence:e.meta.sequence,captureSeconds:e.meta.captureSeconds,frameMonotonic:e.meta.frameMonotonic,requestedMonotonic:e.meta.requestedMonotonic};events.push(row);console.log(JSON.stringify(row));});
const original=motion.run.bind(motion);
motion.run=async(...args)=>{const start=Date.now(),result=await original(...args);events.push({event:'motion',steps:args[0],start,at:Date.now()});return result;};
try{
 await motion.refresh();const initial=await motion.run(['STATUS']);
 for(const axis of Object.keys(config.axes)){const motor=initial.motors[config.axes[axis]];assert.ok(motor.HOMED&&!motor.MOV&&!motor.FLT);assert.equal(motor.POS,motion.parkOf(axis));}
 const started=Date.now();
 await adapter.command(1,'capture',{slot:18,plateId:'diagnostic-only'});
 timer=setInterval(()=>adapter.tick(100),100);
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(Error('live test timeout')),180000);
  const onEvent=e=>{if(e.type==='job.failed'){clearTimeout(timeout);adapter.off('event',onEvent);reject(Error(JSON.stringify(e.job)));}if(e.type==='job.completed'){clearTimeout(timeout);adapter.off('event',onEvent);resolve();}};
  adapter.on('event',onEvent);
 });
 clearInterval(timer);
 const job=adapter.get(1).job;assert.equal(job.wells.length,6);
 const metas=job.wells.map(w=>JSON.parse(readFileSync(join(dir,w.id+'.json'))));
 assert.ok(metas.every(m=>m.nativeYuy2&&m.continuousStream&&m.rawBytes===3840*3040*2&&m.frameMonotonic+0.000002>=m.eligibleMonotonic&&m.processingPid!==m.acquisitionPid));
 for(const m of metas){
  const raw=readFileSync(join(dir,m.files.raw));assert.equal(raw.length,3840*3040*2);assert.equal(createHash('sha256').update(raw).digest('hex'),m.rawSha256);
  const info=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=width,height','-of','json',join(dir,m.files.image)]));
  assert.equal(info.streams[0].width,3840);assert.equal(info.streams[0].height,3040);
 }
 assert.equal(job.equipmentStatus,'completed');assert.equal(job.processingStatus,'completed');
 // Return and conversion run concurrently; either may finish first.
 const acquisition=events.filter(e=>e.event==='acquired');
 assert.ok(acquisition.every((e,i)=>!i||e.sequence>acquisition[i-1].sequence));
 const final=await motion.run(['STATUS']);
 for(const [id,motor] of Object.entries(initial.motors)){assert.equal(final.motors[id].POS,motor.POS);assert.ok(!final.motors[id].MOV&&!final.motors[id].FLT);}
 const lastAcquired=acquisition.at(-1).at,returnStart=events.find(e=>e.event==='motion'&&JSON.stringify(e.steps[0])===JSON.stringify(motion.returnSteps(18)[0])&&e.start>=lastAcquired)?.start;
 assert.ok(returnStart-lastAcquired<100,'return must start immediately after acquisition');
 console.log(JSON.stringify({ok:true,totalSeconds:(job.finishedAt-started)/1000,acquisitionSeconds:(job.acquisitionFinishedAt-started)/1000,equipmentSeconds:(job.equipmentFinishedAt-started)/1000,processingSeconds:(job.processingFinishedAt-started)/1000,returnDelayMs:returnStart-lastAcquired,wells:metas.map(m=>({id:m.id,captureSeconds:m.captureSeconds,totalSeconds:m.totalSeconds,sequence:m.sequence,frameMonotonic:m.frameMonotonic,requestedMonotonic:m.requestedMonotonic,eligibleMonotonic:m.eligibleMonotonic,buffered:m.buffered,flags:m.flags,processingPid:m.processingPid,acquisitionPid:m.acquisitionPid,processingStartedAt:m.processingStartedAt,processedAt:m.processedAt})),events,finalMotors:final.motors}));
}finally{
 clearInterval(timer);camera.dispose();adapter.close();
 if(camera.child)await new Promise(r=>camera.child.once('close',r));
 rmSync(dir,{recursive:true,force:true});
}
