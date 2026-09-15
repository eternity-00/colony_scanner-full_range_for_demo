import {EventEmitter} from 'node:events';
import {DeviceError} from './virtual-device.mjs';

const offlineDevices=()=>Array.from({length:4},(_,i)=>({id:i+1,name:`SCANNER ${i+1}`,connected:false,pcConnected:false,doorOpen:false,fault:'ENGINE_OFFLINE',failCamera:false,temperature:0,co2:0,targetTemperature:37,targetCo2:5,z:0,light:false,heater:false,job:null}));

export class RemoteDeviceAdapter extends EventEmitter {
 constructor({url='http://127.0.0.1:8790',pollMs=150}={}){
  super();this.url=url.replace(/\/$/,'');this.devices=offlineDevices();this.engineConnected=false;this.closed=false;
  this.poll();this.timer=setInterval(()=>this.poll(),pollMs);this.timer.unref();
 }
 snapshot(){return structuredClone(this.devices);}
 get(id){const d=this.devices.find(x=>x.id===id);if(!d)throw new DeviceError('INVALID_DEVICE','스캐너 번호는 1~4여야 합니다.',400);return d;}
 async request(path,body){
  try{const res=await fetch(`${this.url}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new DeviceError(data.code||'ENGINE_ERROR',data.message||'가상장비 명령이 거부됐습니다.',res.status);return data;}
  catch(error){if(error instanceof DeviceError)throw error;throw new DeviceError('ENGINE_OFFLINE','외부 가상장비 엔진에 연결할 수 없습니다.',503);}
 }
 async command(id,type,args={},requestId){const out=await this.request('/api/device/command',{id,type,args,requestId});await this.poll();return out;}
 async inject(id,patch,requestId){const out=await this.request('/api/device/input',{id,patch,requestId});await this.poll();return out;}
 async environment(args,requestId){const out=await this.request('/api/environment',{...args,requestId});await this.poll();return out;}
 async poll(){
  if(this.polling||this.closed)return;this.polling=true;
  try{
   const res=await fetch(`${this.url}/api/state`);if(!res.ok)throw Error();const next=(await res.json()).devices;const before=this.devices;
   this.engineConnected=true;this.devices=next;
   for(const d of next){const old=before.find(x=>x.id===d.id),status=d.job?.status;if(status&&status!==old?.job?.status&&['completed','failed'].includes(status))this.emit('event',{type:`job.${status}`,deviceId:d.id,at:Date.now(),requestId:d.job.requestId,job:structuredClone(d.job),transferred:d.pcConnected,code:d.fault,message:d.job.error});}
   this.emit('change');
  }catch{
   if(this.engineConnected){this.devices=offlineDevices();this.engineConnected=false;this.emit('change');}
  }finally{this.polling=false;}
 }
 close(){this.closed=true;clearInterval(this.timer);this.removeAllListeners();}
}
