import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Image analysis helpers that run as short python processes on saved frames:
//  - decodeBarcodes(files): zxing-cpp over whole frames (device/barcode.py)
//  - changeScores(pairs):   previous/current preview difference per well (device/change_score.py)
// Both resolve with [] / nulls instead of throwing when the interpreter or the package is missing,
// so the capture itself never fails because of them.
const PY=process.env.COLONY_PYTHON||'python3';
const script=name=>fileURLToPath(new URL(`../device/${name}`,import.meta.url));

function lines(args,timeoutMs){
 return new Promise(resolve=>{
  let out='',err='';const child=spawn(PY,args,{stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>child.kill('SIGKILL'),timeoutMs);
  child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{err=(err+b).slice(-1000);});
  child.on('error',()=>{clearTimeout(timer);resolve({rows:[],error:'spawn failed'});});
  child.on('close',code=>{clearTimeout(timer);const rows=[];for(const l of out.split('\n'))if(l.trim()){try{rows.push(JSON.parse(l));}catch{}}resolve({rows,error:code===0?null:(err||`exit ${code}`)});});
 });
}

let decoderKnown=null;
/** {available:boolean, decoder:string|null} — cached after the first call. */
export async function barcodeDecoder(){
 if(decoderKnown)return decoderKnown;
 const {rows}=await lines([script('barcode.py')],20000);
 const done=rows.find(r=>r.done);
 decoderKnown={available:!!done?.decoder,decoder:done?.decoder||null};
 return decoderKnown;
}

/**
 * files: absolute paths. Resolves {decoder, results:[{file, barcodes:[{text,format,x,y,w,h}], seconds, error?}], seconds}.
 */
export async function decodeBarcodes(files,{timeoutMs=60000}={}){
 if(!files.length)return {decoder:null,results:[],seconds:0};
 const started=Date.now();
 const {rows,error}=await lines([script('barcode.py'),...files],timeoutMs);
 const done=rows.find(r=>r.done);
 const results=files.map(file=>rows.find(r=>r.file===file)||{file,barcodes:[],error:error||'NO_RESULT'});
 return {decoder:done?.decoder||null,results,seconds:(Date.now()-started)/1000};
}

/** pairs: [[prev,cur],...] -> [{shift,score}|{score:null,error}] in the same order. */
export async function changeScores(pairs,{timeoutMs=60000}={}){
 if(!pairs.length)return [];
 const {rows}=await lines([script('change_score.py'),...pairs.flat()],timeoutMs);
 return pairs.map((_,i)=>rows[i]||{score:null,error:'NO_RESULT'});
}
