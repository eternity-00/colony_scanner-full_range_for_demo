import {spawn} from 'node:child_process';
const children=[
 spawn(process.execPath,['simulator-app/engine.mjs'],{stdio:'inherit'}),
 spawn(process.execPath,['simulator-app/server.mjs'],{stdio:'inherit'}),
 spawn(process.execPath,['server/index.mjs'],{stdio:'inherit',env:{...process.env,PORT:'8787'}}),
 spawn(process.platform==='win32'?'npm.cmd':'npm',['run','vite'],{stdio:'inherit'})
];
let closing=false;const stop=()=>{if(closing)return;closing=true;for(const child of children)child.kill('SIGTERM');};
for(const child of children)child.on('exit',code=>{if(!closing&&code){process.exitCode=code;stop();}});
process.on('SIGINT',stop);process.on('SIGTERM',stop);
