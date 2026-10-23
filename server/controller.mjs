import {EventEmitter} from 'node:events';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {VirtualDeviceAdapter,DeviceError} from './virtual-device.mjs';

// Merged controller (2026-10-23): the testbed operating app (real camera / MCB / alignment,
// capture records with per-well frames) plus the v2.2 LCD UI additions (registration hold,
// admin-only device commands, per-well image list, alarm test hooks).

// 최대 배양 기간(일). 피드백 4.3 — 시스템상 무제한은 허용하지 않고 상한을 42일로 둔다.
// src/config/defines.ts 의 MAX_INCUBATION_DAYS 와 값을 맞춰야 한다.
const MAX_INCUBATION_DAYS=42;
// 장비가 고장났을 때의 조치(stop/home/reset/clearError/calibrate)와 장비 하드웨어 설정(environment)은
// 관리자만. 플레이트를 넣고 찍고 결과를 받는 일(capture/pause/resume/retry/register/remove)과
// 루틴·autoRun·촬영 방식(settings)은 사용자의 정상 업무이므로 열어둔다.
// src/config/defines.ts 의 ADMIN_ACTION 과 같은 목록이어야 한다.
const ADMIN_ONLY=['stop','home','reset','clearError','calibrate','focusStop','environment'];
// 등록하는 동안은 촬영을 붙잡아 둔다. 등록을 마쳤다고 알릴 때까지 미뤘다가 한꺼번에 시작한다.
const REGISTER_HOLD_MS=5*60*1000;
const DEFAULT_LAYOUT={tiers:8,columns:3};
const WELLS=6;
const PLACEHOLDER='/well-placeholder.svg';	// virtual adapter runs have no camera frames
const busy=d=>d.job&&['running','paused'].includes(d.job.status);
const validInt=(x,min,max)=>Number.isInteger(x)&&x>=min&&x<=max;
const assert=(ok,code,message,status=409)=>{if(!ok)throw new DeviceError(code,message,status);};
// Per-well preview list of a real capture: Well i -> URL of its 1280 px preview (null = no frame).
export const imagesOf=capture=>{
 if(!capture?.wells?.length)return null;
 const n=Math.max(WELLS,...capture.wells.map(w=>w.well||0));
 return Array.from({length:n},(_,i)=>{const w=capture.wells.find(w=>w.well===i+1);return w?.preview?`/api/v1/hardware/files/${w.preview}`:null;});
};
export class Controller extends EventEmitter {
 constructor({dataDir,stageMs=1600,tickMs=250,autoTick=true,adapter,profile=null,layout=null,autoRun=null,features=null}={}){
  super();this.dataDir=dataDir;mkdirSync(join(dataDir,'images'),{recursive:true});this.stateFile=join(dataDir,'state.json');this.revision=0;this.adminPin=process.env.ADMIN_PIN||'0000';this.session={role:'analyst',failed:0,lockUntil:0,idleAt:null};this.holdUntil=0;this.maintenance=null;this.extras=null;
  this.profile=profile;this.layout={...DEFAULT_LAYOUT,...(profile?.layout||layout||{})};this.layout.slots=this.layout.tiers*this.layout.columns;
  this.features={triggers:process.env.COLONY_TRIGGERS==='1',simAlarm:process.env.COLONY_TRIGGERS==='1',demoPlates:false,...(profile?.features||{}),...(features||{})};
  if(existsSync(this.stateFile)){this.db=JSON.parse(readFileSync(this.stateFile,'utf8'));assert(this.db.version===1,'BAD_STATE','지원하지 않는 데이터 파일입니다.',500);}
  else {
   // 플레이트는 씨딩하지 않는다(장비는 빈 트레이로 시작). 데모·테스트가 요청하면 슬롯 전부를 채운다.
   const plates=[];if(this.features.demoPlates)for(const deviceId of (adapter?.devices||[{id:1}]).map(d=>d.id))for(let slot=1;slot<=this.layout.slots;slot++)plates.push({id:`DEMO-${deviceId}-${String(slot).padStart(2,'0')}`,deviceId,slot,registeredAt:Date.now()-(slot*30+180)*60000,removedAt:null,paused:false,runs:[]});
   this.db={version:1,plates,routine:{cycleHours:12,days:42,delay:0,wellShots:1,...(profile?.routine||{})},autoRun:autoRun??profile?.autoRun??false,logs:[],io:[],receipts:[],devices:[]};
  }
  for(const p of this.db.plates)for(const r of p.runs){
   if(typeof r.image==='string'&&r.image.endsWith('.svg')){r.image=null;r.imageState='expired';}
   // records of the operating app before the per-well list existed
   if(r.imageState==='held'&&!r.images?.length){const list=imagesOf(r.capture);if(list)r.images=list;}
  }
  // user settings: alignment = 웰 중심 자동 정렬 (off = the previous grid capture)
  this.db.settings={alignment:profile?.alignment?.enabled??false,...(this.db.settings||{})};
  this.adapter=adapter||new VirtualDeviceAdapter({stageMs,config:this.db.devices});
  this.adapter.configure?.(this.db.settings);
  for(const d of this.db.devices)if(busy(d)&&d.job.type==='capture'){const p=this.db.plates.find(p=>p.id===d.job.plateId);if(p)p.runs.push({n:p.runs.length+1,at:Date.now(),imageState:'failed',image:null,images:null,transferred:false,error:'서버 재시작으로 작업 중단'});this.log('WARN',`SCANNER ${d.id} · 서버 재시작으로 진행 중인 작업 종료`);}
  this.adapter.on('event',e=>this.onEvent(e));this.adapter.on?.('change',()=>this.publish());this.persist();
  if(autoTick){this.timer=setInterval(()=>this.tick(tickMs),tickMs);this.timer.unref();}
 }
 log(level,message){this.db.logs.unshift({id:randomUUID(),at:Date.now(),level,message});this.db.logs=this.db.logs.slice(0,1000);}
 io(direction,type,deviceId,requestId,payload){this.db.io.unshift({id:randomUUID(),at:Date.now(),direction,type,deviceId,requestId,payload});this.db.io=this.db.io.slice(0,150);}
 snapshot(){
  const now=Date.now();
  return {revision:this.revision,serverTime:now,mode:this.adapter.engineConnected===undefined?'embedded-test':'external',
   profile:this.profile?{name:this.profile.name,title:this.profile.title,adapter:this.profile.adapter,layout:this.layout,features:this.features,kiosk:this.profile.kiosk,recipe:this.profile.recipe}:{name:'embedded',title:'내장',adapter:'virtual',layout:this.layout,features:this.features},
   devices:this.adapter.snapshot(),plates:structuredClone(this.db.plates),routine:{wellShots:1,...this.db.routine},autoRun:this.db.autoRun,settings:{...this.db.settings},captureHold:this.holdUntil>now,
   maintenance:this.maintenance?{...this.maintenance}:null,
   session:{role:this.session.role,lockedFor:Math.max(0,this.session.lockUntil-now),idleFor:this.session.idleAt?Math.max(0,now-this.session.idleAt):0},
   logs:structuredClone(this.db.logs.slice(0,100)),io:structuredClone(this.db.io),cameraBusy:this.adapter.camera?.snapshot().job.status==='running',
   capabilities:['capture','pause','resume','stop','home','calibrate','reset','clearError'],storage:'server-json',...(this.extras?.()||{})};
 }
 persist(){this.db.devices=this.adapter.snapshot();const tmp=this.stateFile+'.tmp';writeFileSync(tmp,JSON.stringify(this.db));renameSync(tmp,this.stateFile);}
 publish(){this.revision++;this.emit('state',this.snapshot());}
 tick(ms){this.adapter.tick?.(ms);if(this.session.role==='admin'&&Date.now()-this.session.idleAt>=300000){this.session={role:'analyst',failed:0,lockUntil:0,idleAt:null};this.log('INFO','관리자 권한 자동 해제');}if(this.db.autoRun&&!this.maintenance)this.schedule();this.publish();}
 // 지연은 투입~1회차, 주기는 회차~회차. 지연 0분이면 등록 완료 즉시 1회차를 찍는다(등록 중에는 보류).
 nextAt(p){return p.registeredAt+this.db.routine.delay*60000+p.runs.length*this.db.routine.cycleHours*3600000;}
 totalRuns(){return Math.floor(this.db.routine.days*24/this.db.routine.cycleHours);}
 async schedule(){if(this.scheduling||this.holdUntil>Date.now())return;this.scheduling=true;try{for(const d of this.adapter.devices){if(!d.connected||d.doorOpen||d.fault||busy(d))continue;if(d.id===1&&this.adapter.camera?.snapshot().job.status==='running')continue;const p=this.db.plates.find(p=>p.deviceId===d.id&&!p.removedAt&&!p.paused&&p.runs.length<this.totalRuns()&&this.nextAt(p)<=Date.now());if(p)await this.execute({requestId:randomUUID(),command:'capture',deviceId:d.id,args:{plateId:p.id}},'scheduler');}}catch(error){this.log('WARN',`자동 촬영 시작 실패 · ${error.message}`);}finally{this.scheduling=false;}}
 onEvent(e){
  this.io('RX',e.type,e.deviceId,e.requestId,e);
  if(e.type==='job.completed'||e.type==='job.failed'){
   const j=e.job;if(j.type==='capture'){
    const p=this.db.plates.find(p=>p.id===j.plateId);if(p){const success=e.type==='job.completed',r={n:p.runs.length+1,at:Date.now(),imageState:success?'held':'failed',image:null,images:null,transferred:success&&e.transferred,error:success?null:e.message,requestId:e.requestId};
     if(success){
      if(e.capture){r.capture=e.capture;r.image=e.image||null;r.images=imagesOf(e.capture)||(e.image?[`/api/images/${e.image}`]:null);}
      else {r.image=e.image||null;r.images=Array.from({length:WELLS},()=>e.image?`/api/images/${e.image}`:PLACEHOLDER);}
     }
     p.runs.push(r);this.retainCaptures(p);
     if(p.runs.filter(r=>r.imageState!=='failed'&&!r.transferred).length>=2)this.log('WARN',`${p.id} · 미전송 2건 이상 · 삭제 전 전송 상태 확인`);
    }
   }
   this.log(e.type==='job.failed'?'ERROR':'INFO',`SCANNER ${e.deviceId} · ${j.type} ${e.type==='job.failed'?`실패 (${e.message})`:'완료'}`);
  }
  this.persist();this.publish();
 }
 // Per plate the newest COLONY_KEEP_CAPTURES held runs are kept (default 5; one run of a real
 // 6-well capture = 6 frames + mosaic); older runs expire oldest first, their frames included.
 retainCaptures(p){
  const keep=Math.max(1,Number(process.env.COLONY_KEEP_CAPTURES)||5);
  const held=p.runs.filter(r=>r.imageState==='held');
  held.slice(0,Math.max(0,held.length-keep)).forEach(r=>this.expire(r));
 }
 expire(r){if(r.image&&!/^https?:\/\//.test(r.image)&&existsSync(join(this.dataDir,'images',r.image)))unlinkSync(join(this.dataDir,'images',r.image));
  if(r.capture){try{this.adapter.purgeCapture?.(r.capture);}catch(error){this.log('WARN',`원본 삭제 실패 · ${error.message}`);}}
  r.image=null;r.images=null;r.imageState='expired';}
 // 점검 모드(관리 툴): 장비를 움직이는 명령과 자동 촬영을 막는다. 역할 전환·설정·조회는 그대로.
 enterMaintenance(by='admin-tool'){
  assert(!this.adapter.snapshot().some(busy),'DEVICE_BUSY','진행 중인 작업이 끝난 뒤 점검 모드로 들어가세요.');
  assert(!(this.adapter.camera?.snapshot().job.status==='running'),'CAMERA_BUSY','카메라 촬영이 끝난 뒤 점검 모드로 들어가세요.');
  this.maintenance={since:Date.now(),by};this.log('WARN',`점검 모드 시작 (${by})`);this.publish();return this.maintenance;
 }
 exitMaintenance(){if(this.maintenance){this.log('INFO','점검 모드 종료');this.maintenance=null;this.publish();}}
 async execute(input,source='ui'){
  const {command,deviceId,args={},requestId}=input;
  assert(typeof requestId==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(requestId),'INVALID_REQUEST_ID','8~100자 requestId가 필요합니다.',400);
  const safeArgs=command==='role.login'?{}:args;const fingerprint=JSON.stringify({command,deviceId,args:safeArgs,source});
  const previous=this.db.receipts.find(r=>r.requestId===requestId);
  if(previous){assert(previous.fingerprint===fingerprint,'REQUEST_ID_REUSED','다른 명령에 같은 requestId를 사용할 수 없습니다.',409);return {...previous.result,replayed:true};}
  assert(args&&typeof args==='object'&&!Array.isArray(args),'INVALID_ARGS','args 객체가 필요합니다.',400);
  assert(!ADMIN_ONLY.includes(command)||this.session.role==='admin'||source==='admin-tool','FORBIDDEN','관리자 권한이 필요합니다.',403);
  assert(!this.maintenance||source==='admin-tool'||['role.login','role.logout','session.touch','settings','routine','autoRun','registerDone','platePause'].includes(command),'MAINTENANCE','점검 모드입니다. 관리 툴을 닫은 뒤 다시 시도하세요.',423);
  this.io('TX',command,deviceId,requestId,safeArgs);
  try{
   let result={};
   if(command==='role.login'){
    const now=Date.now();assert(now>=this.session.lockUntil,'ROLE_LOCKED',`PIN 입력이 ${Math.ceil((this.session.lockUntil-now)/1000)}초 동안 잠겼습니다.`,423);assert(/^\d{4}$/.test(args.pin),'INVALID_PIN','4자리 PIN을 입력하세요.',400);
    if(args.pin!==this.adminPin){this.session.failed++;if(this.session.failed>=5){this.session.failed=0;this.session.lockUntil=now+60000;}throw new DeviceError('INVALID_PIN',this.session.lockUntil>now?'PIN 5회 오류로 60초 동안 잠겼습니다.':`PIN이 올바르지 않습니다. (${this.session.failed}/5)`,401);}
    this.session={role:'admin',failed:0,lockUntil:0,idleAt:now};this.log('INFO','관리자 권한으로 전환');result={role:'admin'};
   }else if(command==='role.logout'){
    this.session={role:'analyst',failed:0,lockUntil:0,idleAt:null};this.log('INFO','분석자 권한으로 전환');result={role:'analyst'};
   }else if(command==='session.touch'){
    if(this.session.role==='admin')this.session.idleAt=Date.now();
   }else if(command==='register'){
    const d=this.adapter.get(deviceId);assert(d.connected&&!d.fault&&!d.doorOpen,'UNAVAILABLE','연결·오류·도어 상태를 확인하세요.');assert(!busy(d),'DEVICE_BUSY','작업 중에는 등록할 수 없습니다.');assert(validInt(args.slot,1,this.layout.slots),'INVALID_SLOT',`슬롯은 1~${this.layout.slots}여야 합니다.`,400);
    assert(!this.db.plates.some(p=>p.deviceId===deviceId&&p.slot===args.slot&&!p.removedAt),'SLOT_OCCUPIED','이미 수납된 슬롯입니다.');
    // 투입 시각은 서버가 찍는다. 화면에서 고를 수 있게 두면 촬영 일정 전체를 앞뒤로 옮길 수 있다.
    const registeredAt=Date.now();
    const p={id:`PL-${randomUUID().slice(0,8).toUpperCase()}`,deviceId,slot:args.slot,registeredAt,removedAt:null,paused:false,runs:[]};this.db.plates.push(p);result={plateId:p.id};this.log('INFO',`${p.id} · SCANNER ${deviceId} · 슬롯 ${args.slot} 등록`);
    this.holdUntil=Date.now()+REGISTER_HOLD_MS;
   }else if(command==='registerDone'){
    if(this.holdUntil)this.log('INFO','등록 완료 · 밀어 둔 촬영 시작');
    this.holdUntil=0;
   }else if(['remove','platePause','retry','capture'].includes(command)){
    const p=this.db.plates.find(p=>p.id===args.plateId);assert(p&&!p.removedAt,'PLATE_NOT_FOUND','수납 중인 플레이트를 찾을 수 없습니다.',404);assert(p.deviceId===deviceId,'DEVICE_MISMATCH','플레이트와 스캐너가 일치하지 않습니다.',400);const d=this.adapter.get(deviceId);
    if(command==='capture')await this.adapter.command(deviceId,'capture',{plateId:p.id,slot:p.slot},requestId);
    if(command==='remove'){assert(!busy(d),'DEVICE_BUSY','스캐너 작업을 끝내거나 정지한 후 반출하세요.');p.runs.filter(r=>r.imageState==='held').forEach(r=>this.expire(r));p.removedAt=Date.now();this.log('INFO',`${p.id} · 반출 · 영상 삭제, 이력 보존`);}
    if(command==='platePause'){assert(typeof args.paused==='boolean','INVALID_VALUE','paused는 boolean이어야 합니다.',400);p.paused=args.paused;}
    if(command==='retry'){assert(d.connected&&d.pcConnected,'PC_OFFLINE','장비 및 PC 전송 연결이 필요합니다.');let count=0;p.runs.forEach(r=>{if(r.imageState==='held'&&!r.transferred){r.transferred=true;count++;}});result={count};this.log('INFO',`${p.id} · ${count}장 PC 재전송 완료`);}
   }else if(command==='routine'){
    assert(validInt(args.cycleHours,1,48)&&validInt(args.days,1,MAX_INCUBATION_DAYS)&&validInt(args.delay,0,720)&&args.delay%15===0,'INVALID_ROUTINE',`주기 1~48시간, 배양 1~${MAX_INCUBATION_DAYS}일, 지연 0~720분(15분 단위)을 입력하세요.`,400);
    assert(args.wellShots===undefined||[1,5].includes(args.wellShots),'INVALID_ROUTINE','Well 촬영 장수는 1 또는 5여야 합니다.',400);
    this.db.routine={cycleHours:args.cycleHours,days:args.days,delay:args.delay,wellShots:args.wellShots??this.db.routine.wellShots??1};this.log('INFO','공통 루틴 저장 · 전체 일정 재산정');
   }else if(command==='autoRun'){
    assert(typeof args.enabled==='boolean','INVALID_VALUE','enabled는 boolean이어야 합니다.',400);this.db.autoRun=args.enabled;this.log('INFO',`자동 촬영 ${args.enabled?'활성화':'비활성화'}`);
   }else if(command==='settings'){
    assert(typeof args.alignment==='boolean','INVALID_VALUE','alignment는 boolean이어야 합니다.',400);
    this.db.settings={...this.db.settings,alignment:args.alignment};this.adapter.configure?.(this.db.settings);
    this.log('INFO',`촬영 방식 · ${args.alignment?'웰 중심 자동 정렬':'기존 격자 위치'}`);
   }else if(command==='environment'){
    assert(Number.isFinite(args.temperature)&&args.temperature>=4&&args.temperature<=55&&Number.isFinite(args.co2)&&args.co2>=0&&args.co2<=20,'INVALID_ENV','온도 4~55℃, CO₂ 0~20%를 입력하세요.',400);
    await this.adapter.environment?.(args,requestId);if(!this.adapter.environment)for(const d of this.adapter.devices){d.targetTemperature=args.temperature;d.targetCo2=args.co2;}this.log('INFO','환경 목표값 변경');
   }else if(command==='sim.alarm'){
    // 알람 시험(트리거 페이지 /trigger.html). 프로필 features.simAlarm 이 켜져 있을 때만 받는다.
    assert(this.features.simAlarm,'TRIGGERS_OFF','알람 시험이 꺼져 있습니다.',403);
    const kinds=['captureFail','partial','unsent','done','clear'];assert(kinds.includes(args.kind),'INVALID_VALUE','알 수 없는 시험입니다.',400);
    const placeholder=()=>Array.from({length:WELLS},()=>PLACEHOLDER);
    if(args.kind==='clear'){
     let n=0;for(const p of this.db.plates){const before=p.runs.length;p.runs=p.runs.filter(r=>!r.sim);n+=before-p.runs.length;
      for(const r of p.runs)if(r.simHeld){r.images=r.simHeld;r.imageState='held';delete r.simHeld;}}
     for(const d of this.adapter.devices)await this.adapter.inject(d.id,{fault:null,doorOpen:false,connected:true,pcConnected:true,failCamera:false},requestId);
     this.log('INFO',`알람 시험 되돌리기 · 시험 회차 ${n}건 삭제`);result={removed:n};
    }else{
     const live=this.db.plates.filter(p=>!p.removedAt&&p.deviceId===deviceId).sort((a,b)=>a.slot-b.slot);
     const p=args.slot?live.find(x=>x.slot===args.slot):live[0];assert(p,'PLATE_NOT_FOUND','시험할 플레이트가 없습니다. 먼저 등록하세요.',404);
     const run=extra=>{const r={n:p.runs.length+1,at:Date.now(),imageState:'held',image:null,images:placeholder(),transferred:true,error:null,sim:true,...extra};p.runs.push(r);return r;};
     if(args.kind==='captureFail')run({imageState:'failed',images:null,transferred:false,error:'카메라 응답 없음(시험)'});
     if(args.kind==='partial'){const r=run({});r.images=r.images.map((f,i)=>[1,3,4].includes(i)?null:f);}
     if(args.kind==='unsent'){run({transferred:false});run({transferred:false});}
     if(args.kind==='done'){const total=this.totalRuns();while(p.runs.length<total)run({imageState:p.runs.length<total-5?'expired':'held',images:p.runs.length<total-5?null:placeholder()});}
     const held=p.runs.filter(r=>r.imageState==='held');for(const r of held.slice(0,Math.max(0,held.length-5))){if(!r.sim)r.simHeld=r.images;r.images=null;r.imageState='expired';}
     this.log('INFO',`알람 시험 · ${p.id} · ${args.kind}`);result={plateId:p.id,slot:p.slot};
    }
   }else if(command==='sim.input')await this.adapter.inject(deviceId,args,requestId);
   else await this.adapter.command(deviceId,command,args,requestId);
   const ack={requestId,accepted:true,command,deviceId,...result};
   this.io('RX','ACK',deviceId,requestId,ack);this.db.receipts.unshift({requestId,fingerprint,result:ack});this.db.receipts=this.db.receipts.slice(0,300);this.persist();this.publish();return ack;
  }catch(error){this.io('RX','NACK',deviceId,requestId,{code:error.code||'ERROR',message:error.message});this.log('WARN',`${command} 거부 · ${error.message}`);this.persist();this.publish();throw error;}
 }
 close(){clearInterval(this.timer);this.persist();this.adapter.close();this.removeAllListeners();}
}
