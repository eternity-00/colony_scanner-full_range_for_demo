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
const server=child('server/index.mjs',{PORT:String(appPort),COLONY_DATA_DIR:dir,VIRTUAL_ENGINE_URL:`http://127.0.0.1:${enginePort}`,ADMIN_PIN:'0000'});
const wait=async url=>{for(let i=0;i<80;i++){try{const r=await fetch(url);if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error(`server timeout: ${url}`)};
const stop=async process=>{if(process.exitCode!==null)return;process.kill('SIGTERM');await new Promise(resolve=>process.once('exit',resolve))};
try{
 await Promise.all([wait(`http://127.0.0.1:${appPort}/api/health`),wait(`http://127.0.0.1:${enginePort}/api/health`),wait(`http://127.0.0.1:${consolePort}`)]);
 const systemChromium='/usr/lib/chromium/chromium',browser=await chromium.launch({...(existsSync(systemChromium)?{executablePath:systemChromium}:{}),headless:true,args:['--disable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${appPort}`);await page.waitForSelector('.scanner-grid');
  await page.waitForFunction(()=>document.querySelector('header')?.textContent.includes('링크 4/4'));assert.equal(await page.locator('.scanner').count(),4);
  await page.locator('.role-chip').click();await page.locator('.pin').fill('0000');await page.getByRole('button',{name:'관리자 전환'}).click();await page.waitForTimeout(200);assert.match(await page.locator('.role-chip').innerText(),/관리자/);
  await page.getByRole('button',{name:/사용자 설정 Settings/}).click();assert.match(await page.locator('.settings-nav').innerText(),/권한 설정/);
  await page.getByRole('button',{name:/등록 Register/}).click();await page.locator('.device-tabs button').nth(2).click();await page.locator('.registration .cell.empty').first().click();await page.getByRole('button',{name:'등록하고 수납'}).click();await page.getByRole('button',{name:'완료'}).click();
  await page.locator('.scanner').nth(2).getByRole('button',{name:'상세'}).click();await page.getByRole('button',{name:'지금 촬영'}).click();await page.waitForTimeout(900);assert.match(await page.locator('.job').innerText(),/completed|100%/);
  await page.getByRole('button',{name:/현황 Overview/}).click();await page.locator('.scanner').nth(2).getByRole('button',{name:'상세'}).click();await page.getByRole('button',{name:'보기'}).first().click();assert.match(await page.locator('.modal').innerText(),/WELL 1\/6/);assert.equal(await page.locator('.well-view img').count(),1);await page.getByLabel('닫기').click();
  const sim=await browser.newPage({viewport:{width:1100,height:820}});await sim.goto(`http://127.0.0.1:${consolePort}?api=http://127.0.0.1:${enginePort}/api`);await sim.waitForSelector('.device');await sim.locator('.device').first().getByText('Z축 오류 주입').click();await sim.locator('.device').first().getByText('오류 Z_LIMIT').waitFor({timeout:5000});
  await page.getByRole('button',{name:/장비 Device/}).click();await page.locator('.active-error').getByText(/Z_LIMIT/).waitFor({timeout:5000});
  await page.screenshot({path:'../docs/react-lcd-v1.2.png',fullPage:true});await sim.screenshot({path:'../docs/virtual-device-v1.2.png',fullPage:true});assert.match(await sim.locator('#log').innerText(),/TX/);await stop(engine);await page.waitForFunction(()=>document.querySelector('header')?.textContent.includes('링크 0/4'));assert.deepEqual(errors,[]);
 }finally{await browser.close()}
}finally{await Promise.all([stop(server),stop(consoleServer),stop(engine)]);rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
console.log('PASS: roles, external engine/console, registration, capture, single-well viewer and device fault propagation.');
