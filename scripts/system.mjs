import {spawn} from 'node:child_process';
import {loadProfile} from '../server/profile.mjs';
// 실장비 프로필(testbed · production)은 LCD 서버만 띄운다. 가상 엔진·콘솔은 가상 프로필에서만(2차 피드백 #2).
const profile=loadProfile();
const files=profile.adapter==='virtual'?['simulator-app/engine.mjs','simulator-app/server.mjs','server/index.mjs']:['server/index.mjs'];
const children=files.map(f=>spawn(process.execPath,[f],{stdio:'inherit'}));
let closing=false;const stop=()=>{if(closing)return;closing=true;for(const child of children)child.kill('SIGTERM')};
for(const child of children)child.on('exit',code=>{if(!closing&&code){process.exitCode=code;stop()}});
process.on('SIGINT',stop);process.on('SIGTERM',stop);
