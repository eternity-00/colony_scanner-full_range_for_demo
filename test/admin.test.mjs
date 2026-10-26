// Maintenance API used by the admin tool (tools/admin): PIN, lock, recipe validation, command blocking.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir=mkdtempSync(join(tmpdir(),'colony-admin-'));
process.env.NODE_ENV='test';process.env.COLONY_PROFILE='virtual';process.env.COLONY_DATA_DIR=dir;process.env.ADMIN_PIN='4321';
process.env.VIRTUAL_ENGINE_URL='http://127.0.0.1:1';	// no engine: devices stay offline, nothing moves
const {server,controller}=await import('../server/index.mjs');
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const call=(path,{method='GET',body,pin='4321'}={})=>fetch(base+path,{method,headers:{'content-type':'application/json',...(pin?{'x-admin-pin':pin}:{})},body:body?JSON.stringify(body):undefined}).then(async r=>({status:r.status,data:await r.json()}));
const command=(command,deviceId=0,args={})=>call('/api/commands',{method:'POST',pin:null,body:{requestId:`admin_test_${Math.random().toString(36).slice(2,12)}`,command,deviceId,args}});

test('maintenance API: pin, lock, blocked commands, recipe validation',async()=>{
 try{
  assert.equal((await call('/api/v1/maintenance/status',{pin:null})).status,401);
  assert.equal((await call('/api/v1/maintenance/status',{pin:'0000'})).status,401);
  const status=await call('/api/v1/maintenance/status');assert.equal(status.status,200);assert.equal(status.data.profile.name,'virtual');assert.equal(status.data.maintenance,null);
  assert.equal((await call('/api/health',{pin:null})).data.profile,'virtual');
  // enter: device commands are refused with MAINTENANCE while settings still work
  const enter=await call('/api/v1/maintenance/enter',{method:'POST',body:{by:'test'}});assert.equal(enter.status,200);assert.equal(enter.data.by,'test');
  assert.equal((await call('/api/state',{pin:null})).data.maintenance.by,'test');
  const blocked=await command('pause',1);assert.equal(blocked.status,423);assert.equal(blocked.data.code,'MAINTENANCE');
  assert.equal((await command('home',1)).data.code,'FORBIDDEN','admin-only check comes first');
  await command('role.login',0,{pin:'4321'});	// settings are admin-only since 2026-10-26
  assert.equal((await command('settings',0,{alignment:true})).status,202);
  // no MCB in the virtual profile
  assert.equal((await call('/api/v1/maintenance/mcb',{method:'POST',body:{steps:['PING']}})).data.code,'NO_MOTION');
  assert.equal((await call('/api/v1/maintenance/mcb',{method:'POST',body:{steps:['rm -rf /']}})).data.code,'INVALID_STEP');
  // recipe: read, validate (problems reported, not thrown), save needs the lock
  const recipe=await call('/api/v1/maintenance/recipe');assert.equal(recipe.status,200);assert.equal(recipe.data.config.tiers,8);
  const bad=await call('/api/v1/maintenance/recipe/validate',{method:'POST',body:{config:{...recipe.data.config,captureZ:5000,tiers:7}}});
  assert.equal(bad.status,200);assert.ok(bad.data.problems.some(p=>p.includes('captureZ')));assert.ok(bad.data.problems.some(p=>p.includes('tiers')));
  const good=await call('/api/v1/maintenance/recipe/validate',{method:'POST',body:{config:recipe.data.config}});assert.deepEqual(good.data.problems,[]);
  const refused=await call('/api/v1/maintenance/recipe',{method:'PUT',body:{config:{...recipe.data.config,captureZ:5000}}});assert.equal(refused.status,422);
  // params backups: listing works without MCB, backup itself needs one
  assert.deepEqual((await call('/api/v1/maintenance/params/backups')).data.files,[]);
  assert.equal((await call('/api/v1/maintenance/params/backup',{method:'POST',body:{}})).data.code,'NO_MOTION');
  const exit=await call('/api/v1/maintenance/exit',{method:'POST'});assert.equal(exit.status,200);assert.equal(controller.maintenance,null);
  assert.notEqual((await command('pause',1)).data.code,'MAINTENANCE');
 }finally{controller.close();server.closeAllConnections?.();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
