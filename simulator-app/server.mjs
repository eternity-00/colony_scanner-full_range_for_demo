import {createServer} from 'node:http';
import {createReadStream,existsSync} from 'node:fs';
import {dirname,extname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.SIMULATOR_PORT||8792);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 const file=join(root,path==='/'?'index.html':path.replace(/^\//,''));
 if(!file.startsWith(root)||!existsSync(file)){res.writeHead(404);return res.end('Not found');}
 res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','cache-control':'no-store'});createReadStream(file).pipe(res);
}).listen(port,'127.0.0.1',()=>console.log(`Virtual Device Console: http://127.0.0.1:${port}`));
