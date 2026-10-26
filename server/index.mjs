import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createReadStream,existsSync,statSync,readFileSync,writeFileSync,mkdirSync,readdirSync,renameSync} from 'node:fs';
import {networkInterfaces} from 'node:os';
import {extname,join,normalize,resolve,sep,basename,dirname} from 'node:path';
import {Controller} from './controller.mjs';
import {RemoteDeviceAdapter} from './remote-device.mjs';
import {LocalBaseAdapter} from './local-device.mjs';
import {RealCameraAdapter} from './real-camera-adapter.mjs';
import {CameraService} from './camera-service.mjs';
import {McbMotion,loadMcbConfig} from './mcb-motion.mjs';
import {AlignmentStore} from './alignment.mjs';
import {loadProfile,publicProfile,ROOT} from './profile.mjs';

// Deployment profile (COLONY_PROFILE=testbed|production|virtual): hardware, tray layout, recipe, ports.
const profile=loadProfile();
const root=ROOT;
const dataDir=profile.dataDirAbs;
const port=profile.network.port;
const host=profile.network.host;
// the python capture / MCB scripts read these from the environment
if(profile.camera?.device&&!process.env.COLONY_CAMERA_DEVICE)process.env.COLONY_CAMERA_DEVICE=profile.camera.device;
if(profile.mcb?.port&&!process.env.COLONY_MCB_PORT)process.env.COLONY_MCB_PORT=profile.mcb.port;
mkdirSync(dataDir,{recursive:true});

const real=profile.adapter==='real';
const camera=real?new CameraService():null;
// 실장비 프로필은 가상 엔진을 쓰지 않는다(2차 피드백 #2). 가상 프로필·개발·CI 에서만 외부 엔진에 붙는다.
const base=real?new LocalBaseAdapter():new RemoteDeviceAdapter({url:process.env.VIRTUAL_ENGINE_URL||`http://127.0.0.1:${profile.network.enginePort}`});
// Scanner 1 motors (MCB via the local Pi 4 UART): recipe file of the profile, disable with COLONY_MCB_ENABLED=0
const mcbConfig=(()=>{try{return loadMcbConfig(profile.recipeFile);}catch(error){console.log(JSON.stringify({recipe:'unreadable',file:profile.recipeFile,error:error.message}));return null;}})();
const motion=real&&process.env.COLONY_MCB_ENABLED!=='0'&&mcbConfig?.enabled?new McbMotion({config:mcbConfig,layout:profile.layout}):null;
if(motion&&mcbConfig.tiers!==profile.layout.tiers)console.log(JSON.stringify({warning:'recipe tiers differ from profile layout',recipe:mcbConfig.tiers,layout:profile.layout.tiers}));
// camera well-centre alignment state (calibration matrix, remembered well positions)
const alignment=motion?new AlignmentStore(process.env.COLONY_ALIGNMENT_FILE||join(dataDir,'camera-alignment.json')):null;
const adapter=real?new RealCameraAdapter({base,camera,dataDir,motion,alignment}):base;
const controller=new Controller({dataDir,adapter,profile});
controller.filesDir=camera?.directory||null;	// per-well previews for the run-to-run change score (A11)
// Build id of the UI bundle: the kiosk browser reloads itself when a new bundle is deployed (it keeps
// running across colony.service restarts, so without this it showed the old UI until a manual reload).
try{controller.build=(readFileSync(join(root,'dist','index.html'),'utf8').match(/index-([A-Za-z0-9_-]+)\.js/)||[])[1]||null;}catch{controller.build=null;}

// firmware parameters vs the profile's expected values (RANGE, USTEP ...): a warning, not a stop
let firmwareCheck={checkedAt:null,ok:null,mismatches:[]};
const checkFirmware=params=>{
 const mismatches=[];
 for(const [motor,expected] of Object.entries(profile.mcb?.expected||{}))for(const [key,value] of Object.entries(expected)){const actual=params?.[motor]?.[key];if(actual!==value)mismatches.push({motor:Number(motor),key,expected:value,actual:actual??null});}
 firmwareCheck={checkedAt:Date.now(),ok:mismatches.length===0,mismatches};
 if(mismatches.length)console.log(JSON.stringify({warning:'firmware parameters differ from profile',mismatches}));
};
motion?.refresh().then(p=>{console.log(JSON.stringify({mcb:'connected',motors:Object.keys(p).filter(m=>p[m].USED)}));checkFirmware(p);})
 .catch(error=>console.log(JSON.stringify({mcb:'offline',error:error.message})));
const mcbProbe=setInterval(()=>{
 if(motion&&!motion.busy&&!controller.maintenance&&!adapter.snapshot().some(d=>d.job&&['running','paused'].includes(d.job.status)))
  motion.refresh().then(p=>{checkFirmware(p);controller.publish();}).catch(()=>controller.publish());
},10000);mcbProbe.unref();

// wired / wireless link of the Pi itself (replaces the "238 Mbps" placeholder of the demo)
let wifi={ssid:null,checkedAt:null};
// 무선 SSID 표시(M3 A9 · 표시 수준): nmcli 가 있으면 30초마다 읽는다. WiFi 선택·비밀번호 입력은 OS 설정의 몫이다.
const readWifi=()=>{try{const child=spawn('nmcli',['-t','-f','ACTIVE,SSID','dev','wifi'],{stdio:['ignore','pipe','ignore']});let out='';child.stdout.on('data',b=>{out+=b;});child.on('error',()=>{});child.on('close',()=>{const line=out.split('\n').find(l=>l.startsWith('yes:'));wifi={ssid:line?line.slice(4):null,checkedAt:Date.now()};});}catch{}};
readWifi();const wifiTimer=setInterval(readWifi,30000);wifiTimer.unref();
const networkStatus=()=>{const out=[];for(const [name,list] of Object.entries(networkInterfaces()))for(const a of list||[])if(!a.internal&&a.family==='IPv4')out.push({name,address:a.address,kind:/^(wl|wlan)/.test(name)?'wifi':/^(eth|en)/.test(name)?'wired':'other',...(/^(wl|wlan)/.test(name)&&wifi.ssid?{ssid:wifi.ssid}:{})});return out;};
controller.extras=()=>({network:networkStatus(),firmwareCheck,hardware:{camera:camera?.hardware||null,mcb:motion?{enabled:true,connected:!!motion.machine,checkedAt:motion.checkedAt,error:motion.error||null,port:process.env.COLONY_MCB_PORT||'/dev/serial0'}:{enabled:false}}});

const clients=new Set();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json; charset=utf-8','.ico':'image/x-icon'};
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, PUT, OPTIONS','access-control-allow-headers':'content-type, x-admin-pin'};
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...cors});res.end(JSON.stringify(data));};
const fail=(message,status,code)=>Object.assign(new Error(message),{status,code});
const body=async req=>{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1_000_000)throw fail('요청이 너무 큽니다.',413,'TOO_LARGE');}try{return raw?JSON.parse(raw):{};}catch{throw fail('JSON 형식이 올바르지 않습니다.',400,'BAD_JSON');}};
const sse=(res,state)=>res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
controller.on('state',state=>{for(const res of clients)sse(res,state);});
const stream=(res,file,type)=>{res.writeHead(200,{'content-type':type,'cache-control':'no-store'});const s=createReadStream(file);s.on('error',()=>res.destroy());s.pipe(res);};

// ---- maintenance API (admin tool, tools/admin) ------------------------------------------
// Every call carries the admin PIN. Motor and recipe changes need the maintenance lock, which
// refuses to start while a job runs and blocks jobs / the scheduler while it is held.
const paramsDir=join(dataDir,'mcb-params');
const PARAM_KEYS=['USED','RANGE','HDIR','HACTIVE','HFAST','HSLOW','HMARGIN','HMAX','HPARK','SPEED','MAXSPEED','START','ACCEL','BACCEL','RESLO','RESHI','HDECEL','HOVER','USTEP','SMOOTH'];
const requirePin=req=>{if((req.headers['x-admin-pin']||'')!==controller.adminPin)throw fail('관리자 PIN 이 필요합니다.',401,'ADMIN_PIN');};
const requireMaintenance=()=>{if(!controller.maintenance)throw fail('점검 모드가 아닙니다. 먼저 점검 모드로 들어가세요.',409,'NOT_IN_MAINTENANCE');};
const requireMotion=()=>{if(!motion)throw fail('이 프로필에는 MCB 모션이 없습니다.',501,'NO_MOTION');};
const validateRecipe=config=>{
 const probe=new McbMotion({config,layout:profile.layout});	// throws on missing keys
 const problems=[];
 for(const key of ['tiers','wellColumns','wellRows','trayOut','captureZ'])if(!Number.isInteger(config[key])||config[key]<0)problems.push(`${key}: 0 이상의 정수여야 합니다`);
 if(config.tiers!==profile.layout.tiers)problems.push(`tiers(${config.tiers})가 프로필 layout.tiers(${profile.layout.tiers})와 다릅니다`);
 if(config.captureZ>(profile.limits?.captureZMax??Infinity))problems.push(`captureZ ${config.captureZ} > 프로필 상한 ${profile.limits.captureZMax} (트레이 아래 간섭 확인 전)`);
 if(config.wellDiameterMm!==undefined&&!(config.wellDiameterMm>0))problems.push('wellDiameterMm: 양수여야 합니다');
 if(motion?.machine){
  const ax=config.axes||{};const m=motion.machine;
  const within=(axis,full)=>{const p=m[ax[axis]];if(!p)return `axes.${axis}: 모터 ${ax[axis]} 파라미터 없음`;const steps=full*(p.USTEP||1);if(Math.abs(steps)>Math.abs(p.RANGE))return `${axis}: ${full} 풀스텝(${steps} step)이 RANGE ${p.RANGE} 를 넘습니다`;return null;};
  for(const [axis,full] of [['trayX',config.trayOut],['trayZ',config.captureZ]]){const e=within(axis,full);if(e)problems.push(e);}
  for(const axis of ['cameraX','trayX','cameraY','trayZ']){try{probe.machine=m;probe.speedOf(axis);}catch(error){problems.push(error.message);}}
 }
 return problems;
};
const recipeHistoryDir=join(dirname(profile.recipeFile),'history');
async function maintenance(req,res,url){
 requirePin(req);
 const path=url.pathname.slice('/api/v1/maintenance/'.length);
 if(req.method==='GET'&&path==='status')return json(res,200,{maintenance:controller.maintenance,profile:publicProfile(profile),recipeFile:profile.recipe,mcb:motion?{connected:!!motion.machine,checkedAt:motion.checkedAt,error:motion.error||null,params:motion.machine,busy:motion.busy}:null,camera:camera?.snapshot()||null,firmwareCheck,adminPort:profile.network.adminPort});
 if(req.method==='POST'&&path==='enter'){const b=await body(req);return json(res,200,controller.enterMaintenance(String(b.by||'admin-tool').slice(0,40)));}
 if(req.method==='POST'&&path==='exit'){controller.exitMaintenance();return json(res,200,{maintenance:null});}
 if(req.method==='GET'&&path==='profile')return json(res,200,{profile,firmwareCheck,recipe:mcbConfig,layout:controller.layout});
 if(req.method==='GET'&&path==='recipe')return json(res,200,{file:profile.recipe,config:motion?.config||mcbConfig,limits:profile.limits,machine:motion?.machine||null,history:existsSync(recipeHistoryDir)?readdirSync(recipeHistoryDir).sort().reverse().slice(0,20):[]});
 if(req.method==='POST'&&path==='recipe/validate'){const b=await body(req);try{return json(res,200,{problems:validateRecipe(b.config||{})});}catch(error){return json(res,200,{problems:[error.message]});}}
 if(req.method==='PUT'&&path==='recipe'){
  requireMaintenance();const b=await body(req);const config=b.config;if(!config||typeof config!=='object')throw fail('config 객체가 필요합니다.',400,'INVALID_RECIPE');
  let problems;try{problems=validateRecipe(config);}catch(error){problems=[error.message];}
  if(problems.length&&!b.force)return json(res,422,{code:'INVALID_RECIPE',message:'레시피 검증 실패',problems});
  mkdirSync(recipeHistoryDir,{recursive:true});const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  if(existsSync(profile.recipeFile))writeFileSync(join(recipeHistoryDir,`${basename(profile.recipeFile,'.json')}.${stamp}.json`),readFileSync(profile.recipeFile));
  const tmp=profile.recipeFile+'.tmp';writeFileSync(tmp,JSON.stringify(config,null,1));renameSync(tmp,profile.recipeFile);
  if(motion)motion.config=config;controller.log('WARN',`레시피 저장 (${basename(profile.recipeFile)}) · 관리 툴`);controller.publish();
  return json(res,200,{saved:profile.recipe,problems,backup:`${basename(profile.recipeFile,'.json')}.${stamp}.json`});
 }
 if(req.method==='POST'&&path==='mcb'){
  requireMaintenance();const b=await body(req);
  const steps=Array.isArray(b.steps)?b.steps:[];if(!steps.length||steps.length>40)throw fail('steps 는 1~40개여야 합니다.',400,'INVALID_STEPS');
  for(const s of steps)if(typeof s!=='string'||!/^[A-Z0-9 +-]{1,100}$/i.test(s))throw fail(`허용되지 않는 명령: ${String(s).slice(0,40)}`,400,'INVALID_STEP');
  requireMotion();
  if(motion.refreshing)await motion.refreshing.catch(()=>{});
  const result=await motion.run(steps.map(s=>s.toUpperCase()),Math.min(Math.max(Number(b.timeout)||120,1),600));
  if(result.params)checkFirmware(result.params);
  controller.log('INFO',`관리 툴 MCB: ${steps.join(' / ').slice(0,200)}`);
  return json(res,200,result);
 }
 if(req.method==='POST'&&path==='mcb/stop'){requireMotion();await motion.stop();return json(res,200,{stopped:true});}
 if(req.method==='GET'&&path==='params/backups'){mkdirSync(paramsDir,{recursive:true});return json(res,200,{dir:paramsDir,files:readdirSync(paramsDir).filter(f=>f.endsWith('.json')).sort().reverse()});}
 if(req.method==='GET'&&/^params\/backups\/[A-Za-z0-9._-]+\.json$/.test(path)){const f=join(paramsDir,basename(path));if(!existsSync(f))throw fail('백업 파일이 없습니다.',404,'NOT_FOUND');return json(res,200,JSON.parse(readFileSync(f,'utf8')));}
 if(req.method==='POST'&&path==='params/backup'){
  requireMotion();if(motion.refreshing)await motion.refreshing.catch(()=>{});
  const r=await motion.run(['PARAMS'],10);mkdirSync(paramsDir,{recursive:true});
  const b=await body(req);const file=`mcb-params.${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  writeFileSync(join(paramsDir,file),JSON.stringify({savedAt:Date.now(),profile:profile.name,note:String(b.note||'').slice(0,200),params:r.params},null,1));
  checkFirmware(r.params);return json(res,200,{file,params:r.params});
 }
 if(req.method==='POST'&&path==='params/restore'){
  requireMaintenance();requireMotion();const b=await body(req);const f=join(paramsDir,basename(String(b.file||'')));if(!existsSync(f))throw fail('백업 파일이 없습니다.',404,'NOT_FOUND');
  const saved=JSON.parse(readFileSync(f,'utf8')).params||{};const steps=[];
  for(const [motor,values] of Object.entries(saved))for(const key of PARAM_KEYS)if(values[key]!==undefined&&Number.isInteger(values[key]))steps.push(`SET ${motor} ${key} ${values[key]}`);
  if(b.save)steps.push('SAVE');steps.push('PARAMS');
  const result=await motion.run(steps,60);if(result.params)checkFirmware(result.params);
  controller.log('WARN',`관리 툴: 파라미터 복원 ${basename(f)}${b.save?' + SAVE':''}`);return json(res,200,result);
 }
 throw fail('지원하지 않는 점검 요청입니다.',404,'NOT_FOUND');
}

export const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='OPTIONS')return res.writeHead(204,cors).end();
  if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,mode:real?'local-hardware':'external-device',profile:profile.name,engineConnected:controller.adapter.engineConnected,maintenance:!!controller.maintenance,time:Date.now()});
  if(url.pathname.startsWith('/api/v1/maintenance/'))return await maintenance(req,res,url);
  if(req.method==='GET'&&url.pathname==='/api/v1/hardware/status')return json(res,200,{camera:camera?.snapshot()||null,mcb:motion?{enabled:true,connected:!!motion.machine,checkedAt:motion.checkedAt,error:motion.error||null,port:process.env.COLONY_MCB_PORT||'/dev/serial0'}:{enabled:false},acquisition:real?'local-usb':'virtual',profile:profile.name});
  if(req.method==='POST'&&url.pathname==='/api/v1/hardware/capture'){
   if(!camera)throw fail('이 프로필에는 카메라가 없습니다.',501,'NO_CAMERA');
   if(controller.snapshot().devices.some(d=>d.job&&['running','paused'].includes(d.job.status)))throw fail('장비 작업 중에는 단일 카메라 점검을 할 수 없습니다.',409,'DEVICE_BUSY');
   const args=await body(req);return json(res,202,camera.capture(args.format||'YUYV'));
  }
  if(req.method==='GET'&&/^\/api\/v1\/hardware\/focus\/(full|crop)\.jpg$/.test(url.pathname)){
   if(!camera)return json(res,404,{code:'NO_CAMERA',message:'카메라가 없습니다.'});
   const file=join(camera.directory,`focus-${url.pathname.endsWith('full.jpg')?'full':'crop'}.jpg`);
   if(!existsSync(file))return json(res,404,{code:'FOCUS_IMAGE_NOT_FOUND',message:'초점 영상이 아직 없습니다.'});
   return stream(res,file,'image/jpeg');
  }
  if(req.method==='GET'&&url.pathname.startsWith('/api/v1/hardware/files/')){
   const name=url.pathname.slice('/api/v1/hardware/files/'.length);
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-preview)?\.(png|jpg|yuy2|json)$/.test(name))return json(res,400,{code:'INVALID_CAMERA_FILE',message:'잘못된 영상 파일명입니다.'});
   if(!camera)return json(res,404,{code:'NO_CAMERA',message:'카메라가 없습니다.'});
   const file=join(camera.directory,name);
   if(!existsSync(file))return json(res,404,{code:'IMAGE_NOT_FOUND',message:'영상 파일이 없습니다.'});
   const ext=extname(name),headers={'content-type':mime[ext]||'application/octet-stream','cache-control':'no-store'};
   if(ext==='.yuy2')headers['content-disposition']=`attachment; filename="${name}"`;
   res.writeHead(200,headers);const s=createReadStream(file);s.on('error',()=>res.destroy());s.pipe(res);return;
  }
  // PC 전송 서버 연결 점검(A8): 설정된 주소로 TCP 연결을 시도한 결과를 돌려준다.
  if(req.method==='POST'&&url.pathname==='/api/v1/network/check')return json(res,200,await controller.checkServer());
  // PC 판독 결과 수신(A15): {plateId|barcode, result: positive|negative|contaminated|null, note?} + x-api-key.
  if(req.method==='POST'&&url.pathname==='/api/v1/results'){
   const key=controller.db.settings.server.apiKey||process.env.COLONY_RESULT_KEY||'';
   if(!key)throw fail('판독 결과 수신 API 키가 설정되지 않았습니다(사용자 설정 → 외부 연결).',503,'RESULT_KEY_UNSET');
   if((req.headers['x-api-key']||'')!==key)throw fail('API 키가 올바르지 않습니다.',401,'BAD_API_KEY');
   const b=await body(req);const deviceId=Number(b.deviceId)||1;
   return json(res,202,await controller.execute({requestId:String(b.requestId||randomUUID()),command:'plateResult',deviceId,args:{plateId:b.plateId,barcode:b.barcode,result:b.result??null,...(b.note!==undefined?{note:b.note}:{})}},'pc'));
  }
  if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,controller.snapshot());
  if(req.method==='GET'&&url.pathname==='/api/events'){
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','x-accel-buffering':'no'});clients.add(res);sse(res,controller.snapshot());const keep=setInterval(()=>res.write(': keepalive\n\n'),15000);req.on('close',()=>{clearInterval(keep);clients.delete(res);});return;
  }
  if(req.method==='POST'&&url.pathname==='/api/exit'){const kiosk=process.env.COLONY_KIOSK==='1';json(res,200,{exiting:true,kiosk});if(kiosk)setTimeout(()=>{try{spawn('pkill',['-f',`user-data-dir=${process.env.COLONY_PROFILE_DIR||'/tmp/colony-kiosk'}`]);}catch{}},200);return;}
  if(req.method==='POST'&&url.pathname==='/api/commands')return json(res,202,await controller.execute(await body(req)));
  if(req.method==='GET'&&url.pathname.startsWith('/api/images/')){
   const name=url.pathname.slice('/api/images/'.length);if(!/^[a-z0-9-]+\.png$/i.test(name))return json(res,400,{code:'INVALID_IMAGE',message:'잘못된 이미지 이름입니다.'});
   const file=join(dataDir,'images',name);if(!existsSync(file))return json(res,404,{code:'IMAGE_NOT_FOUND',message:'영상이 만료되었거나 없습니다.'});res.writeHead(200,{'content-type':'image/png','cache-control':'private, max-age=60',...cors});return createReadStream(file).pipe(res);
  }
  if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{code:'METHOD_NOT_ALLOWED',message:'지원하지 않는 요청입니다.'});
  const dist=join(root,'dist');let rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));let file=normalize(join(dist,rel));if(!(file===dist||file.startsWith(dist+sep))||!existsSync(file)||statSync(file).isDirectory())file=join(dist,'index.html');
  if(!existsSync(file))return json(res,503,{code:'UI_NOT_BUILT',message:'npm run build를 먼저 실행하세요.'});res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':extname(file)==='.html'?'no-store':'public, max-age=31536000, immutable'});if(req.method==='HEAD')return res.end();createReadStream(file).pipe(res);
 }catch(error){json(res,error.status||500,{code:error.code||'INTERNAL_ERROR',message:error.status?error.message:'서버 처리 중 오류가 발생했습니다.',...(error.problems?{problems:error.problems}:{})});if(!error.status)console.error(error);}
});

if(process.env.NODE_ENV!=='test'){
 server.on('error',error=>{console.error(`Colony Scanner LCD 기동 실패 · ${error.message}`);process.exit(1);});
 server.listen(port,host,()=>console.log(`Colony Scanner LCD (${profile.name}): http://${host}:${port}`));
}
const shutdown=()=>{clearInterval(mcbProbe);clearInterval(wifiTimer);camera?.dispose();controller.close();for(const res of clients)res.end();server.closeAllConnections?.();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
export {controller,profile};
