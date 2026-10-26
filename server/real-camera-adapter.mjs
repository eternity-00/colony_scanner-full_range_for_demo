import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {copyFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {join,basename} from 'node:path';
import {VirtualDeviceAdapter,DeviceError} from './virtual-device.mjs';
import {alignmentSettings,jacobian,correction,limitCorrection,backlashSteps} from './alignment.mjs';
import {decodeBarcodes} from './vision.mjs';
const now=()=>Number(process.hrtime.bigint())/1e9;
// Well 십자 촬영 (routine.wellShots = 5): the centred frame plus four frames with the camera moved
// by crossOffsets() along each axis. Labels name the camera-axis direction, not the image side.
export const CROSS=[{shot:'C',x:0,y:0},{shot:'X+',x:1,y:0},{shot:'Y-',x:0,y:-1},{shot:'X-',x:-1,y:0},{shot:'Y+',x:0,y:1}];

// Scanner 1 keeps the virtual six-stage sequence; frame acquisition is real and, with
// `motion` (McbMotion), so are 이송 (stage 0), 수납 복귀 (stage 3) and 원점 복귀.
// With motion the 촬영 stage takes one frame per well (camera X x Y grid) and shows a mosaic.
// spare frames a plate may use to take a well again (see capturePlate)
const RETAKES=3;
export class RealCameraAdapter extends EventEmitter {
 constructor({base,camera,dataDir,stageMs=1600,motion=null,alignment=null}){
  super();Object.assign(this,{base,camera,dataDir,motion,alignment});
  // Well-centre alignment (server/alignment.mjs): the recipe may tune it, the user setting switches it on.
  this.align={...alignmentSettings(motion?.config||{}),enabled:true};this.options={alignment:false};
  this.sim=new VirtualDeviceAdapter({stageMs});this.owned=false;
  this.forward=e=>{if(e.deviceId!==1||!this.owned)this.emit('event',e);};
  this.changed=()=>this.emit('change');this.finished=s=>this.finishCamera(s);
  this.sessionFailed=error=>{
   const d=this.sim.get(1),j=d.job;
   if(!j?.realCamera||!['running','paused'].includes(j.status))return;
   if(j.acquisitionDone&&!j.equipmentFinishedAt){j.processingError=error.message;this.emit('change');}
   else this.sim.fail(d,'CAMERA_ERROR',error.message);
  };
  camera.on('session-failed',this.sessionFailed);
  base.on('event',this.forward);base.on('change',this.changed);camera.on('settled',this.finished);camera.on('change',this.changed);
  this.sim.on('event',e=>{
   if(e.deviceId!==1)return;
   const d=this.sim.get(1),j=d.job;
   if(e.type==='job.stage'&&j.realCamera&&e.step===2){
    j.cameraWaiting=true;
    if(this.motion){j.wells=[];j.wellQueue=this.motion.wellOrder();if(this.camera.beginSession)this.capturePlate(d);else this.captureWell(d,j.wellQueue.shift());}
    else{
     try{j.cameraJobId=this.camera.capture('YUYV').job.id;}
     catch(error){this.sim.fail(d,'CAMERA_ERROR',error.message);return;}
    }
   }
   if(e.type==='job.stage'&&j.realCamera&&e.step===3&&this.motion)this.startMotion(d,this.motion.returnSteps(j.slot),4,180);
   if(e.type==='job.failed'&&(j.cameraWaiting||j.processingWaiting||j.realCamera))this.camera.close();
   if(e.type==='job.failed'&&this.mosaicChild){this.mosaicChild.kill('SIGTERM');}
   if(e.type==='job.failed'&&j.mosaicFile){const cleanup=()=>{try{unlinkSync(join(this.dataDir,'images',j.mosaicFile));}catch{}};if(this.mosaicChild)this.mosaicChild.once('close',cleanup);else cleanup();}
   if(e.type==='job.failed'&&(j.wells?.length||j.frameIds?.length)){
    const cleanup=()=>this.purgeCapture({wells:[...(j.wells||[]),...(j.frameIds||[]).map(id=>({id}))]});
    // Wait for conversion processes to exit before removing their published files.
    if(this.camera.child)this.camera.child.once('close',cleanup);else cleanup();
   }	// partial plate: drop its frames
   if(e.type==='job.failed'&&this.motion&&(j.motionWaiting||j.realCamera||j.realMotion))this.motion.stop();
   if(e.type==='job.failed'||e.type==='job.completed')this.slowCameraAxes(false);
   if(e.job){e.job={...j};if(e.type==='job.completed'){e.image=j.image;e.capture=j.capture;}}
   this.emit('event',e);this.emit('change');
   if(e.type==='job.completed'&&j.capture?.barcode?.pending)this.fullBarcodePass(j.capture);
  });
 }
 get engineConnected(){return this.base.engineConnected;}
 get devices(){return this.snapshot();}
 // Image scale from the calibrated rim ring and the recipe's well diameter (agar plane, approximate).
 imageScale(){
  const mm=this.motion?.config?.wellDiameterMm,r=this.alignment?.calibration?.ring?.radius;
  if(!mm||!r)return {umPerPx:null,wellDiameterMm:mm||null};
  return {umPerPx:Math.round(mm*1000/2/r*100)/100,wellDiameterMm:mm};
 }
 // user settings (controller state.json): {alignment: boolean}
 configure(settings={}){this.options={...this.options,...settings};}
 // Alignment needs repeatable short moves: the camera axes run at alignment.cameraSpeedHz
 // (full steps/s) during aligned captures and calibration, the firmware speed otherwise.
 slowCameraAxes(on){if(!this.motion)return;const hz=this.align.cameraSpeedHz;this.motion.speedOverride=on&&hz?{cameraX:hz,cameraY:hz}:null;}
 get alignmentActive(){return !!(this.motion&&this.alignment&&this.options.alignment&&this.camera.alignFrame);}
 snapshot(){return this.base.snapshot().map(d=>{
  if(d.id!==1)return d;
  const state=this.owned?{...d,...structuredClone(this.sim.get(1))}:d;
  if(this.camera.hardware){
   state.hardware={camera:this.camera.hardware,mcb:this.motion?{connected:!!this.motion.machine,checkedAt:this.motion.checkedAt}:null,mode:'local',
    alignment:this.alignment?{enabled:this.options.alignment,available:!!(this.motion&&this.camera.alignFrame),...this.alignment.status(),...this.imageScale()}:null};
   state.connected=state.connected&&this.camera.hardware.connected&&(!this.motion||!!this.motion.machine);
  }
  return state;
 });}
 get(id){const d=this.snapshot().find(d=>d.id===id);if(!d)throw new DeviceError('INVALID_DEVICE','스캐너 번호를 확인하세요.',400);return d;}
 sync(){const source=this.base.get(1),d=this.sim.get(1);for(const key of ['connected','pcConnected','doorOpen','temperature','humidity','targetTemperature'])d[key]=source[key];return d;}
 async command(id,type,args={},requestId){
  if(id!==1)return this.base.command(id,type,args,requestId);
  const current=this.get(1),busy=current.job&&['running','paused'].includes(current.job.status);
  if(type==='capture'){
   if(this.camera.check){const hardware=await this.camera.check();if(!hardware.connected)throw new DeviceError('CAMERA_OFFLINE',hardware.error||'USB 카메라 연결을 확인하세요.',503);}
   if(busy)throw new DeviceError('DEVICE_BUSY','스캐너가 작업 중입니다.');
   if(this.camera.snapshot().job.status==='running')throw new DeviceError('CAMERA_BUSY','카메라 촬영이 진행 중입니다.');
   if(this.motion?.refreshing)await this.motion.refreshing.catch(()=>{});	// the periodic link check holds the UART for a moment
   if(this.motion?.busy)throw new DeviceError('MOTION_BUSY','모터가 동작 중입니다.');
   await this.checkMcb();
   // alignment on: the camera must have been calibrated for this microstep setting.
   // A trial shot (plate registration) uses the calibration when there is one even with the
   // user setting off — its job is to report whether the six wells are found.
   const calibrated=this.motion&&this.alignment&&this.camera.alignFrame?this.alignment.validCalibration({ustep:this.ustep()}):null;
   if(this.alignmentActive&&!calibrated)throw new DeviceError('ALIGNMENT_UNCALIBRATED','카메라 정렬 보정값이 없거나 현재 마이크로스텝과 맞지 않습니다. 사용자 설정에서 카메라 정렬 보정을 먼저 실행하세요.');
   const useAlign=this.alignmentActive?!!calibrated:(!!args.trial&&!!calibrated),known=useAlign?calibrated:null;
   const shots=args.wellShots===5?CROSS.length:1;
   const d=this.sync();d.fault=current.fault;d.failCamera=false;this.owned=true;
   this.sim.command(1,type,args,requestId);d.job.realCamera=true;
   d.job.wellShots=shots;d.job.trial=!!args.trial;d.job.barcodeRequested=!!args.barcode;
   if(this.motion){
    if(this.camera.beginSession){
     const ready=this.camera.beginSession(this.motion.wellOrder().length*shots+RETAKES);ready.catch(()=>{});
     this.streamSession={jobId:d.job.id,ready};
    }
    const s=d.job.slot;d.job.plateGrid={tier:this.motion.tierOf(s),label:`${this.motion.tierOf(s)}단`};
    d.job.alignmentRequested=useAlign;this.slowCameraAxes(useAlign);
    // 물기 제거 has no hardware on this unit: go straight from 이송 to 촬영 (v 2026-10-16).
    this.startMotion(d,this.motion.loadSteps(s,this.startOffset(this.motion.wellOrder()[0]),this.approach(known)),2,300);
   }
   this.emit('change');return {};
  }
  // 초점 조정: 플레이트를 꺼내 첫 웰을 촬영 높이에 두고 유지하며 영상·선명도를 갱신 (focusStop으로 복귀)
  if(this.motion&&!busy&&type==='calibrate'&&args.kind==='focus'){
   if(!this.camera.alignFrame)throw new DeviceError('UNSUPPORTED_CALIBRATION','이 장비에서는 초점 조정 모드를 지원하지 않습니다.',501);
   if(!Number.isInteger(args.slot)||args.slot<1||args.slot>this.motion.layout.slots)throw new DeviceError('INVALID_SLOT',`플레이트 slot(1~${this.motion.layout.slots})을 지정하세요.`,400);
   if(this.camera.check){const hardware=await this.camera.check();if(!hardware.connected)throw new DeviceError('CAMERA_OFFLINE',hardware.error||'USB 카메라 연결을 확인하세요.',503);}
   if(this.camera.snapshot().job.status==='running')throw new DeviceError('CAMERA_BUSY','카메라 촬영이 진행 중입니다.');
   if(this.motion.refreshing)await this.motion.refreshing.catch(()=>{});
   if(this.motion.busy)throw new DeviceError('MOTION_BUSY','모터가 동작 중입니다.');
   await this.checkMcb();
   const d=this.sync();d.fault=current.fault;this.owned=true;
   this.sim.command(1,type,args,requestId);d.job.realMotion=true;d.job.slot=args.slot;d.job.focus={stage:'loading',frames:0,sharpness:null,best:null};
   this.slowCameraAxes(true);this.focusHold(d);this.emit('change');return {};
  }
  if(type==='focusStop'){
   const j=this.owned?this.sim.get(1).job:null;
   if(!j||!j.focus||!['running','paused'].includes(j.status))throw new DeviceError('NO_FOCUS_JOB','초점 조정 모드가 아닙니다.',400);
   j.focus.stopRequested=true;this.emit('change');return {};
  }
  // 카메라 웰 중심 정렬 보정: 플레이트가 있는 slot에서 step당 영상 이동·백래시·기준 링을 측정해 저장
  if(this.motion&&!busy&&type==='calibrate'&&args.kind==='alignment'){
   if(!this.alignment||!this.camera.alignFrame)throw new DeviceError('UNSUPPORTED_CALIBRATION','이 장비에서는 카메라 정렬 보정을 지원하지 않습니다.',501);
   if(!Number.isInteger(args.slot)||args.slot<1||args.slot>this.motion.layout.slots)throw new DeviceError('INVALID_SLOT',`보정용 플레이트 slot(1~${this.motion.layout.slots})을 지정하세요.`,400);
   if(this.camera.check){const hardware=await this.camera.check();if(!hardware.connected)throw new DeviceError('CAMERA_OFFLINE',hardware.error||'USB 카메라 연결을 확인하세요.',503);}
   if(this.camera.snapshot().job.status==='running')throw new DeviceError('CAMERA_BUSY','카메라 촬영이 진행 중입니다.');
   if(this.motion.refreshing)await this.motion.refreshing.catch(()=>{});
   if(this.motion.busy)throw new DeviceError('MOTION_BUSY','모터가 동작 중입니다.');
   await this.checkMcb();
   const d=this.sync();d.fault=current.fault;this.owned=true;
   this.sim.command(1,type,args,requestId);d.job.realMotion=true;d.job.slot=args.slot;
   this.slowCameraAxes(true);this.calibrateCamera(d);this.emit('change');return {};
  }
  // 원점 복귀 / 구동 4축 원점 보정 -> MCB HOME ALL
  if(this.motion&&!busy&&(type==='home'||(type==='calibrate'&&args.kind==='axis'))){
   if(this.motion.busy)throw new DeviceError('MOTION_BUSY','모터가 동작 중입니다.');
   await this.checkMcb();
   const d=this.sync();d.fault=current.fault;this.owned=true;
   this.sim.command(1,type,args,requestId);d.job.realMotion=true;
   this.startMotion(d,['HOME ALL'],3,400);this.emit('change');return {};
  }
  if(this.owned&&busy){return this.sim.command(1,type,args,requestId);}
  this.owned=false;return this.base.command(id,type,args,requestId);
 }
 // Run MCB steps for the current job; the virtual clock is frozen until they finish,
 // then it jumps to the start of stage `nextStage`.
 startMotion(d,steps,nextStage,timeoutSec){
  const j=d.job,id=j.id;
  j.motionWaiting=true;j.motionSteps=steps;
  this.motion.run(steps,timeoutSec).then(result=>{
   const now=this.sim.get(1).job;
   if(!now||now.id!==id||!['running','paused'].includes(now.status))return;
   now.motionWaiting=false;now.motion={seconds:result.seconds,motors:result.motors};
   if(nextStage===2&&now.realCamera)now.positionedWell=this.motion.wellOrder()[0];
   // a skipped stage ends 1 ms before the next one, so the next tick always lands in it
   now.elapsed=nextStage===2&&now.realCamera?2*this.sim.stageMs-1:nextStage*this.sim.stageMs;
   if(nextStage===4&&now.acquisitionDone){
    now.equipmentFinishedAt=Date.now();now.equipmentStatus='completed';
    if(now.capture)now.capture.equipmentSeconds=(now.equipmentFinishedAt-now.startedAt)/1000;
    if(now.processingError){this.sim.fail(this.sim.get(1),'IMAGE_PROCESSING_ERROR',now.processingError);return;}
    if(now.processingStatus==='completed')this.finishVirtualStages(now);
   }
   this.emit('change');
  }).catch(error=>{
   const now=this.sim.get(1);
   if(now.job?.id===id)this.sim.fail(now,'MOTION_ERROR',`모터 동작 실패: ${error.message}`.slice(0,600));
  });
 }
 // 전송 / PC 저장 are virtual on this unit: once the motors are back and the images are
 // processed, finish on the next tick instead of waiting out their timers.
 finishVirtualStages(job){job.elapsed=Math.max(job.elapsed,6*this.sim.stageMs);}
 // Before every motor job: read ranges / homing from the MCB, which also checks the link
 // (Pi 4 -> local UART -> MCB).
 async checkMcb(){
  if(!this.motion)return;
  try{await this.motion.refresh();}
  catch(error){throw new DeviceError('MCB_OFFLINE',`모터 보드 연결 확인 실패: ${error.message}`.slice(0,400),503);}
 }
 // Delete the frames of a capture (Pi 4 local camera folder); the
 // controller calls this when a run expires, the adapter for a failed partial plate.
 purgeCapture(capture){
  const ids=capture?.wells?.flatMap(w=>[w.id,...(w.shots||[]).filter(s=>s.shot!=='C').map(s=>s.id)])??(capture?.id&&!capture.mosaic?[capture.id]:[]);
  const valid=ids.filter(id=>/^[0-9a-f-]{36}$/.test(id));
  for(const id of valid)for(const f of [`${id}.yuy2`,`${id}.png`,`${id}-preview.jpg`,`${id}.json`]){
   try{unlinkSync(join(this.camera.directory,f));}catch{}
  }
  this.motion?.purge(valid).catch(error=>console.log(JSON.stringify({purge:valid.length,error:error.message})));
 }
 // Acquire a whole plate from one stream. Conversion promises stay independent
 // of movement/return. Plate success waits for both equipment and image processing.
 async capturePlate(d){
  const j=d.job,id=j.id,frames=[];j.frameIds=[];
  const active=async()=>{
   while(this.sim.get(1).job?.id===id&&j.status==='paused')await new Promise(r=>setTimeout(r,100));
   if(this.sim.get(1).job?.id!==id||j.status!=='running')throw new Error('촬영이 중단되었습니다.');
  };
  try{
   const ready=await(this.streamSession?.jobId===id?this.streamSession.ready:this.camera.beginSession(this.motion.wellOrder().length*(j.wellShots||1)+RETAKES));
   j.equipmentStatus='acquiring';j.processingStatus='running';j.bufferCapacity=ready?.bufferCapacity;
   if(j.alignmentRequested){
    const frame={width:ready?.width,height:ready?.height};
    j.alignmentCalibration=this.alignment.validCalibration({frame,ustep:this.ustep()});
    if(!j.alignmentCalibration)throw new Error(`카메라 정렬 보정값이 현재 카메라 해상도(${frame.width}x${frame.height})와 맞지 않습니다. 사용자 설정에서 카메라 정렬 보정을 다시 실행하세요.`);
    j.alignment={};
    // expected positions as known before this plate (grid + remembered); the plate model is relative to these
    j.expected={};for(const well of this.motion.wellOrder())j.expected[well]=this.expectedTarget(well);
   }
   // 십자 촬영: the centre frame first (aligned when alignment is on), then four frames with the
   // camera shifted by the cross offset along each axis. The shifted moves are plain moves (no
   // anti-backlash approach): their position only needs to be roughly right.
   // Motion never overlaps an exposure (2026-10-26): a shifted frame is requested crossGuardMs after
   // the move finished, and the next move waits until the frame is fully received plus crossAfterMs,
   // instead of trusting the predicted exposure window.
   const cross=(j.wellShots||1)>1?this.crossOffsets():null;j.cross=cross;
   // The stream treats a frame as usable when its timestamp is >= readyAt - exposureStart; add that
   // offset back so the guard applies to the frame timestamp itself (>= move end + crossGuardMs).
   const exposureStart=(ready?.exposureWindowMs?.[0]??400)/1000;
   const guardBefore=(this.align.crossGuardMs??1100)/1000+exposureStart,guardAfter=(this.align.crossAfterMs??150)/1000;
   const settled=async f=>{await f.acquired;if(guardAfter>0)await new Promise(r=>setTimeout(r,guardAfter*1000));};
   // a shift that runs into an axis end is clamped (recorded as such): the frame is still taken there
   // camera-stream refuses a ready time more than 1 s ahead: hold the request until it is within reach
   const shiftedFrame=async(wanted)=>{
    const target=this.motion.clampXY(wanted);const move=await this.moveXY(target);j.position=null;
    const readyAt=move.readyAt+guardBefore,wait=readyAt-0.8-now();
    if(wait>0)await new Promise(r=>setTimeout(r,wait*1000));
    return {target,clamped:target.x!==Math.round(wanted.x)||target.y!==Math.round(wanted.y),movedAt:move.readyAt,...this.camera.captureFrame(readyAt)};
   };
   while(j.wellQueue.length){
    await active();
    const well=j.wellQueue.shift();j.well=well;
    // One equipment unit of work: MOVE barrier -> eligible buffered frame -> raw file.
    const frame=await this.acquireWell(d,well,active);
    j.frameIds.push(frame.id);frames.push({well,shot:'C',...frame});
    let last=frame;
    for(const c of (cross?CROSS.slice(1):[])){
     await settled(last);await active();j.shot=c.shot;
     const f=await shiftedFrame({x:frame.target.x+c.x*cross.x,y:frame.target.y+c.y*cross.y});
     j.frameIds.push(f.id);last={well,shot:c.shot,...f};frames.push(last);this.emit('change');
    }
    j.shot=null;
    // Next well as soon as this frame's exposure is over (it is still crossing USB);
    // the last frame is awaited whole before the return. In cross mode every move waits for the
    // whole frame plus the guard.
    if(cross)await settled(last);
    else await(j.wellQueue.length&&last.released?last.released:last.acquired);
    this.emit('change');
   }
   // A frame that was not the predicted one (dropped frame) may have been exposed while the
   // axis was already moving on: take that frame again, waiting for the whole frame.
   const metas=await Promise.all(frames.map(f=>f.acquired));
   for(const [k,old] of frames.entries()){
    if(metas[k]?.onSchedule!==false)continue;
    await active();
    const frame=old.shot==='C'?{shot:'C',...await this.acquireWell(d,old.well,active)}:{shot:old.shot,...await shiftedFrame(old.target)};
    j.frameIds.push(frame.id);frames[k]={well:old.well,...frame};j.retakes=(j.retakes||0)+1;
    if(cross)await settled(frame);else await frame.acquired;
    old.completed.then(()=>this.purgeCapture({wells:[{id:old.id}]}),()=>{});
   }
   await active();
   // Start equipment shutdown immediately after the last complete native frame.
   j.acquisitionDone=true;j.acquisitionFinishedAt=Date.now();j.equipmentStatus='returning';
   j.processingWaiting=true;j.cameraWaiting=false;j.step=3;j.elapsed=3*this.sim.stageMs;
   d.light=false;d.heater=false;
   const processing=this.camera.endSession();processing.catch(()=>{});
   this.sim.event('job.stage',d,{step:3,label:'수납 복귀'});
   this.emit('change');
   await processing;
   const results=await Promise.all(frames.map(async frame=>({well:frame.well,shot:frame.shot,target:frame.target,clamped:!!frame.clamped,movedAt:frame.movedAt,last:await frame.completed})));
   await active();
   const byWell=new Map();
   for(const {well,shot,target,clamped,movedAt,last} of results){
    if(!last?.nativeYuy2||last.sourceFormat!=='YUYV'||!last.continuousStream)throw new Error('YUY2 스트림 원본 확인 실패');
    const {image,preview,raw}=last.files;
    if(!image||basename(image)!==image||!/^[-a-f0-9]+\.png$/.test(image)||!preview||basename(preview)!==preview)throw new Error('잘못된 영상 파일명');
    const entry={shot,id:last.id,image,preview,raw,sha256:last.rawSha256,target:target||null,...(clamped?{clamped:true}:{}),totalSeconds:last.totalSeconds,
     frameMonotonic:last.frameMonotonic,readyMonotonic:last.readyMonotonic,movedAt:movedAt||null};
    if(shot!=='C'){const w=byWell.get(well);if(!w)throw new Error(`Well ${well} 중앙 프레임 없음`);w.shots.push(entry);continue;}
    const p=this.motion.wellPos(well),alignment=j.alignment?.[well]||null;
    const record={well,col:p.col,row:p.row,x:p.x,y:p.y,target:alignment?.target||target||null,alignment,id:last.id,image,preview,raw,sha256:last.rawSha256,
     width:1280,height:Math.round(1280*last.height/last.width/2)*2,totalSeconds:last.totalSeconds,
     captureSeconds:last.captureSeconds,frameSequence:last.sequence,frameMonotonic:last.frameMonotonic,
     requestedMonotonic:last.requestedMonotonic,readyMonotonic:last.readyMonotonic,eligibleMonotonic:last.eligibleMonotonic,
     buffered:last.buffered,processingPid:last.processingPid,acquisitionPid:last.acquisitionPid,continuousStream:true,
     ...(cross?{shots:[entry]}:{})};
    byWell.set(well,record);j.wells.push(record);
   }
   // 바코드 판독 (등록 시험 촬영 · 매 회차): 1280 px 미리보기는 여기서(약 1~2초), 거기서 못 읽으면
   // 원본 PNG 판독(6장 약 7초)은 회차가 기록된 뒤 따로 돌려 결과를 capture.barcode 이벤트로 보낸다.
   if(j.barcodeRequested){j.barcode=await this.readBarcodes(j,'preview');this.emit('change');}
   this.buildMosaic(d);
  }catch(error){
   if(this.sim.get(1).job?.id===id&&['running','paused'].includes(j.status)){
    if(j.acquisitionDone&&!j.equipmentFinishedAt){j.processingError=error.message.slice(0,600);this.emit('change');}
    else this.sim.fail(d,'CAMERA_ERROR',error.message.slice(0,600));
   }
  }
 }
 async acquireWell(d,well,active){
  const j=d.job,calibration=j.alignmentCalibration||null;
  if(!calibration){	// previous behaviour: grid position, next exposure after the move
   const target=this.motion.wellTarget?.(well)||null;
   if(j.positionedWell!==well)await this.motion.run(this.motion.wellSteps(well),60);
   await active();j.positionedWell=well;
   return {target,...this.camera.captureFrame(now())};
  }
  const approach=this.approach(calibration),prediction=this.predictTarget(j,well);
  let target=prediction.target,readyAt=now(),approached=!!approach,frameId=null;
  if(j.positionedWell!==well){const move=await this.moveXY(target,approach,j.position||null);readyAt=move.readyAt;approached=move.approached;}
  await active();j.positionedWell=well;
  const a=await this.alignWell(d,well,target,readyAt,calibration,approached,active);
  target=a.target;readyAt=a.readyAt;frameId=a.frameId;approached=a.approached;j.alignment[well]={...a.info,predictedFrom:prediction.source};
  if(a.info.aligned){(j.measured||(j.measured={}))[well]=target;this.updatePlateModel(j);}
  j.position=approached?target:null;
  // A frame judged centred is the capture itself; otherwise the next exposure after the move.
  return {target,...this.camera.captureFrame(readyAt,frameId)};
 }
 // 십자 촬영 offset in MCB steps per axis. From the camera calibration (pixels per step x image
 // scale) when there is one, else from the recipe grid pitch assumed to be one well pitch.
 crossOffsets(){
  const c=this.motion.config,mm=Number(c.crossOffsetMm)>0?Number(c.crossOffsetMm):8,pitchMm=Number(c.wellPitchMm)>0?Number(c.wellPitchMm):39.2;
  const cal=this.alignment?.validCalibration({ustep:this.ustep()}),um=this.imageScale().umPerPx;
  if(cal&&um){const k=cal.pixelsPerStep,sx=Math.hypot(k.xx,k.yx),sy=Math.hypot(k.xy,k.yy);if(sx>0&&sy>0)return {x:Math.round(mm*1000/(um*sx)),y:Math.round(mm*1000/(um*sy)),mm,source:'calibration'};}
  return {x:Math.round(mm*this.motion.pitch('cameraX')/pitchMm),y:Math.round(mm*this.motion.pitch('cameraY')/pitchMm),mm,source:'grid'};
 }
 // Barcode / QR in the frames of this plate. Result: {scanned, decoder, value, values, found[], error, seconds, pending}.
 // pass 'preview': the 1280 px previews; when nothing is found there `pending` is set and the full
 // frames are decoded in the background (fullBarcodePass) once the capture record exists.
 async readBarcodes(j,pass='preview'){
  const started=now(),wells=[...j.wells].sort((a,b)=>a.well-b.well);
  const files=wells.map(w=>join(this.camera.directory,w[pass]));
  const r=await decodeBarcodes(files,{timeoutMs:90000});
  const found=r.results.flatMap((x,i)=>(x.barcodes||[]).map(b=>({well:wells[i].well,text:b.text,format:b.format,x:b.x,y:b.y,w:b.w,h:b.h,source:pass})));
  const error=r.results.find(x=>x.error)?.error||null,values=[...new Set(found.map(f=>f.text))];
  return {scanned:!!r.decoder,decoder:r.decoder,error,value:values[0]||null,values,found,pass,pending:pass==='preview'&&!!r.decoder&&!found.length&&!error,seconds:Math.round((now()-started)*100)/100};
 }
 // Second pass on the full frames, after the run is recorded; the controller merges the result by capture id.
 fullBarcodePass(capture){
  if(!capture?.barcode?.pending||!capture.wells?.length)return;
  const j={wells:capture.wells};
  this.readBarcodes(j,'image').then(result=>{
   const barcode={...result,seconds:Math.round((capture.barcode.seconds+result.seconds)*100)/100,pending:false};
   this.emit('event',{type:'capture.barcode',deviceId:1,at:Date.now(),requestId:null,captureId:capture.id,barcode});
  }).catch(()=>{});
 }
 setIdle(on){this.camera.idle=!!on;}
 // Expected camera position of a well before this plate's own seating is known: the recipe grid
 // plus the position remembered from earlier plates (the systematic grid error).
 expectedTarget(well){return this.motion.wellTarget(well,this.startOffset(well));}
 // Plate model: the first centred well gives the plate's shift; the second gives its rotation and
 // scale along the grid. Later wells start from the model and usually need one look only.
 updatePlateModel(j){
  const wells=Object.keys(j.measured||{}).map(Number),expected=w=>j.expected?.[w]||this.expectedTarget(w);
  if(!wells.length){j.plateModel=null;return;}
  const w1=wells[0],e1=expected(w1),m1=j.measured[w1];
  let A={xx:1,xy:0,yx:0,yy:1},rotation=0,scale=1;
  if(wells.length>=2){
   const w2=wells[1],e2=expected(w2),m2=j.measured[w2];
   const de={x:e2.x-e1.x,y:e2.y-e1.y},dm={x:m2.x-m1.x,y:m2.y-m1.y},len=Math.hypot(de.x,de.y);
   if(len>50){
    scale=Math.hypot(dm.x,dm.y)/len;rotation=Math.atan2(dm.y,dm.x)-Math.atan2(de.y,de.x);
    // a seating difference is small: anything else means a mislocated well, keep the shift only
    if(scale>0.8&&scale<1.25&&Math.abs(rotation)<0.15){const c=Math.cos(rotation)*scale,sn=Math.sin(rotation)*scale;A={xx:c,xy:-sn,yx:sn,yy:c};}
    else{scale=1;rotation=0;}
   }
  }
  j.plateModel={wells:wells.slice(0,2),shift:{x:m1.x-e1.x,y:m1.y-e1.y},rotation:Math.round(rotation*1000)/1000,scale:Math.round(scale*1000)/1000,e1,m1,A};
 }
 predictTarget(j,well){
  const pm=j.plateModel,e=j.expected?.[well]||this.expectedTarget(well);
  if(!pm)return {target:e,source:'grid'};
  const dx=e.x-pm.e1.x,dy=e.y-pm.e1.y;
  return {target:this.motion.clampXY({x:pm.m1.x+pm.A.xx*dx+pm.A.xy*dy,y:pm.m1.y+pm.A.yx*dx+pm.A.yy*dy}),source:pm.wells.length>=2?'plate-model':'plate-shift'};
 }
 // ---- well-centre alignment (ported from colony_scanner-UI lib/scanner.mjs) ----
 ustep(){return {cameraX:this.motion.ustep('cameraX'),cameraY:this.motion.ustep('cameraY')};}
 startOffset(well){return this.alignmentActive&&this.align.remember?this.alignment.offset(well):{x:0,y:0};}
 approach(calibration){
  const s=this.align;
  if(!s.antiBacklash||!calibration?.approach)return null;
  const margin=axis=>this.motion.full(axis,s.backlashMarginFullSteps);
  return {x:{sign:calibration.approach.x,steps:(calibration.backlash?.x||0)+margin('cameraX')},y:{sign:calibration.approach.y,steps:(calibration.backlash?.y||0)+margin('cameraY')}};
 }
 async moveXY(target,approach=null,from=null){
  const started=now(),move=this.motion.approachMove(target,approach,from);
  const result=await this.motion.run(move.steps,90),readyAt=now();
  return {result,readyAt,seconds:readyAt-started,approached:move.approached};
 }
 // One alignment look: a frame exposed after the move (readyAt plus a settle margin). The stream
 // may hand over a frame that was not the predicted one (dropped frame) and could have been
 // exposed while the axis still moved (onSchedule false): such a frame is taken again.
 async look(options,readyAt){
  const started=now(),ready=readyAt+(this.align.settleMs||0)/1000;
  let frame=this.camera.alignFrame({...options,overlayDir:process.env.COLONY_ALIGN_OVERLAY_DIR||null},ready),result=await frame.result;
  if(result.frame?.onSchedule===false){frame=this.camera.alignFrame({...options,overlayDir:process.env.COLONY_ALIGN_OVERLAY_DIR||null},ready);result=await frame.result;result.retaken=true;}
  const waited=result.frame?.frameMonotonic?result.frame.frameMonotonic-readyAt:null;
  return {id:frame.id,...result,timing:{lookSeconds:now()-started,exposureWaitSeconds:waited,detectSeconds:result.seconds??null}};
 }
 // Look-correct loop shared by well alignment and calibration.
 async centre({target,readyAt,ring,matrix,approach,maxIterations,maxOffset=null,approached=false,retryMiss=false,active}){
  const s=this.align;
  const limit={x:s.maxCorrectionPitch*this.motion.pitch('cameraX'),y:s.maxCorrectionPitch*this.motion.pitch('cameraY')};
  const corrections=[],looks=[];let frameId=null,residual=null,aligned=false,error=null,clamped=false,gain=1,previous=null;
  for(let i=0;;i++){
   await active();
   let r=await this.look({radius:ring.radius,polarity:ring.polarity,maxOffset},readyAt);
   if(!r.ok&&retryMiss)r=await this.look({radius:ring.radius,polarity:ring.polarity,maxOffset},readyAt);
   frameId=r.id;looks.push({...r.timing,offset:r.ok?{x:Math.round(r.offset.x),y:Math.round(r.offset.y)}:null,error:r.ok?null:r.error});
   if(!r.ok){error=r.error;break;}
   residual={x:Math.round(r.offset.x),y:Math.round(r.offset.y),radius:Math.round(r.radius),support:r.support};
   const distance=Math.hypot(r.offset.x,r.offset.y);
   if(distance<=s.tolerancePx){aligned=true;break;}
   if(i>=maxIterations){error='ALIGNMENT_RESIDUAL';break;}
   // a correction that made things clearly worse means the move did not do what the matrix
   // predicts (slack, wrong matrix): stop here instead of wandering onto a neighbouring well
   if(previous!==null&&distance>2*previous&&distance>3*s.tolerancePx){error='ALIGNMENT_DIVERGED';break;}
   if(previous!==null&&distance>0.8*previous)gain=Math.max(0.25,gain/2);previous=distance;
   const delta=limitCorrection(correction(matrix,{x:r.offset.x*gain,y:r.offset.y*gain}),limit);clamped||=delta.clamped;
   const next=this.motion.clampXY({x:target.x+delta.x,y:target.y+delta.y});
   if(next.x===target.x&&next.y===target.y){error='ALIGNMENT_AT_RANGE_LIMIT';break;}
   corrections.push({x:next.x-target.x,y:next.y-target.y});
   await active();
   const move=await this.moveXY(next,approach,approached?target:null);
   looks.at(-1).moveSeconds=move.seconds;readyAt=move.readyAt;approached=move.approached;target=next;
  }
  return {target,readyAt,frameId,aligned,error,residual,corrections,clamped,gain,looks,approached};
 }
 async alignWell(d,well,target,readyAt,calibration,approached,active){
  const s=this.align,nominal=this.motion.wellPos(well),j=calibration.pixelsPerStep,started=now();
  const limit={x:s.maxCorrectionPitch*this.motion.pitch('cameraX'),y:s.maxCorrectionPitch*this.motion.pitch('cameraY')};
  const maxOffset=Math.max(limit.x*Math.hypot(j.xx,j.xy),limit.y*Math.hypot(j.yx,j.yy))*1.25+s.tolerancePx;
  const c=await this.centre({target,readyAt,ring:calibration.ring,matrix:j,approach:this.approach(calibration),maxIterations:s.maxIterations,maxOffset,approached,active});
  const info={aligned:c.aligned,iterations:c.corrections.length,corrections:c.corrections,clamped:c.clamped,gain:c.gain,residualPx:c.residual,error:c.error,target:c.target,offset:{x:c.target.x-nominal.x,y:c.target.y-nominal.y},looks:c.looks,seconds:Math.round((now()-started)*100)/100};
  if(c.aligned&&s.remember)this.alignment.rememberOffset(well,info.offset);
  if(!c.aligned&&s.onFailure==='fail')throw new Error(`웰 ${well} 중심 정렬 실패: ${c.error}`);
  this.emit('change');
  return {target:c.target,readyAt:c.readyAt,frameId:c.frameId,info,approached:c.approached};
 }
 // Focus hold: load the plate, put the first well under the camera at the capture height and
 // keep taking frames (focus view + sharpness) until focusStop or the time limit; then return.
 async focusHold(d){
  const j=d.job,id=j.id,slot=j.slot,well=this.motion.wellOrder()[0],limitMs=Number(process.env.COLONY_FOCUS_LIMIT_MS)||15*60000;
  const live=()=>this.sim.get(1).job?.id===id&&['running','paused'].includes(j.status);
  j.motionWaiting=true;
  let sessionOpen=false,loaded=false;
  try{
   const ready=this.camera.beginSession(1);ready.catch(()=>{});sessionOpen=true;
   const known=this.alignment?.validCalibration({ustep:this.ustep()})||null;
   await this.motion.run(this.motion.loadSteps(slot,this.startOffset(well),this.approach(known)),300);loaded=true;
   const stream=await ready;if(!live())throw new Error('초점 조정이 중단되었습니다.');
   // centre the well first when the camera is calibrated, so the focus view shows the whole well
   const calibration=known&&this.alignment.validCalibration({frame:{width:stream?.width,height:stream?.height},ustep:this.ustep()});
   if(calibration){
    j.focus.stage='centring';this.emit('change');
    const active=async()=>{if(!live())throw new Error('초점 조정이 중단되었습니다.');};
    const target=this.expectedTarget(well);
    await this.centre({target,readyAt:now(),ring:calibration.ring,matrix:calibration.pixelsPerStep,approach:this.approach(calibration),maxIterations:this.align.maxIterations,approached:true,active});
   }
   j.focus.stage='holding';j.focus.startedAt=Date.now();this.emit('change');
   while(live()&&!j.focus.stopRequested&&Date.now()-j.focus.startedAt<limitMs){
    const frame=this.camera.alignFrame({detect:false,snapshot:'focus',radius:calibration?.ring?.radius||null},now()-0.5);
    const r=await frame.result;
    if(r.snapshot){
     const v=r.snapshot.sharpness,f=j.focus;f.frames++;f.sharpness=v;f.images=r.snapshot;f.at=Date.now();
     if(v>(f.best||0)){f.best=v;f.bestAt=f.frames;}
     f.history=[...(f.history||[]),v].slice(-120);
     // guidance from the focus curve: sharpness rises towards the focal point and falls past it
     const h=f.history,last=h.slice(-3),prev=h.slice(-6,-3),mean=a=>a.reduce((x,y)=>x+y,0)/Math.max(a.length,1);
     f.ratio=f.best?Math.round(v/f.best*100):null;
     f.trend=prev.length<3?'start':mean(last)>mean(prev)*1.05?'rising':mean(last)<mean(prev)*0.95?'falling':'flat';
     f.hint=f.frames<4?'렌즈를 한쪽 방향으로 천천히 돌리세요.'
      :f.trend==='rising'?'좋아지고 있습니다. 같은 방향으로 계속 돌리세요.'
      :(f.ratio!==null&&f.ratio<85&&f.frames-f.bestAt>=3)?`최대점(${f.best})을 지났습니다. 반대 방향으로 조금 돌려 최대값 근처로 돌아가세요.`
      :f.trend==='falling'?'나빠지고 있습니다. 반대 방향으로 돌리세요.'
      :(f.ratio!==null&&f.ratio>=95&&f.frames-f.bestAt<=2)?'최대값 근처입니다. 아주 조금씩 양쪽으로 움직여 가장 큰 값을 확인하세요.':'변화가 없습니다. 조금 더 돌려 보세요.';
     this.emit('change');
    }
   }
   if(!live())throw new Error('초점 조정이 중단되었습니다.');
   j.focus.stage='returning';this.emit('change');
   await this.camera.endSession();sessionOpen=false;
   await this.motion.run(this.motion.returnSteps(slot),180);
   if(!live())return;
   j.motionWaiting=false;j.focus.stage='done';j.elapsed=3*this.sim.stageMs;this.emit('change');
  }catch(error){
   const current=this.sim.get(1);
   if(sessionOpen)await this.camera.endSession().catch(()=>{});
   if(loaded&&live())await this.motion.run(this.motion.returnSteps(slot),180).catch(()=>{});
   if(live())this.sim.fail(current,'FOCUS_ERROR',`초점 조정 실패: ${error.message}`.slice(0,600));
  }
 }
 // Calibration job (sim 'calibrate' job with the clock frozen until the equipment is back).
 async calibrateCamera(d){
  const j=d.job,id=j.id,slot=j.slot,well=this.motion.wellOrder()[0],nominal=this.motion.wellPos(well);
  const active=async()=>{
   while(this.sim.get(1).job?.id===id&&j.status==='paused')await new Promise(r=>setTimeout(r,100));
   if(this.sim.get(1).job?.id!==id||j.status!=='running')throw new Error('보정이 중단되었습니다.');
  };
  j.motionWaiting=true;j.calibrationStage='loading';
  let measurement=null,sessionOpen=false,loaded=false;
  try{
   const ready=this.camera.beginSession(1);ready.catch(()=>{});sessionOpen=true;
   await this.motion.run(this.motion.loadSteps(slot,this.startOffset(well)),300);loaded=true;
   const stream=await ready;await active();
   j.calibrationStage='measuring';this.emit('change');
   measurement=await this.measureCamera({j,slot,well,nominal,frame:{width:stream?.width,height:stream?.height},active});
   await active();
   this.alignment.setCalibration(measurement);
   if(this.align.remember)this.alignment.rememberOffset(well,measurement.offset);
   j.calibration=this.alignment.calibration;j.calibrationStage='returning';this.emit('change');
   await this.camera.endSession();sessionOpen=false;
   await this.motion.run(this.motion.returnSteps(slot),180);
   await active();
   j.motionWaiting=false;j.calibrationStage='done';j.elapsed=3*this.sim.stageMs;	// completes on the next tick
   this.emit('change');
  }catch(error){
   const current=this.sim.get(1);
   if(sessionOpen)await this.camera.endSession().catch(()=>{});
   // measurement problems are not motor faults: put the plate back before failing
   if(loaded&&current.job?.id===id&&['running','paused'].includes(j.status)&&/^(CALIBRATION_|웰|카메라 보정)/.test(error.message))await this.motion.run(this.motion.returnSteps(slot),180).catch(()=>{});
   if(current.job?.id===id&&['running','paused'].includes(j.status))this.sim.fail(current,'CALIBRATION_ERROR',`카메라 정렬 보정 실패: ${error.message}`.slice(0,600));
  }
 }
 async measureCamera({j,slot,well,nominal,frame,active}){
  const s=this.align;let target=this.motion.wellTarget(well,this.startOffset(well)),readyAt=now();
  const seen=async options=>{
   await active();let r=await this.look(options,readyAt);
   if(!r.ok)r=await this.look(options,readyAt);
   if(!r.ok)throw new Error(`카메라 보정: 웰 테두리를 찾지 못했습니다 (${r.error}). 플레이트가 slot ${slot}에 있는지 확인하세요.`);
   return r;
  };
  const probes={},shift={},approach={},distance={},probeTarget={};
  for(const axis of ['cameraX','cameraY']){
   const key=axis==='cameraX'?'x':'y';distance[key]=this.motion.full(axis,s.probeFullSteps);
   let probe=this.motion.clampXY({...target,[key]:target[key]+distance[key]});
   if(Math.abs(probe[key]-target[key])<distance[key]/2)probe=this.motion.clampXY({...target,[key]:target[key]-distance[key]});
   if(Math.abs(probe[key]-target[key])<distance[key]/2)throw new Error(`카메라 보정: ${axis} 축에 probe 이동 여유가 없습니다.`);
   probeTarget[key]=probe;approach[key]=Math.sign(probe[key]-target[key]);
  }
  const settle=async pre=>{await active();({readyAt}=await this.moveXY(target,{x:{sign:approach.x,steps:pre.x},y:{sign:approach.y,steps:pre.y}}));};
  const preTravel={x:Math.round(distance.x/2),y:Math.round(distance.y/2)};
  const shifted=async(reference,what,minShift=0)=>{
   await active();const r=await this.look({reference,detect:false,minShift},readyAt);
   if(!r.shift||r.shift.strength<0.05)throw new Error(`카메라 보정: ${what} 뒤 영상 정합에 실패했습니다.`);
   return r;
  };
  const previous=this.alignment.calibration?.ring;
  let ring=null;
  for(const key of ['x','y']){
   const axis=key==='x'?'cameraX':'cameraY';
   await settle(preTravel);
   let base=null;
   if(!ring&&previous?.radius){await active();const r=await this.look({radius:previous.radius,polarity:previous.polarity},readyAt);if(r.ok&&r.support>=1.5)base=r;}
   if(!base)base=await seen(ring||{});
   ring=ring||{radius:base.radius,polarity:base.polarity};
   await active();({readyAt}=await this.moveXY(probeTarget[key]));
   const moved=await shifted(base.id,`${axis} probe`,frame.width/40);
   probes[key]={steps:probeTarget[key][key]-target[key],dx:moved.shift.x,dy:moved.shift.y};
   if(Math.hypot(probes[key].dx,probes[key].dy)<frame.width/40)throw new Error(`카메라 보정: ${axis} 축을 ${probes[key].steps} step 움직여도 영상이 거의 움직이지 않았습니다.`);
   await active();({readyAt}=await this.moveXY(target));
   const back=await shifted(base.id,`${axis} return`);
   shift[key]={x:back.shift.x,y:back.shift.y};
  }
  let pixelsPerStep,backlash;
  try{pixelsPerStep=jacobian(probes);backlash=backlashSteps(probes,shift);}
  catch(error){throw new Error(`카메라 보정: 두 축의 영상 이동이 독립적이지 않습니다 (${error.message}). 축 유격을 점검하세요.`);}
  const draft={pixelsPerStep,approach,backlash};
  await active();const settled=await this.moveXY(target,this.approach(draft));readyAt=settled.readyAt;
  const c=await this.centre({target,readyAt,ring,matrix:pixelsPerStep,approach:this.approach(draft),maxIterations:s.maxIterations+1,approached:settled.approached,retryMiss:true,active});
  if(c.error&&c.error!=='ALIGNMENT_RESIDUAL'&&c.error!=='ALIGNMENT_AT_RANGE_LIMIT')throw new Error(`카메라 보정: 중심 맞춤 중 웰 테두리를 놓쳤습니다 (${c.error}).`);
  target=c.target;readyAt=c.readyAt;
  let centredRing=null;
  try{await active();const free=await this.look({},readyAt);if(free.ok)centredRing={radius:Math.round(free.radius),polarity:free.polarity,offset:{x:Math.round(free.offset.x),y:Math.round(free.offset.y)}};}catch{}
  return {frame,ustep:this.ustep(),pixelsPerStep,approach,backlash,ring:{radius:Math.round(ring.radius),polarity:ring.polarity},centredRing,
   probes,probeFullSteps:s.probeFullSteps,residualPx:c.residual?{x:c.residual.x,y:c.residual.y}:null,centred:c.aligned,corrections:c.corrections,slot,well,target,offset:{x:target.x-nominal.x,y:target.y-nominal.y}};
 }
 // Well w: camera X/Y over the well, then one frame; finishCamera() chains the next well.
 captureWell(d,w){
  const j=d.job,id=j.id;
  j.well=w;
  // Loading already positioned XY at the first well, with a barrier on all axes.
  const movement=j.positionedWell===w?Promise.resolve():this.motion.run(this.motion.wellSteps(w),60);
  movement.then(()=>{
   const now=this.sim.get(1);
   if(now.job?.id!==id||!['running','paused'].includes(now.job.status))return;
   now.job.positionedWell=w;
   try{now.job.cameraJobId=this.camera.capture('YUYV').job.id;}
   catch(error){this.sim.fail(now,'CAMERA_ERROR',`Well ${w}: ${error.message}`);}
   this.emit('change');
  }).catch(error=>{
   const now=this.sim.get(1);
   if(now.job?.id===id)this.sim.fail(now,'MOTION_ERROR',`Well ${w} 이동 실패: ${error.message}`.slice(0,600));
  });
 }
 // mosaic of the well previews in plate layout -> data/images/<uuid>.png (the viewer shows one image)
 buildMosaic(d){
  const j=d.job,id=j.id,name=`${randomUUID()}.png`,n=j.wells.length,cols=Math.min(this.motion.config.wellColumns,n);
  j.wells.sort((a,b)=>a.well-b.well);	// mosaic in plate layout (row by row), not capture order
  const inputs=j.wells.flatMap(w=>['-i',join(this.camera.directory,w.preview)]);
  const layout=j.wells.map((_,k)=>{
   const c=k%cols,r=Math.floor(k/cols);
   const x=c?Array.from({length:c},(_,q)=>`w${q}`).join('+'):'0';
   const y=r?Array.from({length:r},(_,q)=>`h${q*cols}`).join('+'):'0';
   return `${x}_${y}`;
  }).join('|');
  const filter=n>1?`${j.wells.map((_,k)=>`[${k}:v]`).join('')}xstack=inputs=${n}:layout=${layout}[v]`:'[0:v]null[v]';
  mkdirSync(join(this.dataDir,'images'),{recursive:true});
  const out=join(this.dataDir,'images',name);
  const child=spawn('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',...inputs,'-filter_complex',filter,'-map','[v]','-frames:v','1',out],{stdio:['ignore','ignore','pipe']});
  j.mosaicFile=name;this.mosaicChild=child;
  const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
  child.on('error',error=>{if(this.sim.get(1).job?.id===id)this.sessionFailed(error);});
  let err='';child.stderr.on('data',b=>{err=(err+b).slice(-2000);});
  child.on('close',code=>{
   clearTimeout(timer);if(this.mosaicChild===child)this.mosaicChild=null;
   const now=this.sim.get(1);
   if(now.job?.id!==id||!['running','paused'].includes(now.job.status))return;
   if(code!==0){this.sessionFailed(new Error(`모자이크 생성 실패: ${err}`));this.emit('change');return;}
   const w0=now.job.wells[0];
   now.job.image=name;
   now.job.capture={id:name.slice(0,-4),width:w0.width*cols,height:w0.height*Math.ceil(n/cols),sourceFormat:'YUYV',nativeYuy2:true,
    mosaic:true,plate:now.job.plateGrid,wells:now.job.wells,wellShots:now.job.wellShots||1,cross:now.job.cross?{...now.job.cross,guardMs:this.align.crossGuardMs??1100,afterMs:this.align.crossAfterMs??150}:null,barcode:now.job.barcode||null,trial:!!now.job.trial,
    alignment:now.job.alignmentCalibration?{enabled:true,alignedWells:now.job.wells.filter(w=>w.alignment?.aligned).map(w=>w.well),unalignedWells:now.job.wells.filter(w=>!w.alignment?.aligned).map(w=>w.well),tolerancePx:this.align.tolerancePx,calibratedAt:now.job.alignmentCalibration.calibratedAt,
     plateModel:now.job.plateModel?{wells:now.job.plateModel.wells,shift:now.job.plateModel.shift,rotation:now.job.plateModel.rotation,scale:now.job.plateModel.scale}:null}:{enabled:false},
    totalSeconds:now.job.acquisitionDone?(Date.now()-now.job.startedAt)/1000:now.job.wells.reduce((s,w)=>s+(w.totalSeconds||0),0),
    ...(now.job.acquisitionDone?{acquisitionSeconds:(now.job.acquisitionFinishedAt-now.job.startedAt)/1000,
     equipmentSeconds:now.job.equipmentFinishedAt?(now.job.equipmentFinishedAt-now.job.startedAt)/1000:null,
     processingMode:'separate-process',bufferCapacity:now.job.bufferCapacity}:{})};
   now.job.cameraWaiting=false;now.job.processingWaiting=false;now.job.processingStatus='completed';now.job.processingFinishedAt=Date.now();
   if(!now.job.acquisitionDone)now.job.elapsed=3*this.sim.stageMs;
   else if(now.job.equipmentFinishedAt)this.finishVirtualStages(now.job);
   this.emit('change');
  });
 }
 finishCamera({job,last}){
  const d=this.sim.get(1),j=d.job;
  if(!j||j.cameraJobId!==job.id||!['running','paused'].includes(j.status))return;
  try{
   if(job.status!=='completed')throw Error(job.error||'카메라 촬영 실패');
   if(!last?.nativeYuy2||last.sourceFormat!=='YUYV')throw Error('YUY2 원본 확인 실패');
   const image=last.files.image;
   if(!image||basename(image)!==image||!/^[-a-f0-9]+\.png$/.test(image))throw Error('잘못된 영상 파일명');
   if(j.wells){	// well mode: keep the full frame in the camera folder, chain the next well
    const preview=last.files.preview;
    if(!preview||basename(preview)!==preview)throw Error('미리보기 파일 없음');
    const p=this.motion.wellPos(j.well);
    j.wells.push({well:j.well,col:p.col,row:p.row,x:p.x,y:p.y,id:last.id,image,preview,raw:last.files.raw,sha256:last.rawSha256,
     width:1280,height:Math.round(1280*last.height/last.width/2)*2,totalSeconds:last.totalSeconds});
    if(j.wellQueue.length)this.captureWell(d,j.wellQueue.shift());else this.buildMosaic(d);
    this.emit('change');return;
   }
   mkdirSync(join(this.dataDir,'images'),{recursive:true});
   copyFileSync(join(this.camera.directory,image),join(this.dataDir,'images',image));
   j.image=image;j.capture={id:last.id,width:last.width,height:last.height,sourceFormat:last.sourceFormat,nativeYuy2:true,sha256:last.rawSha256,raw:last.files.raw,totalSeconds:last.totalSeconds};
   j.cameraWaiting=false;j.elapsed=3*this.sim.stageMs;
  }catch(error){this.sim.fail(d,'CAMERA_ERROR',error.message);}
  this.emit('change');
 }
 async inject(id,patch,requestId){const result=await this.base.inject(id,patch,requestId);if(id===1&&this.owned)this.sim.inject(id,patch,requestId);return result;}
 environment(...args){return this.base.environment(...args);}
 tick(ms){
  this.base.tick?.(ms);if(!this.owned)return;
  const d=this.sync(),j=d.job;
  if(j&&['running','paused'].includes(j.status)){
   const fault=this.base.get(1).fault;
   if(!d.connected||d.doorOpen||fault){this.sim.fail(d,fault||(!d.connected?'DISCONNECTED':'DOOR_OPEN'),'장비 연결·도어·오류 상태를 확인하세요.');return;}
  }
  // Freeze the virtual clock at acquisition / motion until the real step finishes.
  if((j?.cameraWaiting||j?.motionWaiting)&&j.status==='running')return;
  if(j?.processingWaiting&&j.status==='running')ms=Math.min(ms,Math.max(0,5*this.sim.stageMs-j.elapsed));
  if(ms>0)this.sim.tick(ms);
 }
 close(){this.camera.off('session-failed',this.sessionFailed);this.camera.off('settled',this.finished);this.camera.off('change',this.changed);this.base.off('event',this.forward);this.base.off('change',this.changed);this.sim.close();this.base.close();this.motion?.close?.();this.removeAllListeners();}
}
