import {EventEmitter} from 'node:events';
import {mkdirSync,readFileSync,writeFileSync,renameSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {VirtualDeviceAdapter,DeviceError} from './virtual-device.mjs';
const busy=d=>d.job&&['running','paused'].includes(d.job.status);
const validInt=(x,min,max)=>Number.isInteger(x)&&x>=min&&x<=max;
const assert=(ok,code,message,status=409)=>{if(!ok)throw new DeviceError(code,message,status);};
export class Controller extends EventEmitter {
 constructor({dataDir,stageMs=1600,tickMs=250,autoTick=true,adapter}={}){
  super();this.dataDir=dataDir;mkdirSync(join(dataDir,'images'),{recursive:true});this.stateFile=join(dataDir,'state.json');this.revision=0;
  if(existsSync(this.stateFile)){this.db=JSON.parse(readFileSync(this.stateFile,'utf8'));assert(this.db.version===1,'BAD_STATE','지원하지 않는 데이터 파일입니다.',500);}
  else {const plates=[];[18,24,15,6].forEach((count,i)=>{for(let slot=1;slot<=count;slot++)plates.push({id:`DEMO-${i+1}-${String(slot).padStart(2,'0')}`,deviceId:i+1,slot,registeredAt:Date.now()-(slot*30+180)*60000,removedAt:null,paused:false,runs:[]});});this.db={version:1,plates,routine:{cycleHours:12,days:42,delay:0},autoRun:false,logs:[],io:[],receipts:[],devices:[]};}
  this.adapter=adapter||new VirtualDeviceAdapter({stageMs,config:this.db.devices});
  for(const d of this.db.devices)if(busy(d)&&d.job.type==='capture'){const p=this.db.plates.find(p=>p.id===d.job.plateId);if(p)p.runs.push({n:p.runs.length+1,at:Date.now(),imageState:'failed',image:null,transferred:false,error:'서버 재시작으로 작업 중단'});this.log('WARN',`SCANNER ${d.id} · 서버 재시작으로 진행 중인 작업 종료`);}
  this.adapter.on('event',e=>this.onEvent(e));this.persist();
  if(autoTick){this.timer=setInterval(()=>this.tick(tickMs),tickMs);this.timer.unref();}
 }
 log(level,message){this.db.logs.unshift({id:randomUUID(),at:Date.now(),level,message});this.db.logs=this.db.logs.slice(0,1000);}
 io(direction,type,deviceId,requestId,payload){this.db.io.unshift({id:randomUUID(),at:Date.now(),direction,type,deviceId,requestId,payload});this.db.io=this.db.io.slice(0,150);}
 snapshot(){return {revision:this.revision,serverTime:Date.now(),mode:'virtual',devices:this.adapter.snapshot(),plates:structuredClone(this.db.plates),routine:{...this.db.routine},autoRun:this.db.autoRun,logs:structuredClone(this.db.logs.slice(0,100)),io:structuredClone(this.db.io),capabilities:['capture','pause','resume','stop','home','calibrate','reset','clearError'],storage:'server-json'};}
 persist(){this.db.devices=this.adapter.snapshot();const tmp=this.stateFile+'.tmp';writeFileSync(tmp,JSON.stringify(this.db));renameSync(tmp,this.stateFile);}
 publish(){this.revision++;this.emit('state',this.snapshot());}
 tick(ms){this.adapter.tick(ms);if(this.db.autoRun)this.schedule();this.publish();}
 nextAt(p){return p.registeredAt+(p.runs.length+1)*this.db.routine.cycleHours*3600000+this.db.routine.delay*60000;}
 schedule(){for(const d of this.adapter.devices){if(!d.connected||d.doorOpen||d.fault||busy(d))continue;const p=this.db.plates.find(p=>p.deviceId===d.id&&!p.removedAt&&!p.paused&&p.runs.length<Math.floor(this.db.routine.days*24/this.db.routine.cycleHours)&&this.nextAt(p)<=Date.now());if(p){this.execute({requestId:randomUUID(),command:'capture',deviceId:d.id,args:{plateId:p.id}},'scheduler');}}}
 imageSource(){return 'https://commons.wikimedia.org/wiki/Special:FilePath/Ecoli_colonies.png?width=900';}
 onEvent(e){
  this.io('RX',e.type,e.deviceId,e.requestId,e);
  if(e.type==='job.completed'||e.type==='job.failed'){
   const j=e.job;if(j.type==='capture'){
    const p=this.db.plates.find(p=>p.id===j.plateId);if(p){const success=e.type==='job.completed',r={n:p.runs.length+1,at:Date.now(),imageState:success?'held':'failed',image:null,transferred:success&&e.transferred,error:success?null:e.message};
     if(success)r.image=this.imageSource();
     p.runs.push(r);const held=p.runs.filter(r=>r.imageState==='held');held.slice(0,Math.max(0,held.length-5)).forEach(r=>this.expire(r));
     if(p.runs.filter(r=>r.imageState!=='failed'&&!r.transferred).length>=2)this.log('WARN',`${p.id} · 미전송 2건 이상 · 삭제 전 전송 상태 확인`);
    }
   }
   this.log(e.type==='job.failed'?'ERROR':'INFO',`SCANNER ${e.deviceId} · ${j.type} ${e.type==='job.failed'?`실패 (${e.message})`:'완료'}`);
  }
  this.persist();this.publish();
 }
 expire(r){if(r.image&&!/^https?:\/\//.test(r.image)&&existsSync(join(this.dataDir,'images',r.image)))unlinkSync(join(this.dataDir,'images',r.image));r.image=null;r.imageState='expired';}
 execute(input,source='ui'){
  const {command,deviceId,args={},requestId}=input;
  assert(typeof requestId==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(requestId),'INVALID_REQUEST_ID','8~100자 requestId가 필요합니다.',400);
  const fingerprint=JSON.stringify({command,deviceId,args,source});
  const previous=this.db.receipts.find(r=>r.requestId===requestId);
  if(previous){assert(previous.fingerprint===fingerprint,'REQUEST_ID_REUSED','다른 명령에 같은 requestId를 사용할 수 없습니다.',409);return {...previous.result,replayed:true};}
  assert(args&&typeof args==='object'&&!Array.isArray(args),'INVALID_ARGS','args 객체가 필요합니다.',400);
  this.io('TX',command,deviceId,requestId,args);
  try{
   let result={};
   if(command==='register'){
    const d=this.adapter.get(deviceId);assert(d.connected&&!d.fault&&!d.doorOpen,'UNAVAILABLE','연결·오류·도어 상태를 확인하세요.');assert(!busy(d),'DEVICE_BUSY','작업 중에는 등록할 수 없습니다.');assert(validInt(args.slot,1,24),'INVALID_SLOT','슬롯은 1~24여야 합니다.',400);
    assert(!this.db.plates.some(p=>p.deviceId===deviceId&&p.slot===args.slot&&!p.removedAt),'SLOT_OCCUPIED','이미 수납된 슬롯입니다.');
    assert(Number.isFinite(args.registeredAt)&&args.registeredAt>0&&args.registeredAt<=Date.now()+60000,'INVALID_TIME','유효한 과거 또는 현재 투입 시각이 필요합니다.',400);
    const p={id:`PL-${randomUUID().slice(0,8).toUpperCase()}`,deviceId,slot:args.slot,registeredAt:args.registeredAt,removedAt:null,paused:false,runs:[]};this.db.plates.push(p);result={plateId:p.id};this.log('INFO',`${p.id} · SCANNER ${deviceId} · 슬롯 ${args.slot} 등록`);
   }else if(['remove','platePause','retry','capture'].includes(command)){
    const p=this.db.plates.find(p=>p.id===args.plateId);assert(p&&!p.removedAt,'PLATE_NOT_FOUND','수납 중인 플레이트를 찾을 수 없습니다.',404);assert(p.deviceId===deviceId,'DEVICE_MISMATCH','플레이트와 스캐너가 일치하지 않습니다.',400);const d=this.adapter.get(deviceId);
    if(command==='capture')this.adapter.command(deviceId,'capture',{plateId:p.id,slot:p.slot},requestId);
    if(command==='remove'){assert(!busy(d),'DEVICE_BUSY','스캐너 작업을 끝내거나 정지한 후 반출하세요.');p.runs.filter(r=>r.imageState==='held').forEach(r=>this.expire(r));p.removedAt=Date.now();this.log('INFO',`${p.id} · 반출 · 영상 삭제, 이력 보존`);}
    if(command==='platePause'){assert(typeof args.paused==='boolean','INVALID_VALUE','paused는 boolean이어야 합니다.',400);p.paused=args.paused;}
    if(command==='retry'){assert(d.connected&&d.pcConnected,'PC_OFFLINE','장비 및 PC 전송 연결이 필요합니다.');let count=0;p.runs.forEach(r=>{if(r.imageState==='held'&&!r.transferred){r.transferred=true;count++;}});result={count};this.log('INFO',`${p.id} · ${count}장 PC 재전송 완료`);}
   }else if(command==='routine'){
    assert(validInt(args.cycleHours,1,48)&&validInt(args.days,1,90)&&validInt(args.delay,0,720)&&args.delay%15===0,'INVALID_ROUTINE','주기 1~48시간, 배양 1~90일, 지연 0~720분(15분 단위)을 입력하세요.',400);
    this.db.routine={cycleHours:args.cycleHours,days:args.days,delay:args.delay};this.log('INFO','공통 루틴 저장 · 전체 일정 재산정');
   }else if(command==='autoRun'){
    assert(typeof args.enabled==='boolean','INVALID_VALUE','enabled는 boolean이어야 합니다.',400);this.db.autoRun=args.enabled;this.log('INFO',`자동 촬영 ${args.enabled?'활성화':'비활성화'}`);
   }else if(command==='environment'){
    assert(Number.isFinite(args.temperature)&&args.temperature>=4&&args.temperature<=55&&Number.isFinite(args.co2)&&args.co2>=0&&args.co2<=20,'INVALID_ENV','온도 4~55℃, CO₂ 0~20%를 입력하세요.',400);
    for(const d of this.adapter.devices){d.targetTemperature=args.temperature;d.targetCo2=args.co2;}this.log('INFO','가상 환경 목표값 변경');
   }else if(command==='sim.input')this.adapter.inject(deviceId,args,requestId);
   else this.adapter.command(deviceId,command,args,requestId);
   const ack={requestId,accepted:true,command,deviceId,...result};
   this.io('RX','ACK',deviceId,requestId,ack);this.db.receipts.unshift({requestId,fingerprint,result:ack});this.db.receipts=this.db.receipts.slice(0,300);this.persist();this.publish();return ack;
  }catch(error){this.io('RX','NACK',deviceId,requestId,{code:error.code||'ERROR',message:error.message});this.log('WARN',`${command} 거부 · ${error.message}`);this.persist();this.publish();throw error;}
 }
 close(){clearInterval(this.timer);this.persist();this.adapter.close();this.removeAllListeners();}
}
