import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Motor control of scanner 1 through the local Pi 4 agent (local_agent.py "mcb" -> UART -> MCB board).
// mcb-config.json holds the process recipe only: which motor does what (axes), tiers, the
// 6-well grid, tray out position and capture height. Ranges and park positions are read
// from the MCB firmware (PARAMS = GET ALL) before every job, which also checks the link.
// One 6-well plate per tier: the Z range is split into `tiers`, the wells are a
// wellColumns x wellRows grid over the camera X x camera Y ranges, numbered row by row
// (well 1..3 = row 1, 4..6 = row 2) and captured in a snake order.
// Speeds / accelerations / resonance band are firmware parameters too (GET / SET / SAVE);
// moves use the firmware default speed unless speedHz is set.
// Recipe distances (trayOut, captureZ) and speedHz are in full steps; the MCB counts
// microsteps, so they are multiplied by the motor's USTEP (1 when the firmware has none).
export function loadMcbConfig(file){
 return JSON.parse(readFileSync(file,'utf8'));
}

// centre of section k (1..n) of the span [from, to]
const centre=([from,to],n,k)=>Math.round(from+(to-from)*(k-0.5)/n);

export class McbMotion {
 constructor({config,layout=null,runner=fileURLToPath(new URL('../device/local_agent.py',import.meta.url)),sessionScript=fileURLToPath(new URL('../device/mcb.py',import.meta.url))}){
  for(const key of ['axes','tiers','wellColumns','wellRows','trayOut','captureZ'])
   if(config[key]===undefined)throw Error(`mcb-config.json: ${key} missing`);
  for(const axis of ['cameraX','trayX','cameraY','trayZ'])
   if(!Number.isInteger(config.axes[axis]))throw Error(`mcb-config.json: axes.${axis} missing`);
  this.config=config;this.runner=runner;this.active=false;this.session=null;this.machine=null;this.checkedAt=null;
  // tray layout of the UI: slot -> tier. Plates per tier (columns) comes from the deployment profile; the recipe's tiers wins for Z.
  this.layout={tiers:config.tiers,columns:3,...(layout||{})};this.layout.slots=this.layout.tiers*this.layout.columns;
  this.sessionScript=sessionScript;
 }
 get busy(){return this.active;}
 // Read ranges / homing from the firmware; throws when the MCB  does not answer.
 refresh(){
  if(this.refreshing)return this.refreshing;
  this.refreshing=(async()=>{
   try{
    const r=await this.run(['PARAMS'],5);
    const ax=this.config.axes,p=r.params||{};
    for(const m of Object.values(ax))if(!p[m]?.USED)throw Error(`MCB 모터 ${m} 사용 안 함 (USED=0)`);
    this.machine=p;this.error=null;return p;
   }catch(error){this.machine=null;this.error=error.message;throw error;}
   finally{this.checkedAt=Date.now();}
  })().finally(()=>{this.refreshing=null;});
  return this.refreshing;
 }
 motor(axis){return this.config.axes[axis];}
 span(axis){const m=this.motor(axis);if(!this.machine)throw Error('MCB 파라미터를 읽지 않았습니다');return [0,this.machine[m].RANGE];}
 parkOf(axis){const m=this.motor(axis),p=this.machine[m];return p.HDIR*p.HPARK;}
 // App tray: slot 1..24 -> tier 8 - floor((slot-1)/3) (1 = bottom); the app's 3 columns of a
 // tier all map to the one plate of that tier.
 tierOf(slot){return this.layout.tiers-Math.floor(((slot||1)-1)/this.layout.columns);}
 // Tier 1 is at the far end of the Z range (Z = 0 at the home sensor is tier 8's side).
 tierZ(slot){const n=this.config.tiers;return centre(this.span('trayZ'),n,n+1-this.tierOf(slot));}
 get wells(){return this.config.wellColumns*this.config.wellRows;}
 // well 1..n -> {col,row,x,y}
 wellPos(well){
  const c=this.config,col=(well-1)%c.wellColumns+1,row=Math.floor((well-1)/c.wellColumns)+1;
  return {col,row,x:centre(this.span('cameraX'),c.wellColumns,col),y:centre(this.span('cameraY'),c.wellRows,row)};
 }
 // capture order: row 1 left to right, row 2 right to left, ... (shortest camera path)
 wellOrder(){
  const c=this.config,order=[];
  for(let r=0;r<c.wellRows;r++){const row=Array.from({length:c.wellColumns},(_,k)=>r*c.wellColumns+k+1);order.push(...(r%2?row.reverse():row));}
  return order;
 }
 // Camera target of a well: its grid position plus a remembered alignment offset, kept inside the axis ranges.
 wellTarget(well,offset={x:0,y:0}){const p=this.wellPos(well);return this.clampXY({x:p.x+(offset?.x||0),y:p.y+(offset?.y||0)});}
 clampXY({x,y}){
  const [x0,x1]=this.span('cameraX'),[y0,y1]=this.span('cameraY');
  return {x:Math.round(Math.min(Math.max(x,Math.min(x0,x1)),Math.max(x0,x1))),y:Math.round(Math.min(Math.max(y,Math.min(y0,y1)),Math.max(y0,y1)))};
 }
 // well pitch of an axis in MCB steps (the grid spacing of the recipe)
 pitch(axis){const [a,b]=this.span(axis);return Math.abs(b-a)/(axis==='cameraX'?this.config.wellColumns:this.config.wellRows);}
 xySteps({x,y}){return [{parallel:[this.move('cameraX',x),this.move('cameraY',y)]}];}
 // Pre-position so that the final move onto `target` runs in the approach direction of each
 // axis (the calibration's probe direction). `from`: the position the camera leaves, when it was
 // itself reached in the approach direction; an axis that keeps moving that way needs no pre-travel.
 approachFrom(target,approach,from=null){
  if(!approach)return null;
  const pre={...target};
  for(const key of ['x','y']){
   const sign=approach[key]?.sign||0,steps=approach[key]?.steps||0;
   if(!sign||!steps)continue;
   if(from&&(target[key]-from[key])*sign>=0)continue;
   pre[key]=target[key]-sign*steps;
  }
  const clamped=this.clampXY(pre);
  return clamped.x===target.x&&clamped.y===target.y?null:clamped;
 }
 // Steps for the move plus whether, afterwards, every axis can be trusted to have arrived in its
 // approach direction (false when a range end swallowed the pre-travel or the start is unknown).
 approachMove(target,approach,from=null){
  const pre=this.approachFrom(target,approach,from);
  let approached=!!approach;
  if(approach)for(const key of ['x','y']){
   const sign=approach[key]?.sign||0,steps=approach[key]?.steps||0;
   if(!sign||!steps)continue;
   const needed=!from||(target[key]-from[key])*sign<0;
   if(needed&&!(pre&&(target[key]-pre[key])*sign>0))approached=false;
  }
  return {steps:pre?[...this.xySteps(pre),...this.xySteps(target)]:this.xySteps(target),approached};
 }
 approachSteps(target,approach,from=null){return this.approachMove(target,approach,from).steps;}
 ustep(axis){if(!this.machine)throw Error('MCB 파라미터를 읽지 않았습니다');return this.machine[this.motor(axis)].USTEP||1;}
 // Position the camera at the first well while Z travels to the selected tier.
 // Keep tray extraction and the final Z move in their existing order.
 loadSteps(slot,firstOffset,approach){
  const c=this.config;
  const first=this.wellTarget(this.wellOrder()[0],firstOffset),pre=this.approachFrom(first,approach);
  return ['ENSURE_HOMED',{parallel:[this.move('trayZ',this.tierZ(slot)),this.move('cameraX',(pre||first).x),this.move('cameraY',(pre||first).y)]},this.move('trayX',this.full('trayX',c.trayOut)),this.move('trayZ',this.full('trayZ',c.captureZ)),...(pre?this.xySteps(first):[])];
 }
 wellSteps(well,offset){return this.xySteps(this.wellTarget(well,offset));}
 returnSteps(slot){
  const park=a=>this.move(a,this.parkOf(a));
  // camera park and Z to the tier together (no interference, confirmed 2026-10-16), then the tray
  return [{parallel:[park('cameraX'),park('cameraY'),this.move('trayZ',this.tierZ(slot))]},park('trayX'),park('trayZ')];
 }
 // full steps of the recipe -> MCB steps
 full(axis,steps){if(!this.machine)throw Error('MCB 파라미터를 읽지 않았습니다');return steps*(this.machine[this.motor(axis)].USTEP||1);}
 // Recipe speed for an axis in full steps/s: `speedHz` is one number for every axis or an
 // object per axis ({cameraX, cameraY, trayX, trayZ}); a missing entry uses the firmware SPEED.
 speedOf(axis){
  const v=this.speedOverride?.[axis]!==undefined?this.speedOverride[axis]:this.config.speedHz;
  const hz=typeof v==='number'?v:(v&&typeof v==='object'?v[axis]:undefined);
  if(hz===undefined||hz===null)return 0;
  if(!Number.isInteger(hz)||hz<1||hz>20000)throw Error(`mcb-config.json: speedHz for ${axis} must be an integer 1..20000`);
  return hz;
 }
 move(axis,pos){
  const m=this.motor(axis),speed=this.speedOf(axis),hz=speed&&this.full(axis,speed);
  return hz?`MOVE ${m} ${pos} ${hz}`:`MOVE ${m} ${pos}`;
 }
 // One local hardware request; resolves with the agent result, rejects with Error(message).
 // Motion requests go through one long-lived `mcb.py --serve` process that keeps the UART
 // open, so a move costs no process start / port open (about 0.25 s each before).
 openSession(){
  if(this.session&&this.session.exitCode===null&&!this.session.killed)return this.session;
  const child=spawn(process.env.COLONY_PYTHON||'python3',[this.sessionScript,'--serve'],{stdio:['pipe','pipe','pipe']});
  child.pending=new Map();let buffer='';
  child.stdout.on('data',b=>{
   buffer+=b;
   for(let i;(i=buffer.indexOf('\n'))>=0;){
    const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let r;
    try{r=JSON.parse(line);}catch{continue;}
    const p=child.pending.get(r.id);if(p){child.pending.delete(r.id);p.done(r);}
   }
  });
  child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
  const fail=error=>{if(this.session===child)this.session=null;for(const p of child.pending.values())p.fail(error);child.pending.clear();};
  child.on('error',fail);child.on('close',()=>fail(Error('MCB_SESSION_CLOSED')));
  this.session=child;return child;
 }
 run(steps,timeoutSec=240){
  if(this.active)return Promise.reject(Error('MOTION_BUSY'));
  this.active=true;
  return new Promise((resolve,reject)=>{
   const child=this.openSession(),id=randomUUID();
   const timer=setTimeout(()=>{child.pending.delete(id);child.kill('SIGTERM');reject(Error('MOTION_TIMEOUT'));},(timeoutSec+30)*1000);
   child.pending.set(id,{done:r=>{clearTimeout(timer);r.ok?resolve(r.result):reject(Error(r.error?.message||'MOTION_FAILED'));},
    fail:e=>{clearTimeout(timer);reject(e);}});
   child.stdin.write(JSON.stringify({id,args:{steps,timeout:timeoutSec}})+'\n');
  }).finally(()=>{this.active=false;});
 }
 close(){if(this.session){this.session.stdin.end();this.session.kill('SIGTERM');this.session=null;}}
 stop(){return this.request({stop:true},20,false).catch(()=>{});}
 // delete local captured frames (local_agent "purge")
 purge(ids){return ids.length?this.request({ids},60,false,'purge'):Promise.resolve({removed:[]});}
 request(args,timeoutSec,exclusive,command='mcb'){
  return new Promise((resolve,reject)=>{
   const child=spawn(process.env.COLONY_PYTHON||'python3',[this.runner],{stdio:['pipe','pipe','pipe']});
   let out='',err='',timedOut=false;
   const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},timeoutSec*1000);
   child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{err+=b;});
   child.on('error',e=>{clearTimeout(timer);reject(e);});
   child.on('close',code=>{
    clearTimeout(timer);
    if(timedOut)return reject(Error('MOTION_TIMEOUT'));
    let r;try{r=JSON.parse(out);}catch{return reject(Error(`MOTION_LOCAL_FAILED: ${err.slice(-500)||'code '+code}`));}
    if(code!==0||!r.ok)return reject(Error(r.error?.message||'MOTION_FAILED'));
    resolve(r.result);
   });
   child.stdin.end(JSON.stringify({requestId:randomUUID(),command,args}));
  });
 }
}
