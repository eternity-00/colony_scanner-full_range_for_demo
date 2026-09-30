import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createReadStream,existsSync,statSync} from 'node:fs';
import {extname,join,normalize,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Controller} from './controller.mjs';
import {RemoteDeviceAdapter} from './remote-device.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const dataDir=resolve(process.env.COLONY_DATA_DIR||join(root,'data'));
const port=Number(process.env.PORT||8787);
const host=process.env.HOST||'127.0.0.1';
const controller=new Controller({dataDir,adapter:new RemoteDeviceAdapter({url:process.env.VIRTUAL_ENGINE_URL||'http://127.0.0.1:8790'})});
const clients=new Set();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json; charset=utf-8','.ico':'image/x-icon'};
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'content-type'};
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...cors});res.end(JSON.stringify(data));};
const body=async req=>{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1_000_000)throw Object.assign(new Error('요청이 너무 큽니다.'),{status:413,code:'TOO_LARGE'});}try{return raw?JSON.parse(raw):{};}catch{throw Object.assign(new Error('JSON 형식이 올바르지 않습니다.'),{status:400,code:'BAD_JSON'});}};
const sse=(res,state)=>res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
controller.on('state',state=>{for(const res of clients)sse(res,state);});

export const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='OPTIONS')return res.writeHead(204,cors).end();
  if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,mode:'external-device',engineConnected:controller.adapter.engineConnected,time:Date.now()});
  if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,controller.snapshot());
  if(req.method==='GET'&&url.pathname==='/api/events'){
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','x-accel-buffering':'no'});clients.add(res);sse(res,controller.snapshot());const keep=setInterval(()=>res.write(': keepalive\n\n'),15000);req.on('close',()=>{clearInterval(keep);clients.delete(res);});return;
  }
  if(req.method==='POST'&&url.pathname==='/api/exit'){const kiosk=process.env.COLONY_KIOSK==='1';json(res,200,{exiting:true,kiosk});if(kiosk)setTimeout(()=>{try{spawn('pkill',['-f',`user-data-dir=${process.env.COLONY_PROFILE||'/tmp/colony'}`]);}catch{}},200);return;}
  if(req.method==='POST'&&url.pathname==='/api/commands')return json(res,202,await controller.execute(await body(req)));
  if(req.method==='GET'&&url.pathname.startsWith('/api/images/')){
   const name=url.pathname.slice('/api/images/'.length);if(!/^[a-z0-9-]+\.png$/i.test(name))return json(res,400,{code:'INVALID_IMAGE',message:'잘못된 이미지 이름입니다.'});
   const file=join(dataDir,'images',name);if(!existsSync(file))return json(res,404,{code:'IMAGE_NOT_FOUND',message:'영상이 만료되었거나 없습니다.'});res.writeHead(200,{'content-type':'image/png','cache-control':'private, max-age=60',...cors});return createReadStream(file).pipe(res);
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{code:'METHOD_NOT_ALLOWED',message:'지원하지 않는 요청입니다.'});
  const dist=join(root,'dist');let rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));let file=normalize(join(dist,rel));if(!(file===dist||file.startsWith(dist+sep))||!existsSync(file)||statSync(file).isDirectory())file=join(dist,'index.html');
  if(!existsSync(file))return json(res,503,{code:'UI_NOT_BUILT',message:'npm run build를 먼저 실행하세요.'});res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':extname(file)==='.html'?'no-store':'public, max-age=31536000, immutable'});if(req.method==='HEAD')return res.end();createReadStream(file).pipe(res);
 }catch(error){json(res,error.status||500,{code:error.code||'INTERNAL_ERROR',message:error.status?error.message:'서버 처리 중 오류가 발생했습니다.'});}
});

if(process.env.NODE_ENV!=='test'){
 // 포트를 못 잡으면 죽는다. 화면에 못 나서는 서버가 살아 있으면, 보이지도 않는
 // 채로 엔진에 촬영을 걸고 state.json 을 덮어쓴다.
 server.on('error',error=>{console.error(`Colony Scanner LCD 기동 실패 · ${error.message}`);process.exit(1);});
 server.listen(port,host,()=>console.log(`Colony Scanner LCD: http://${host}:${port}`));
}
/*
 * 종료 — 열린 연결을 먼저 끊는다.
 * server.close() 의 콜백은 모든 연결이 닫혀야 불리는데, /api/events 는 끊지 않는
 * SSE 라서 영영 불리지 않았다. 그래서 kill 을 해도 프로세스가 남아, 다음 번에
 * 새로 띄운 서버와 함께 엔진을 폴링하고 촬영을 걸었다. 화면은 한 서버만 보는데
 * 장비는 여럿이 부리는 상태가 된다.
 */
const shutdown=()=>{
 server.closeAllConnections?.();
 server.close(()=>{controller.close();process.exit(0);});
 setTimeout(()=>process.exit(0),2000).unref();
};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
export {controller};
