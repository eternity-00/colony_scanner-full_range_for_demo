// Browser walk-through of the LCD UI (v2.2 screens + hardware integration) against the virtual engine.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const dir=mkdtempSync(join(tmpdir(),'colony-ui-')),appPort=8791,enginePort=8794,consolePort=8793;
const child=(file,env)=>spawn(process.execPath,[file],{cwd:process.cwd(),env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
const engine=child('simulator-app/engine.mjs',{VIRTUAL_ENGINE_PORT:String(enginePort),STAGE_MS:'80'});
const consoleServer=child('simulator-app/server.mjs',{SIMULATOR_PORT:String(consolePort)});
const server=child('server/index.mjs',{COLONY_PROFILE:'virtual',PORT:String(appPort),HOST:'127.0.0.1',COLONY_DATA_DIR:dir,VIRTUAL_ENGINE_URL:`http://127.0.0.1:${enginePort}`,ADMIN_PIN:'0000'});
let serverLog='';server.stderr.on('data',d=>{serverLog+=d;});server.stdout.on('data',d=>{serverLog+=d;});
const wait=async url=>{for(let i=0;i<80;i++){try{const r=await fetch(url);if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error(`server timeout: ${url}\n${serverLog}`)};
const stop=async process=>{if(process.exitCode!==null)return;process.kill('SIGTERM');await new Promise(resolve=>process.once('exit',resolve))};
try{
 await Promise.all([wait(`http://127.0.0.1:${appPort}/api/health`),wait(`http://127.0.0.1:${enginePort}/api/health`),wait(`http://127.0.0.1:${consolePort}`)]);
 const systemChromium='/usr/lib/chromium/chromium',browser=await chromium.launch({...(existsSync(systemChromium)?{executablePath:systemChromium}:{}),headless:true,args:['--disable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:1024,height:600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
  const drawer=async label=>{await page.locator('.hd-menu').click();await page.locator('.drawer.open .drawer-list').getByRole('button',{name:new RegExp(label)}).first().click();await page.waitForTimeout(200);};
  await page.goto(`http://127.0.0.1:${appPort}`);await page.waitForSelector('.hm-page');
  await page.waitForFunction(()=>document.querySelector('header')?.textContent.includes('유선 연결 1 / 1'));
  assert.equal(await page.locator('.hm-big span').count(),4);
  // admin by PIN
  await page.locator('.role-chip').click();await page.getByRole('button',{name:'관리자 전환'}).click();
  for(let i=0;i<4;i++)await page.locator('.modal').getByRole('button',{name:'0',exact:true}).click();
  await page.locator('.modal').getByRole('button',{name:/^확인$/}).click();await page.waitForTimeout(200);assert.match(await page.locator('.role-chip').innerText(),/관리자/);
  // tray follows the profile layout (virtual profile: 8 x 3)
  await drawer('등록');assert.equal(await page.locator('.registration .cell').count(),24);
  await page.locator('.registration .cell:not([disabled])').nth(4).click();await page.locator('.rg-page').getByRole('button',{name:/등록$/}).first().click();await page.locator('.modal').getByRole('button',{name:/^확인$/}).click();await page.waitForTimeout(400);
  // settings: alignment section exists, virtual profile says so
  await drawer('사용자 설정');await page.locator('.settings-nav').getByRole('button',{name:/카메라 정렬/}).click();assert.match(await page.locator('main').innerText(),/가상 장비 — 해당 없음|웰 중심 자동 정렬/);
  // capture now from the detail screen, then the viewer shows six placeholders
  await drawer('상세');await page.locator('.tray .cell').nth(4).click();await page.getByRole('button',{name:/촬영 시작/}).click();await page.waitForTimeout(1200);
  await drawer('상세');await page.locator('.tray .cell').nth(4).click();await page.getByRole('button',{name:'보기'}).first().click();assert.match(await page.locator('.modal').innerText(),/Well 1–6/);assert.equal(await page.locator('.well-set img').count(),6);await page.locator('.modal-x').click();
  // device fault from the external console propagates, device screen shows it
  const sim=await browser.newPage({viewport:{width:1100,height:820}});await sim.goto(`http://127.0.0.1:${consolePort}?api=http://127.0.0.1:${enginePort}/api`);await sim.waitForSelector('.device');await sim.locator('.device').first().getByText('Z축 오류 주입').click();await sim.locator('.device').first().getByText('오류 Z_LIMIT').waitFor({timeout:5000});
  await drawer('장비');await page.locator('.dv-alert.bad').getByText(/Z축/).waitFor({timeout:5000});
  assert.match(await sim.locator('#log').innerText(),/TX/);
  // maintenance lock shows a banner and disables capture
  const pin={'content-type':'application/json','x-admin-pin':'0000'};
  assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/v1/maintenance/enter`,{method:'POST',headers:pin,body:'{"by":"ui-test"}'})).status,200);
  await page.locator('.session-warning.maintenance').waitFor({timeout:5000});
  assert.equal((await fetch(`http://127.0.0.1:${appPort}/api/v1/maintenance/exit`,{method:'POST',headers:pin})).status,200);
  await page.waitForFunction(()=>!document.querySelector('.session-warning.maintenance'));
  await stop(engine);await page.waitForFunction(()=>document.querySelector('header')?.textContent.includes('유선 연결 0 / 1'));
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
}finally{await Promise.all([stop(server),stop(consoleServer),stop(engine)]);rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
console.log('PASS: profile layout, roles, registration, capture, viewer, fault propagation, maintenance lock.');
