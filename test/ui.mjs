import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'colony-ui-')),port=8791;
const server=spawn(process.execPath,['server/index.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),COLONY_DATA_DIR:dir,STAGE_MS:'80'},stdio:['ignore','pipe','pipe']});
const wait=async()=>{for(let i=0;i<50;i++){try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('server timeout')};
try{
 await wait();const systemChromium='/usr/lib/chromium/chromium';const browser=await chromium.launch({...(existsSync(systemChromium)?{executablePath:systemChromium}:{}),headless:true,args:['--disable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${port}`);await page.waitForSelector('.scanner-grid');
  assert.equal(await page.locator('.scanner').count(),4);assert.match(await page.locator('header').innerText(),/서버 실시간 연결/);
  await page.getByRole('button',{name:/가상장비/}).click();await page.locator('.io-device').nth(0).getByText('Z축 오류 주입').click();await page.waitForTimeout(150);assert.match(await page.locator('.io-device').nth(0).innerText(),/Z_LIMIT/);
  await page.locator('.io-device').nth(0).getByText('오류 해제').click();await page.waitForTimeout(150);
  await page.getByRole('button',{name:/등록 Register/}).click();await page.locator('.device-tabs button').nth(2).click();await page.locator('.registration .cell.empty').first().click();await page.getByRole('button',{name:'등록하고 수납'}).click();await page.waitForTimeout(200);assert.equal(await page.locator('.split').count(),1);
  await page.getByRole('button',{name:'지금 촬영'}).click();await page.waitForTimeout(900);await page.getByRole('button',{name:/진행 Running/}).click();await page.waitForTimeout(200);assert.match(await page.locator('.job').innerText(),/completed|100%/);
  await page.getByRole('button',{name:/가상장비 Simulator/}).click();assert.ok(await page.locator('.log tbody tr').count()>0);assert.match(await page.locator('.log').innerText(),/TX/);assert.match(await page.locator('.log').innerText(),/ACK/);
  await page.screenshot({path:'../docs/react-virtual-device.png',fullPage:true});assert.deepEqual(errors,[]);
 }finally{await browser.close()}
}finally{
 server.kill('SIGTERM');
 await new Promise(resolve=>server.once('exit',resolve));
 rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
console.log('PASS: React UI, SSE connection, simulator fault input/recovery, registration, capture and I/O monitor.');
