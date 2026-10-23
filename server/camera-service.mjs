import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const states=Object.freeze({IDLE:'idle',RUNNING:'running',COMPLETED:'completed',FAILED:'failed'});
export class CameraService extends EventEmitter {
 constructor({directory=process.env.COLONY_RECEIVE_DIR||join(homedir(),'Pictures','colony-pi'),runner=process.env.COLONY_CAPTURE_SCRIPT||fileURLToPath(new URL('../device/capture-local.py',import.meta.url))}={}){
  super();this.directory=directory;this.runner=runner;this.job={status:states.IDLE};this.child=null;this.last=null;
  try{this.last=JSON.parse(readFileSync(join(directory,'latest.json'),'utf8'));}catch{}
  this.hardware={connected:false,checkedAt:null,error:'카메라 확인 중'};
  this.check();this.probeTimer=setInterval(()=>this.check(),10000);this.probeTimer.unref();
 }
 async beginSession(frameCount=6){
  if(!Number.isInteger(frameCount)||frameCount<1||frameCount>96)throw new Error('INVALID_FRAME_COUNT');
  if(this.child)throw new Error('CAMERA_BUSY');
  this.job={id:randomUUID(),status:states.RUNNING,stage:'capturing',format:'YUYV',startedAt:Date.now(),error:null};
  const session={frames:new Map(),aligns:new Map(),closed:false,ending:false};this.session=session;
  const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});promise.catch(()=>{});return {promise,resolve,reject};};
  session.deferred=deferred;session.ready=deferred();session.acquisitionEnded=deferred();session.done=deferred();
  const child=spawn(process.env.COLONY_PYTHON||'python3',[process.env.COLONY_CAPTURE_SESSION_SCRIPT||fileURLToPath(new URL('../device/capture-session.py',import.meta.url))],{env:{...process.env,COLONY_RECEIVE_DIR:this.directory,COLONY_CAPTURE_COUNT:String(frameCount)},stdio:['pipe','pipe','pipe'],detached:true});
  this.child=child;session.child=child;
  let buffer='',error='';
  const fail=message=>{
   if(session.failure)return;
   session.failure=new Error(message);session.ready.reject(session.failure);session.acquisitionEnded.reject(session.failure);session.done.reject(session.failure);
   for(const frame of session.frames.values()){clearTimeout(frame.releaseTimer);frame.released.reject(session.failure);frame.acquired.reject(session.failure);frame.completed.reject(session.failure);}
   for(const align of session.aligns.values())align.reject(session.failure);
   this.terminate(child);this.emit('session-failed',session.failure);
  };
  session.fail=fail;
  const timeout=setTimeout(()=>fail('촬영 루틴 제한 시간을 초과했습니다.'),420000);
  child.stderr.on('data',b=>error=(error+b).slice(-3000));
  child.stdin.on('error',e=>fail(e.message));child.on('error',e=>fail(e.message));
  child.stdout.on('data',b=>{
   buffer+=b;if(buffer.length>1000000){fail('CAMERA_OUTPUT_TOO_LARGE');return;}
   for(let pos;(pos=buffer.indexOf('\n'))>=0;){
    const line=buffer.slice(0,pos);buffer=buffer.slice(pos+1);
    try{
     const event=JSON.parse(line),frame=session.frames.get(event.id);
     if(event.event==='ready')session.ready.resolve(event);
     else if(event.event==='scheduled'&&frame){
      // The axis may move once the frame's exposure is over (releaseMonotonic), long before
      // the frame has crossed USB; 0 = no prediction, release with the frame itself.
      const wait=event.releaseMonotonic>0?(event.releaseMonotonic-Number(process.hrtime.bigint())/1e9)*1000:null;
      if(wait!==null){frame.release=event;frame.releaseTimer=setTimeout(()=>frame.released.resolve(event),Math.max(0,wait));}
     }
     else if(event.event==='acquired'&&frame){clearTimeout(frame.releaseTimer);frame.released.resolve(frame.release||event.meta);frame.acquired.resolve(event.meta);this.emit('acquired',{id:event.id,meta:event.meta});}
     else if(event.event==='processed'&&frame){this.last=event.result;frame.completed.resolve(event.result);this.emit('change');}
     else if(event.event==='aligned'&&session.aligns.has(event.id)){const align=session.aligns.get(event.id);session.aligns.delete(event.id);align.resolve(event);}
     else if(event.event==='scheduled'&&session.aligns.has(event.id)){}
     else if(event.event==='acquisition-ended'){session.acquisitionStopped=true;session.acquisitionEnded.resolve(event);this.job.stage='processing';this.emit('change');}
     else if(event.event==='closed')session.closed=true;
     else if(event.event==='failed')fail(event.error||'촬영 처리 실패');
     else throw new Error('INVALID_SESSION_EVENT');
    }catch(e){fail(e.message);}
   }
  });
  child.on('close',code=>{
   clearTimeout(timeout);
   if(code!==0||!session.closed||!session.acquisitionStopped||session.failure)fail(session.failure?.message||error||'카메라 스트림 종료 오류');
   if(this.child===child)this.child=null;
   this.job={...this.job,status:session.failure?states.FAILED:states.COMPLETED,stage:session.failure?'failed':'completed',error:session.failure?.message||null,finishedAt:Date.now()};
   if(!session.failure)session.done.resolve();
   this.emit('change');
  });
  return await session.ready.promise;
 }
 captureFrame(readyMonotonic=Number(process.hrtime.bigint())/1e9,fromAlign=null){
  const session=this.session;
  if(!session||session.failure||session.ending||this.child!==session.child)throw session?.failure||new Error('CAMERA_SESSION_UNAVAILABLE');
  const id=randomUUID(),frame={released:session.deferred(),acquired:session.deferred(),completed:session.deferred()};session.frames.set(id,frame);
  session.child.stdin.write(JSON.stringify({command:'capture',id,readyMonotonic,...(fromAlign?{fromAlign}:{})})+'\n');
  return {id,released:frame.released.promise,acquired:frame.acquired.promise,completed:frame.completed.promise};
 }
 // Locate the well in a fresh frame (exposed after readyMonotonic) without saving a capture.
 // Resolves with the session's "aligned" event ({ok, offset, radius, ...} or {ok:false, error});
 // `reference` (an earlier alignment frame id) adds shift {x,y,strength}, the whole-image translation.
 alignFrame({radius=null,polarity=null,expected=null,maxOffset=null,overlayDir=null,reference=null,detect=true,minShift=0,snapshot=null}={},readyMonotonic=Number(process.hrtime.bigint())/1e9){
  const session=this.session;
  if(!session||session.failure||session.ending||this.child!==session.child)throw session?.failure||new Error('CAMERA_SESSION_UNAVAILABLE');
  const id=randomUUID(),align=session.deferred();session.aligns.set(id,align);
  const overlay=overlayDir?join(overlayDir,`${id}-align.jpg`):null;
  session.child.stdin.write(JSON.stringify({command:'align',id,readyMonotonic,radius,polarity,expected,maxOffset,overlay,reference,detect,minShift,snapshot})+'\n');
  return {id,result:align.promise};
 }
 async endSession(){
  const session=this.session;if(!session)throw new Error('CAMERA_SESSION_UNAVAILABLE');
  if(session.failure)throw session.failure;
  session.ending=true;this.job.stage='finishing-acquisition';
  session.child.stdin.end(JSON.stringify({command:'end'})+'\n');
  await session.done.promise;
 }
 snapshot(){return {job:this.job,last:this.last,hardware:this.hardware};}
 check(){
  if(this.child||this.probing)return Promise.resolve(this.hardware);
  this.probing=true;
  return new Promise(resolve=>{
   const probe=spawn(process.env.COLONY_PYTHON||'python3',[fileURLToPath(new URL('../device/local_agent.py',import.meta.url))],{stdio:['pipe','pipe','pipe']});
   let output='',error='',finished=false;
   const timer=setTimeout(()=>probe.kill('SIGTERM'),12000);
   const done=(problem,result)=>{if(finished)return;finished=true;clearTimeout(timer);this.probing=false;this.hardware={connected:!problem,checkedAt:Date.now(),error:problem,device:result?.device};this.emit('change');resolve(this.hardware);};
   probe.stdout.on('data',b=>output+=b);probe.stderr.on('data',b=>error=(error+b).slice(-2000));
   probe.on('error',e=>done(e.message));
   probe.on('close',code=>{try{const r=JSON.parse(output);done(code===0&&r.ok?null:r.error?.message||error||'카메라를 확인할 수 없습니다.',r.result);}catch{done(error||'카메라 응답 없음');}});
   probe.stdin.on('error',()=>{});probe.stdin.end(JSON.stringify({command:'status'}));
  });
 }
 capture(format){
  if(!['MJPG','YUYV'].includes(format))throw Object.assign(new Error('촬영 형식을 확인하세요.'),{status:400});
  if(this.child)throw Object.assign(new Error('촬영·전송이 진행 중입니다.'),{status:409});
  this.job={id:randomUUID(),status:states.RUNNING,stage:'capturing',format,startedAt:Date.now(),error:null};
  let output='',error='';
  const child=spawn(process.env.COLONY_PYTHON||'python3',[this.runner,'--format',format],{env:{...process.env,COLONY_RECEIVE_DIR:this.directory},stdio:['ignore','pipe','pipe'],detached:true});
  this.child=child;
  let timedOut=false;
  const timeout=setTimeout(()=>{timedOut=true;this.terminate(child);},420000);
  child.stdout.on('data',data=>{output+=data;if(output.length>1000000)this.terminate(child);});
  child.stderr.on('data',data=>{error=(error+data).slice(-10000);for(const line of error.split('\n')){try{const event=JSON.parse(line);if(event.stage)this.job.stage=event.stage;}catch{}}});
  child.on('error',e=>{this.job={...this.job,status:states.FAILED,error:e.message,finishedAt:Date.now()};});
  child.on('close',code=>{
   clearTimeout(timeout);this.child=null;
   try{
    const result=JSON.parse(output);
    if(code!==0||!result.ok)throw new Error(result.error||'촬영 처리 실패');
    this.last=result;this.job={...this.job,status:states.COMPLETED,stage:'completed',finishedAt:Date.now(),error:null};
   }catch(e){this.job={...this.job,status:states.FAILED,error:timedOut?'촬영 처리 제한 시간을 초과했습니다.':this.job.error||e.message,finishedAt:Date.now()};}
   this.emit('settled',this.snapshot());
   console.log(JSON.stringify({cameraJob:this.job.id,status:this.job.status,error:this.job.error,image:this.last?.id}));
  });
  return this.snapshot();
 }
 terminate(child){
  if(!child?.pid)return;try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}
  const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null){try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}}},3000);
  timer.unref();child.once('close',()=>clearTimeout(timer));
 }
 close(){if(this.session&&this.child===this.session.child)this.session.fail('촬영이 중단되었습니다.');else this.terminate(this.child);}
 dispose(){clearInterval(this.probeTimer);this.close();}
}
