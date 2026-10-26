import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
/** 스캐너 수. LCD 하나가 스캐너 한 대를 맡는다(2차 피드백). 테스트는 SCANNER_COUNT 로 늘려 쓴다. */
export const SCANNER_COUNT=Math.max(1,Number(process.env.SCANNER_COUNT)||1);
export const STAGES=['이송','물기 제거','촬영','수납 복귀','전송','PC 저장'];
export class DeviceError extends Error { constructor(code,message,status=409){super(message);this.code=code;this.status=status;} }
export class VirtualDeviceAdapter extends EventEmitter {
 constructor({stageMs=1600,config=[]}={}){
  super();this.stageMs=stageMs;
  this.devices=Array.from({length:SCANNER_COUNT},(_,i)=>({id:i+1,name:`SCANNER ${i+1}`,connected:true,pcConnected:true,doorOpen:false,fault:null,failCamera:false,temperature:37,humidity:85,targetTemperature:37,z:0,light:false,heater:false,job:null,...config[i],id:i+1,job:null,light:false,heater:false,z:0}));
 }
 snapshot(){return structuredClone(this.devices);}
 get(id){const d=this.devices.find(d=>d.id===id);if(!d)throw new DeviceError('INVALID_DEVICE','스캐너 번호는 1~4여야 합니다.',400);return d;}
 event(type,d,payload={}){this.emit('event',{type,deviceId:d.id,at:Date.now(),requestId:d.job?.requestId??null,...payload});}
 command(id,type,args={},requestId){
  const d=this.get(id),active=d.job&&['running','paused'].includes(d.job.status);
  if(!d.connected)throw new DeviceError('DEVICE_OFFLINE','가상장비 연결이 끊어졌습니다.');
  if(type==='stop') {if(!active)throw new DeviceError('NO_JOB','진행 중인 작업이 없습니다.');this.fail(d,'ESTOP','비상 정지');return;}
  if(type==='pause'||type==='resume'){
   if(!active)throw new DeviceError('NO_JOB','진행 중인 작업이 없습니다.');
   if(type==='resume'&&(d.fault||d.doorOpen))throw new DeviceError('INTERLOCK','도어 또는 오류 상태를 먼저 해제하세요.');
   d.job.status=type==='pause'?'paused':'running';d.light=false;d.heater=false;this.event(`job.${d.job.status}`,d);return;
  }
  if(active)throw new DeviceError('DEVICE_BUSY','스캐너가 작업 중입니다.');
  if(type==='clearError'){if(d.doorOpen)throw new DeviceError('DOOR_OPEN','도어를 먼저 닫으세요.');d.fault=null;this.event('device.recovered',d,{requestId});return;}
  if(d.fault)throw new DeviceError('DEVICE_FAULT',`장비 오류: ${d.fault}`);
  if(d.doorOpen)throw new DeviceError('DOOR_OPEN','도어가 열려 있습니다.');
  if(!['capture','home','calibrate','reset'].includes(type))throw new DeviceError('UNKNOWN_COMMAND','지원하지 않는 장비 명령입니다.',400);
  d.job={id:randomUUID(),type,plateId:args.plateId??null,slot:args.slot??null,requestId,status:'running',step:0,progress:0,elapsed:0,startedAt:Date.now(),finishedAt:null,error:null,...(args.trial?{trial:true}:{}),...(args.wellShots?{wellShots:args.wellShots}:{})};
  this.event('job.started',d,{operation:type});
 }
 fail(d,code,message){
  if(!d.job||!['running','paused'].includes(d.job.status))return;
  d.job.status='failed';d.job.error=message;d.job.finishedAt=Date.now();d.light=false;d.heater=false;d.fault=code;
  this.event('job.failed',d,{code,message,job:structuredClone(d.job)});
 }
 inject(id,patch,requestId){
  const d=this.get(id),allowed=['connected','pcConnected','doorOpen','failCamera'],numeric=['temperature','humidity'];
  for(const key of allowed)if(key in patch){if(typeof patch[key]!=='boolean')throw new DeviceError('INVALID_VALUE',`${key} 값은 boolean이어야 합니다.`,400);}
  // environment injection (tests / alarm trials): the value sticks until the next injection or holdEnvironment:false
  for(const key of numeric)if(key in patch){if(!Number.isFinite(patch[key])&&patch[key]!==null)throw new DeviceError('INVALID_VALUE',`${key} 값은 숫자여야 합니다.`,400);d.holdEnvironment=patch[key]!==null;}
  if('holdEnvironment' in patch){d.holdEnvironment=!!patch.holdEnvironment;delete patch.holdEnvironment;}
  if('fault' in patch&&!['Z_LIMIT','HEATER',null].includes(patch.fault))throw new DeviceError('INVALID_FAULT','지원하지 않는 오류입니다.',400);
  if(!Object.keys(patch).length||Object.keys(patch).some(key=>![...allowed,...numeric,'fault'].includes(key)))throw new DeviceError('INVALID_INPUT','지원하지 않는 가상 입력입니다.',400);
  Object.assign(d,patch);
  if(!d.connected)this.fail(d,'DISCONNECTED','장비 연결 끊김');
  else if(d.doorOpen)this.fail(d,'DOOR_OPEN','도어 인터록 작동');
  else if(d.fault)this.fail(d,d.fault,'가상 오류 입력');
  this.event('simulator.input',d,{requestId,patch});
 }
 tick(ms){
  for(const d of this.devices){
   if(!d.connected)continue;
   if(!d.holdEnvironment)d.temperature=Math.round((d.temperature+(d.targetTemperature-d.temperature)*.07+Math.sin(Date.now()/8000+d.id)*.006)*100)/100;
   if(!d.holdEnvironment)d.humidity=Math.round((d.humidity+(85-d.humidity)*.05+Math.sin(Date.now()/11000+d.id)*.05)*100)/100;
   const j=d.job;if(!j||j.status!=='running')continue;
   j.elapsed+=ms;const stages=j.type==='capture'?6:3;
   const step=Math.min(stages-1,Math.floor(j.elapsed/this.stageMs));
   if(step!==j.step){j.step=step;this.event('job.stage',d,{step,label:j.type==='capture'?STAGES[step]:['준비','구동','완료 확인'][step]});}
   j.progress=Math.min(100,Math.floor(j.elapsed/(stages*this.stageMs)*100));
   d.z=j.type==='capture'&&step<3?Math.round((j.slot||1)*4+Math.min(j.elapsed/this.stageMs,1)*10):Math.max(0,d.z-4);
   d.light=j.type==='capture'&&step===2;d.heater=j.type==='capture'&&step===1;
   if(j.type==='capture'&&step===2&&d.failCamera){this.fail(d,'CAMERA_TIMEOUT','가상 카메라 응답 시간 초과');continue;}
   if(j.elapsed>=stages*this.stageMs){j.status='completed';j.finishedAt=Date.now();j.progress=100;d.z=0;d.light=false;d.heater=false;this.event('job.completed',d,{job:structuredClone(j),transferred:d.pcConnected});}
  }
 }
 close(){this.removeAllListeners();}
}
