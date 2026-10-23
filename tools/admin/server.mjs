// Colony Scanner 관리 툴 — 별도 프로세스.
//
// 장비 설정(펌웨어 파라미터, 레시피, 수동 조작, 카메라·정렬 보정, 진단)을 운영 화면이 아닌
// 여기서 한다. 장비는 직접 만지지 않는다: 모든 요청을 운영 앱의 /api/v1/maintenance/* 로
// 넘기고, 운영 앱이 유일한 UART 창구(device/mcb.py --serve)로 명령한다. 점검 모드 잠금도
// 운영 앱이 쥔다. 이 서버는 정적 화면 한 장과 프록시뿐이다.
//
//   node tools/admin/server.mjs            http://<파이>:8799  (COLONY_APP_URL 기본 http://127.0.0.1:8787)
import {createServer,request as httpRequest} from 'node:http';
import {createReadStream,existsSync,readFileSync} from 'node:fs';
import {extname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=resolve(fileURLToPath(new URL('.',import.meta.url)));
const root=resolve(here,'..','..');
const profileName=(process.env.COLONY_PROFILE||'testbed').trim();
let profilePorts={port:8787,adminPort:8799};
try{const p=JSON.parse(readFileSync(join(root,'profiles',`${profileName}.json`),'utf8'));profilePorts={...profilePorts,...(p.network||{})};}catch{}
const appUrl=new URL(process.env.COLONY_APP_URL||`http://127.0.0.1:${process.env.PORT||profilePorts.port}`);
const port=Number(process.env.ADMIN_PORT||profilePorts.adminPort||8799);
const host=process.env.ADMIN_HOST||'0.0.0.0';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8'};

const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/app/')){
  // transparent proxy to the operating app (same method, body and admin pin header)
  const target=new URL(url.pathname.slice(4)+url.search,appUrl);
  const up=httpRequest(target,{method:req.method,headers:{...req.headers,host:appUrl.host}},r=>{res.writeHead(r.statusCode||502,r.headers);r.pipe(res);});
  up.on('error',error=>{res.writeHead(502,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify({code:'APP_UNREACHABLE',message:`운영 앱(${appUrl})에 연결할 수 없습니다: ${error.message}`}));});
  req.pipe(up);return;
 }
 if(url.pathname==='/config.json'){res.writeHead(200,{'content-type':mime['.json'],'cache-control':'no-store'});res.end(JSON.stringify({app:appUrl.href,profile:profileName}));return;}
 const rel=url.pathname==='/'?'index.html':url.pathname.slice(1);
 const file=join(here,rel);
 if(!file.startsWith(here)||!existsSync(file)||rel.includes('..')||rel.endsWith('.mjs')){res.writeHead(404);res.end('not found');return;}
 res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':'no-store'});createReadStream(file).pipe(res);
});
server.listen(port,host,()=>console.log(`Colony Scanner Admin Tool: http://${host}:${port} -> ${appUrl.href} (${profileName})`));
const shutdown=()=>{server.closeAllConnections?.();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref();};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
