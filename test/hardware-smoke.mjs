#!/usr/bin/env node
// Real-device check of scanner 1 against the running app (Pi 4):
// clear the error state, capture one plate (MCB motion + 6 wells + mosaic), follow the
// stages and verify the run. Moves the real jig.
//   node test/hardware-smoke.mjs [slot]        default: highest slot of scanner 1
//   COLONY_URL=http://127.0.0.1:8787
import {randomUUID} from 'node:crypto';

const base=process.env.COLONY_URL||'http://127.0.0.1:8787';
const get=async p=>(await fetch(base+p)).json();
const command=async(command,args={})=>{
 const r=await fetch(base+'/api/commands',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({requestId:randomUUID().replaceAll('-',''),command,deviceId:1,args})});
 return {status:r.status,body:await r.json()};
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const fail=msg=>{console.error('FAIL',msg);process.exit(1);};

const health=await get('/api/health').catch(()=>fail(`app not reachable at ${base}`));
console.log('health',JSON.stringify(health));
let state=await get('/api/state');
const plates=state.plates.filter(p=>p.deviceId===1&&!p.removedAt).sort((a,b)=>b.slot-a.slot);
const slot=Number(process.argv[2])||plates[0]?.slot;
const plate=plates.find(p=>p.slot===slot)||fail(`no scanner 1 plate in slot ${slot}`);
const dev=()=>state.devices.find(d=>d.id===1);
if(dev().fault)console.log('clearError',JSON.stringify((await command('clearError')).body));

const started=Date.now(),r=await command('capture',{plateId:plate.id});
console.log('capture',plate.id,`slot ${slot}`,r.status,JSON.stringify(r.body));
if(r.status>=300)fail('capture refused (MCB link / device state)');
let last='';
for(;;){
 await sleep(1000);state=await get('/api/state');
 const j=dev().job||{},line=`${j.status} step ${j.step}${j.motionWaiting?' motion':''}${j.cameraWaiting?` camera well ${j.well??''}`:''}`;
 if(line!==last){console.log(`${((Date.now()-started)/1000).toFixed(0).padStart(4)} s  ${line}`);last=line;}
 if(['completed','failed'].includes(j.status))break;
 if(Date.now()-started>15*60000)fail('timeout');
}
const run=state.plates.find(p=>p.id===plate.id).runs.find(x=>x.requestId===r.body.requestId);
if(!run||run.imageState!=='held')fail(`run not held: ${JSON.stringify(run)}`);
const wells=run.capture?.wells||[];
if(wells.length!==6)fail(`expected 6 wells, got ${wells.length}`);
const img=await fetch(`${base}/api/images/${run.image}`);
if(!img.ok)fail(`mosaic ${run.image} not served`);
console.log('OK',JSON.stringify({plate:run.capture.plate,mosaic:`${run.capture.width}x${run.capture.height}`,
 wells:wells.map(w=>`${w.well}@${w.x},${w.y}`),seconds:Math.round((Date.now()-started)/1000)}));
