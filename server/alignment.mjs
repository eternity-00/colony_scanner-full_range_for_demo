import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';

// Camera alignment: before each well is captured the well rim is located in a live frame
// (device/well_center.py) and the camera X/Y axes are corrected until the well centre is
// within tolerance of the frame centre. The pixel-per-step matrix and the rim ring
// (radius, edge polarity) come from a one-time camera calibration; corrected well
// positions are remembered so later plates start close to centre.

export const ALIGNMENT_DEFAULTS=Object.freeze({
 enabled:false,	// recipe "alignment": {"enabled": true} switches the loop on
 tolerancePx:60,	// |well centre - frame centre| accepted without a further move (3840 px frame, about 0.55 mm; rim detection scatters by +-30 px)
 maxIterations:3,	// correction moves per well before the residual is reported
 maxCorrectionPitch:0.6,	// one correction may not exceed this fraction of the well pitch
 probeFullSteps:40,	// calibration probe distance per axis (full steps, x USTEP on the MCB)
 remember:true,	// keep the corrected well positions for the next plate
 onFailure:'capture',	// 'capture': take the frame uncentred and flag it; 'fail': fail the job
 antiBacklash:true,	// approach every camera position from the calibration's probe direction
 backlashMarginFullSteps:4,	// extra pre-travel beyond the measured backlash (full steps)
 cameraSpeedHz:190,	// camera-axis speed (full steps/s) while aligning; short reversing moves lose repeatability at the firmware's fast setting
 settleMs:300,	// an alignment frame must start exposing this long after the move finished
});

export function alignmentSettings(config){
 const a=config?.alignment;
 if(a===undefined||a===null||a===false)return {...ALIGNMENT_DEFAULTS};
 if(a===true)return {...ALIGNMENT_DEFAULTS,enabled:true};
 if(typeof a!=='object'||Array.isArray(a))throw Error('scanner recipe config: alignment must be an object');
 const s={...ALIGNMENT_DEFAULTS,...a,enabled:a.enabled!==false};
 for(const [key,min,max] of [['tolerancePx',1,2000],['maxIterations',0,10],['maxCorrectionPitch',0.05,1],['probeFullSteps',1,100000],['backlashMarginFullSteps',0,1000],['cameraSpeedHz',0,20000],['settleMs',0,5000]])
  if(typeof s[key]!=='number'||!(s[key]>=min&&s[key]<=max))throw Error(`scanner recipe config: alignment.${key} must be ${min}..${max}`);
 if(!['capture','fail'].includes(s.onFailure))throw Error('scanner recipe config: alignment.onFailure must be capture or fail');
 return s;
}

// Image displacement per MCB step of each camera axis, from two probe moves.
// probes: {x:{steps,dx,dy}, y:{steps,dx,dy}} (dx/dy = well centre shift in frame pixels)
export function jacobian(probes){
 const j={xx:probes.x.dx/probes.x.steps,xy:probes.x.dy/probes.x.steps,yx:probes.y.dx/probes.y.steps,yy:probes.y.dy/probes.y.steps};
 // the two probe directions must be clearly independent in the image (angle > ~15 degrees)
 const a=Math.hypot(j.xx,j.xy),b=Math.hypot(j.yx,j.yy),det=j.xx*j.yy-j.yx*j.xy;
 if(!Object.values(j).every(Number.isFinite)||!a||!b||Math.abs(det)<0.25*a*b)throw Error('ALIGNMENT_SINGULAR');
 return j;
}

// Axis steps that move the well centre from `offset` (centre - frame centre, px) onto the frame centre.
export function correction(j,offset){
 const det=j.xx*j.yy-j.yx*j.xy;
 if(!Number.isFinite(det)||Math.abs(det)<1e-9)throw Error('ALIGNMENT_SINGULAR');
 const ex=-offset.x,ey=-offset.y;
 return {x:(ex*j.yy-j.yx*ey)/det,y:(j.xx*ey-j.xy*ex)/det};
}

// Backlash of each axis in steps from the image shift left after a probe move and its return:
// the shift is projected on the probe's own image direction.
export function backlashSteps(probes,shift){
 const along=(p,d)=>{const n=Math.hypot(p.dx,p.dy);return n?Math.abs((d.x*p.dx+d.y*p.dy)/n)/(n/Math.abs(p.steps)):0;};
 return {x:Math.round(along(probes.x,shift.x)),y:Math.round(along(probes.y,shift.y))};
}

// Shorten a correction that exceeds the per-axis limits, keeping its direction.
export function limitCorrection(delta,limit){
 const k=Math.max(Math.abs(delta.x)/limit.x,Math.abs(delta.y)/limit.y,1);
 return {x:Math.round(delta.x/k),y:Math.round(delta.y/k),clamped:k>1};
}

export class AlignmentStore{
 constructor(file=process.env.COLONY_ALIGNMENT_FILE||join(homedir(),'.local','state','colony-scanner','camera-alignment.json')){
  this.file=file;this.data=this.load();
 }
 load(){
  try{
   const d=JSON.parse(readFileSync(this.file,'utf8'));
   if(d&&typeof d==='object'&&d.version===1)return {offsets:{},...d};
  }catch(e){if(e.code!=='ENOENT')console.error(`camera-alignment: ${this.file}: ${e.message}`);}
  return {version:1,calibration:null,offsets:{}};
 }
 save(){
  mkdirSync(dirname(this.file),{recursive:true});
  const temporary=`${this.file}.${process.pid}.tmp`;
  writeFileSync(temporary,JSON.stringify(this.data,null,1));renameSync(temporary,this.file);
 }
 get calibration(){return this.data.calibration;}
 // A calibration is only valid for the camera frame and microstep setting it was made with.
 validCalibration({frame,ustep}={}){
  const c=this.data.calibration;
  if(!c?.pixelsPerStep||!c.ring?.radius)return null;
  if(frame&&(c.frame?.width!==frame.width||c.frame?.height!==frame.height))return null;
  if(ustep&&(c.ustep?.cameraX!==ustep.cameraX||c.ustep?.cameraY!==ustep.cameraY))return null;
  return c;
 }
 // Remembered well positions are MCB steps: they only survive a recalibration with the same microstep setting.
 setCalibration(calibration){
  const previous=this.data.calibration;
  if(!previous?.ustep||previous.ustep.cameraX!==calibration.ustep?.cameraX||previous.ustep.cameraY!==calibration.ustep?.cameraY)this.data.offsets={};
  this.data.calibration={...calibration,calibratedAt:Date.now()};this.save();
 }
 offset(well){const o=this.data.offsets?.[well];return o&&Number.isFinite(o.x)&&Number.isFinite(o.y)?{x:o.x,y:o.y}:{x:0,y:0};}
 rememberOffset(well,offset){this.data.offsets[well]={x:Math.round(offset.x),y:Math.round(offset.y),at:Date.now()};this.save();}
 forgetOffsets(){this.data.offsets={};this.save();}
 status(){
  const c=this.data.calibration;
  return {file:this.file,calibrated:!!c?.pixelsPerStep,calibratedAt:c?.calibratedAt??null,ring:c?.ring??null,frame:c?.frame??null,ustep:c?.ustep??null,pixelsPerStep:c?.pixelsPerStep??null,rememberedWells:Object.keys(this.data.offsets||{}).map(Number).sort((a,b)=>a-b)};
 }
}
