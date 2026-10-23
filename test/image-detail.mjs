import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';

const source=process.env.COLONY_SOURCE_DATA_DIR;
assert.ok(source,'Set COLONY_SOURCE_DATA_DIR to the deployed data directory');
const dir=mkdtempSync(join(tmpdir(),'colony-image-detail-'));
const state=JSON.parse(readFileSync(join(source,'state.json'),'utf8'));state.autoRun=false;
writeFileSync(join(dir,'state.json'),JSON.stringify(state));symlinkSync(join(source,'images'),join(dir,'images'));
const port=Number(process.env.COLONY_DETAIL_TEST_PORT||8795),base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:String(port),COLONY_DATA_DIR:dir,COLONY_MCB_ENABLED:'0'},stdio:['ignore','pipe','pipe']});
let logs='';server.stderr.on('data',data=>logs+=data);
const browser=await chromium.launch({executablePath:'/usr/lib/chromium/chromium',headless:true,args:['--disable-gpu']});
try{
 for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
 await page.getByRole('button',{name:/장비 Device/}).click();
 await page.getByRole('button',{name:'촬영 영상 자세히 보기'}).click();
 const dialog=page.getByRole('dialog',{name:'촬영 영상 자세히 보기'}),canvas=dialog.getByLabel('확대 영상 영역'),img=dialog.locator('img');
 await img.waitFor();await page.waitForFunction(()=>document.querySelector('.image-detail-canvas img')?.naturalWidth>0);
 await dialog.getByRole('button',{name:'원본 크기 100%'}).click();
 let size=await img.boundingBox();assert.equal(Math.round(size.width),3840);assert.equal(Math.round(size.height),3040);
 const box=await canvas.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-250);await page.waitForTimeout(100);
 assert.ok((await img.boundingBox()).width>size.width,'wheel must zoom');
 const before=await img.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+90,box.y+box.height/2+50,{steps:5});await page.mouse.up();
 assert.ok((await img.boundingBox()).x>before.x+40,'drag must pan');
 await dialog.getByRole('button',{name:'화면 맞춤'}).click();size=await img.boundingBox();assert.ok(size.width<=box.width+2&&size.height<=box.height+2,'fit must keep the full image visible');
 // Simulate two touch pointers to check pinch scaling without relying on a mouse.
 const fitted=size.width;
 await canvas.dispatchEvent('pointerdown',{pointerId:41,pointerType:'touch',clientX:box.x+box.width/2-40,clientY:box.y+box.height/2});
 await canvas.dispatchEvent('pointerdown',{pointerId:42,pointerType:'touch',clientX:box.x+box.width/2+40,clientY:box.y+box.height/2});
 await canvas.dispatchEvent('pointermove',{pointerId:42,pointerType:'touch',clientX:box.x+box.width/2+120,clientY:box.y+box.height/2});
 await canvas.dispatchEvent('pointerup',{pointerId:41,pointerType:'touch'});await canvas.dispatchEvent('pointerup',{pointerId:42,pointerType:'touch'});
 assert.ok((await img.boundingBox()).width>fitted*1.5,'pinch must zoom');
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
 assert.equal(await page.getByRole('button',{name:'촬영 영상 자세히 보기'}).evaluate(e=>e===document.activeElement),true,'closing must restore focus');

 const plate=state.plates.find(p=>!p.removedAt&&p.runs.some(r=>r.imageState==='held'&&r.capture?.wells?.length&&existsSync(join(source,'images',r.image))));
 assert.ok(plate,'a saved multi-well capture is required');
 await page.getByRole('button',{name:/이력 History/}).click();await page.getByPlaceholder(/수납 위치 · 플레이트 검색/).fill(plate.id);
 await page.getByRole('button',{name:'상세',exact:true}).click();await page.getByRole('button',{name:'보기',exact:true}).first().click();
 await page.getByRole('button',{name:'촬영 영상 자세히 보기'}).click();
 const selector=dialog.getByLabel('촬영 영상 선택');
 const revisionBefore=await page.evaluate(()=>fetch('/api/state').then(r=>r.json()).then(s=>s.revision));
 await selector.click();await page.waitForTimeout(1800);
 assert.equal(await selector.evaluate(e=>e===document.activeElement),true,'state updates must not steal dropdown focus');
 const revisionAfter=await page.evaluate(()=>fetch('/api/state').then(r=>r.json()).then(s=>s.revision));
 assert.ok(revisionAfter>revisionBefore,'the dropdown must stay focused during actual state updates');
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 assert.equal(await selector.inputValue(),'1','native dropdown keyboard selection must work');
 await page.waitForFunction(()=>document.querySelector('.image-detail-canvas img')?.naturalWidth===3840);
 await dialog.getByRole('button',{name:'원본 크기 100%'}).click();assert.equal(Math.round((await img.boundingBox()).width),3840);

 // Check visible rendered frames, not just naturalWidth: cached loads can race resets.
 for(const label of ['웰 2','웰 3','웰 4','웰 5','웰 6','전체 웰','웰 1','웰 4','웰 2','전체 웰','웰 1']){
  const index=label==='전체 웰'?0:Number(label.split(' ')[1]);await selector.selectOption(String(index));
  await page.waitForFunction(label=>{
   const dialog=document.querySelector('.image-detail-dialog'),img=dialog?.querySelector('img');
   return img&&img.naturalWidth===3840&&getComputedStyle(img).visibility==='visible'&&img.getBoundingClientRect().width>100&&dialog.querySelector('.image-detail-heading small').textContent.includes(label);
  },label,{timeout:10000});
  assert.equal(await selector.inputValue(),String(index));
 }
 await page.keyboard.press('Escape');assert.equal(await page.locator('.modal').count(),1,'Escape must close only the detail layer');
 await page.getByLabel('닫기',{exact:true}).click();assert.deepEqual(errors,[]);
 console.log('PASS: saved camera image, native size, fit, wheel, drag, pinch, focus restore and full-resolution well selection and dropdown focus across live state updates.');
}finally{
 await browser.close();server.kill('SIGTERM');if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));
 rmSync(dir,{recursive:true,force:true});
 if(logs)console.error(logs);
}
