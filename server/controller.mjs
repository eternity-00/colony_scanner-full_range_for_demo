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
const ADMIN_ONLY=['stop','home','reset','clearError','calibrate','focusStop','environment','alarmSettings','plateResult'];
// 알림 규칙 기본값(1차 피드백 2.2 · 3.2, M3 환경 설정): 관리자만 바꾼다(alarmSettings).
const DEFAULT_ALARMS={tempTolerance:1,tempMinutes:5,humidityMin:60,humidityMax:95,humidityMinutes:10};
const FAULT_LABEL={Z_LIMIT:'Z축 한계 오류',HEATER:'히터 오류',ESTOP:'비상 정지됨',DISCONNECTED:'연결 끊김',DOOR_OPEN:'도어 열림',CAMERA_TIMEOUT:'카메라 응답 없음',ENGINE_OFFLINE:'장비 엔진 연결 끊김'};
const ENV_SAMPLE_MS=5*60*1000,ENV_KEEP=7*24*12;	// 5분 간격 · 7일
const ALARM_HISTORY=300;
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
  super();this.dataDir=dataDir;mkdirSync(join(dataDir,'images'),{recursive:true});this.stateFile=join(dataDir,'state.json');this.revision=0;this.adminPin=process.env.ADMIN_PIN||'0000';this.session={role:'analyst',failed:0,lockUntil:0,idleAt:null};this.holdUntil=0;this.maintenance=null;this.extras=null;this.envSince={};this.lastEnvSample=0;this.lastAlarmEval=0;
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
  // user settings: alignment = 웰 중심 자동 정렬 (off = the previous grid capture); alarms = 환경 알림 규칙(관리자)
  this.db.settings={alignment:profile?.alignment?.enabled??false,...(this.db.settings||{})};
  this.db.settings.alarms={...DEFAULT_ALARMS,...(this.db.settings.alarms||{})};
  this.db.alarms=Array.isArray(this.db.alarms)?this.db.alarms:[];
  this.db.envHistory=Array.isArray(this.db.envHistory)?this.db.envHistory:[];
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
   devices:this.adapter.snapshot(),plates:structuredClone(this.db.plates),routine:{wellShots:1,...this.db.routine},autoRun:this.db.autoRun,settings:structuredClone(this.db.settings),captureHold:this.holdUntil>now,
   alarms:structuredClone(this.db.alarms.slice(0,ALARM_HISTORY)),envHistory:this.db.envHistory.slice(-288),
   maintenance:this.maintenance?{...this.maintenance}:null,
   session:{role:this.session.role,lockedFor:Math.max(0,this.session.lockUntil-now),idleFor:this.session.idleAt?Math.max(0,now-this.session.idleAt):0},
   logs:structuredClone(this.db.logs.slice(0,100)),io:structuredClone(this.db.io),cameraBusy:this.adapter.camera?.snapshot().job.status==='running',
   capabilities:['capture','pause','resume','stop','home','calibrate','reset','clearError'],storage:'server-json',...(this.extras?.()||{})};
 }
 persist(){this.db.devices=this.adapter.snapshot();const tmp=this.stateFile+'.tmp';writeFileSync(tmp,JSON.stringify(this.db));renameSync(tmp,this.stateFile);}
 publish(){this.revision++;this.emit('state',this.snapshot());}
 tick(ms){this.adapter.tick?.(ms);if(this.session.role==='admin'&&Date.now()-this.session.idleAt>=300000){this.session={role:'analyst',failed:0,lockUntil:0,idleAt:null};this.log('INFO','관리자 권한 자동 해제');}if(this.db.autoRun&&!this.maintenance)this.schedule();
  const now=Date.now();if(now-this.lastAlarmEval>=1000){this.lastAlarmEval=now;this.sampleEnvironment(now);this.evaluateAlarms(now);}
  this.publish();}
 // 온도·습도 추이(M3 홈): 5분마다 한 점, 7일 보관.
 sampleEnvironment(now){
  if(now-this.lastEnvSample<ENV_SAMPLE_MS)return;this.lastEnvSample=now;
  const d=this.adapter.snapshot()[0];if(!d)return;
  this.db.envHistory.push({at:now,t:Number.isFinite(d.temperature)?d.temperature:null,h:Number.isFinite(d.humidity)?d.humidity:null});
  if(this.db.envHistory.length>ENV_KEEP)this.db.envHistory=this.db.envHistory.slice(-ENV_KEEP);
  this.persist();
 }
 // 환경 이상 판정: 허용 범위를 벗어난 상태가 설정한 분수 이상 이어져야 알람(1차 피드백 3.2 — 지속 시간).
 envProblem(d,now){
  const a=this.db.settings.alarms,out=[];
  const check=(key,bad,what)=>{const k=`${key}:${d.id}`;if(bad){this.envSince[k]??=now;if(now-this.envSince[k]>=(key==='temp'?a.tempMinutes:a.humidityMinutes)*60000)out.push({key:`env-${key}:${d.id}`,kind:'env',level:'high',where:d.name,what,deviceId:d.id});}else delete this.envSince[k];};
  if(Number.isFinite(d.temperature)&&Number.isFinite(d.targetTemperature))check('temp',Math.abs(d.temperature-d.targetTemperature)>a.tempTolerance,`온도 이상 · ${d.temperature.toFixed(1)}℃ (목표 ${d.targetTemperature}℃ ± ${a.tempTolerance})`);
  if(Number.isFinite(d.humidity))check('humidity',d.humidity<a.humidityMin||d.humidity>a.humidityMax,`습도 이상 · ${d.humidity.toFixed(0)}% (범위 ${a.humidityMin}~${a.humidityMax}%)`);
  return out;
 }
 // 알람 객체(발생·확인·해제 이력): 장비 오류 · 환경 이상 · 손봐야 하는 플레이트 · 반출 대기(기간 만료 / 조기 양성).
 // 화면은 이 목록만 보고, 매번 상태에서 다시 계산하지 않는다(1차 피드백 3.4 — 이력 저장).
 evaluateAlarms(now){
  const want=new Map();const put=a=>want.set(a.key,a);
  const devices=this.adapter.snapshot(),one=devices.length===1;
  const name=id=>devices.find(d=>d.id===id)?.name||`SCANNER ${id}`;
  const pos=slot=>{const t=this.layout.tiers-Math.floor((slot-1)/this.layout.columns),c=((slot-1)%this.layout.columns)+1;return this.layout.columns>1?`${t}단 ${c}열`:`${t}단`;};
  const at=(id,slot)=>one?pos(slot):`${name(id)} · ${pos(slot)}`;
  for(const d of devices){
   const fault=!d.connected?FAULT_LABEL.DISCONNECTED:d.fault?(FAULT_LABEL[d.fault]||d.fault):d.doorOpen?FAULT_LABEL.DOOR_OPEN:null;
   if(fault)put({key:`device:${d.id}`,kind:'device',level:'high',where:d.name,what:fault,deviceId:d.id});
   for(const e of this.envProblem(d,now))put(e);
  }
  const total=this.totalRuns();
  for(const p of this.db.plates){
   if(p.removedAt)continue;
   const last=p.runs.at(-1);const failedWells=last&&last.imageState==='held'&&last.images?.length?last.images.flatMap((f,i)=>f?[]:[i+1]):[];
   const unsent=p.runs.filter(r=>r.imageState!=='failed'&&!r.transferred).length;
   if(last?.imageState==='failed')put({key:`plate:${p.id}`,kind:'plate',level:'high',where:at(p.deviceId,p.slot),what:'촬영 실패',plateId:p.id,deviceId:p.deviceId});
   else if(failedWells.length)put({key:`plate:${p.id}`,kind:'plate',level:'high',where:at(p.deviceId,p.slot),what:`Well ${failedWells.join('·')} 촬영 실패`,plateId:p.id,deviceId:p.deviceId});
   else if(unsent>=2)put({key:`plate:${p.id}`,kind:'plate',level:'normal',where:at(p.deviceId,p.slot),what:`미전송 ${unsent}건`,plateId:p.id,deviceId:p.deviceId});
   if(p.result==='positive')put({key:`done:${p.id}`,kind:'done',level:'high',reason:'positive',where:at(p.deviceId,p.slot),what:'조기 양성 · 슬롯을 비울 수 있습니다',plateId:p.id,deviceId:p.deviceId});
   else if(p.runs.length>=total)put({key:`done:${p.id}`,kind:'done',level:'normal',reason:'expired',where:at(p.deviceId,p.slot),what:`기간 만료 · 촬영 완료 ${p.runs.length}/${total} · 반출 대기`,plateId:p.id,deviceId:p.deviceId});
  }
  let changed=false;
  for(const a of this.db.alarms){
   if(a.clearedAt)continue;
   const w=want.get(a.key);
   if(!w){a.clearedAt=now;changed=true;}
   else{if(w.what!==a.what){a.what=w.what;changed=true;}want.delete(a.key);}
  }
  for(const w of want.values()){this.db.alarms.unshift({id:randomUUID(),...w,at:now,ackAt:null,clearedAt:null});this.log(w.kind==='done'&&w.reason!=='positive'?'INFO':'WARN',`알람 · ${w.where} · ${w.what}`);changed=true;}
  if(this.db.alarms.length>ALARM_HISTORY){const active=this.db.alarms.filter(a=>!a.clearedAt),old=this.db.alarms.filter(a=>a.clearedAt).slice(0,Math.max(0,ALARM_HISTORY-active.length));this.db.alarms=[...this.db.alarms.filter(a=>!a.clearedAt||old.includes(a))];}
  if(changed)this.persist();
 }
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
    // 최대 배양 기간은 관리자만 바꾼다(1차 피드백 2.2 · 4.3). 주기·지연·Well 촬영 장수는 사용자 업무.
    assert(args.days===this.db.routine.days||this.session.role==='admin'||source==='admin-tool','FORBIDDEN','총 배양 기간 변경은 관리자 권한이 필요합니다.',403);
    assert(args.wellShots===undefined||[1,5].includes(args.wellShots),'INVALID_ROUTINE','Well 촬영 장수는 1 또는 5여야 합니다.',400);
    this.db.routine={cycleHours:args.cycleHours,days:args.days,delay:args.delay,wellShots:args.wellShots??this.db.routine.wellShots??1};this.log('INFO','공통 루틴 저장 · 전체 일정 재산정');
   }else if(command==='autoRun'){
    assert(typeof args.enabled==='boolean','INVALID_VALUE','enabled는 boolean이어야 합니다.',400);this.db.autoRun=args.enabled;this.log('INFO',`자동 촬영 ${args.enabled?'활성화':'비활성화'}`);
   }else if(command==='settings'){
    assert(typeof args.alignment==='boolean','INVALID_VALUE','alignment는 boolean이어야 합니다.',400);
    this.db.settings={...this.db.settings,alignment:args.alignment};this.adapter.configure?.(this.db.settings);
    this.log('INFO',`촬영 방식 · ${args.alignment?'웰 중심 자동 정렬':'기존 격자 위치'}`);
   }else if(command==='environment'){
    assert(Number.isFinite(args.temperature)&&args.temperature>=4&&args.temperature<=55,'INVALID_ENV','목표 온도는 4~55℃ 범위로 입력하세요.',400);
    await this.adapter.environment?.({temperature:args.temperature},requestId);if(!this.adapter.environment)for(const d of this.adapter.devices){d.targetTemperature=args.temperature;}this.log('INFO',`목표 온도 ${args.temperature}℃`);
   }else if(command==='alarmSettings'){
    const a={...this.db.settings.alarms};
    for(const [k,min,max] of [['tempTolerance',0.1,10],['tempMinutes',0,120],['humidityMin',0,100],['humidityMax',0,100],['humidityMinutes',0,120]])if(args[k]!==undefined){assert(Number.isFinite(args[k])&&args[k]>=min&&args[k]<=max,'INVALID_VALUE',`${k}: ${min}~${max}`,400);a[k]=args[k];}
    assert(a.humidityMin<a.humidityMax,'INVALID_VALUE','습도 하한은 상한보다 작아야 합니다.',400);
    this.db.settings.alarms=a;this.envSince={};this.log('INFO','알림 규칙 변경 (관리자)');
   }else if(command==='alarm.ack'){
    const list=args.id?this.db.alarms.filter(a=>a.id===args.id):this.db.alarms.filter(a=>!a.clearedAt&&!a.ackAt);
    assert(list.length,'NOT_FOUND','확인할 알람이 없습니다.',404);for(const a of list)a.ackAt=a.ackAt||Date.now();result={count:list.length};
   }else if(command==='plateResult'){
    // PC 판독 결과(조기 양성 등). 지금은 관리자 입력, PC 연동이 생기면 그 채널이 같은 명령을 보낸다.
    const p=this.db.plates.find(p=>p.id===args.plateId);assert(p&&!p.removedAt,'PLATE_NOT_FOUND','수납 중인 플레이트를 찾을 수 없습니다.',404);
    assert([null,'positive','negative'].includes(args.result),'INVALID_VALUE','result 는 positive · negative · null 중 하나입니다.',400);
    p.result=args.result;p.resultAt=args.result?Date.now():null;this.log('INFO',`${p.id} · 판독 결과 ${args.result||'없음'}`);
    this.evaluateAlarms(Date.now());
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
