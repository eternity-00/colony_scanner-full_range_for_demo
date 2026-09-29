import {createServer} from 'node:http';
import {VirtualDeviceAdapter} from '../server/virtual-device.mjs';

const port=Number(process.env.VIRTUAL_ENGINE_PORT||8790),host='127.0.0.1';
const adapter=new VirtualDeviceAdapter({stageMs:Number(process.env.STAGE_MS||1600)});
const io=[];const record=(direction,type,deviceId,requestId,payload)=>{io.unshift({id:crypto.randomUUID(),at:Date.now(),direction,type,deviceId,requestId,payload});io.splice(150)};
adapter.on('event',event=>record('RX',event.type,event.deviceId,event.requestId,event));
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type'};
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...cors});res.end(JSON.stringify(data));};
const body=async req=>{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1_000_000)throw Object.assign(new Error('요청이 너무 큽니다.'),{status:413,code:'TOO_LARGE'});}try{return raw?JSON.parse(raw):{};}catch{throw Object.assign(new Error('JSON 형식이 올바르지 않습니다.'),{status:400,code:'BAD_JSON'});}};
const timer=setInterval(()=>adapter.tick(100),100);
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');if(req.method==='OPTIONS')return res.writeHead(204,cors).end();
  if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,mode:'external-virtual-engine',time:Date.now()});
  if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,{time:Date.now(),devices:adapter.snapshot(),io:structuredClone(io)});
  if(req.method==='POST'&&url.pathname==='/api/device/command'){const x=await body(req);record('TX',x.type,x.id,x.requestId,x.args);adapter.command(x.id,x.type,x.args,x.requestId);record('RX','ACK',x.id,x.requestId,{accepted:true});return json(res,202,{accepted:true});}
  if(req.method==='POST'&&url.pathname==='/api/device/input'){const x=await body(req);record('TX','sim.input',x.id,x.requestId,x.patch);adapter.inject(x.id,x.patch,x.requestId);record('RX','ACK',x.id,x.requestId,{accepted:true});return json(res,202,{accepted:true});}
  if(req.method==='POST'&&url.pathname==='/api/environment'){const x=await body(req);record('TX','environment',0,x.requestId,{temperature:x.temperature,co2:x.co2});for(const d of adapter.devices){d.targetTemperature=x.temperature;d.targetCo2=x.co2;}record('RX','ACK',0,x.requestId,{accepted:true});return json(res,202,{accepted:true});}
  return json(res,404,{code:'NOT_FOUND',message:'지원하지 않는 엔진 경로입니다.'});
 }catch(error){json(res,error.status||500,{code:error.code||'ENGINE_ERROR',message:error.message||'엔진 오류'});}
});
server.listen(port,host,()=>console.log(`Virtual Device Engine: http://${host}:${port}`));
// 연결을 먼저 끊지 않으면 server.close() 의 콜백이 불리지 않아 프로세스가 남는다.
const shutdown=()=>{server.closeAllConnections?.();server.close(()=>{clearInterval(timer);adapter.close();process.exit(0);});setTimeout(()=>process.exit(0),2000).unref();};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
