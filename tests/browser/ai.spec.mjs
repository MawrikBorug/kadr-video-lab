import {test,expect} from '@playwright/test';

test('real browser image orientation, payload privacy, result and clarification lifecycle',async({page})=>{
 let sent;
 await page.route('**/api/ai',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{ready:true,commit:'test-build'}});
  sent=route.request().postDataJSON();
  if(sent.op==='cancel')return route.fulfill({json:{cancelled:true}});
  return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'result',result:{status:'candidates',candidates:[{id:1,type:'movie',title:'Synthetic card',original:'Synthetic',year:2000,catalogVerified:true,frameMatchVerified:false,assessment:'ambiguous',explanation:'Fixture only',url:'https://www.themoviedb.org/movie/1'}],message:'Synthetic response, not inference'}})+'\n'});
 });
 await page.goto('ai.html');await page.locator('#ai-files').setInputFiles('tests/fixtures/ai-controls/control-06.jpg');
 await expect(page.locator('.preview img')).toHaveCount(1);await expect(page.locator('.preview p').first()).toContainText('1600×900');
 await page.locator('#ai-description').fill('Описание для синтетического транспортного теста.');
 await page.locator('#ai-find').click();await expect(page.locator('#ai-candidates')).toContainText('Synthetic card');
 expect(sent.frames).toHaveLength(1);expect(Object.keys(sent).sort()).toEqual(['description','frames','job','op']);
 expect(JSON.stringify(sent)).not.toContain('control-06');expect(JSON.stringify(sent)).not.toContain('Elephants');
 await expect(page.locator('.preview')).toHaveCount(0);await expect(page.locator('#ai-candidates')).toContainText('неоднозначно');
 expect(await page.evaluate(()=>Object.keys(localStorage).filter(x=>/ai/i.test(x)))).toEqual([]);
 await page.locator('#ai-files').setInputFiles('tests/fixtures/ai-controls/control-01.jpg');await expect(page.locator('.preview')).toHaveCount(1);
 await page.getByRole('button',{name:'Удалить',exact:true}).click();await expect(page.locator('.preview')).toHaveCount(0);
});

test('server rejects unverified prose without rendering it, explicit film-watch step',async({page})=>{
 await page.route('**/api/ai',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{ready:true}});
  const b=route.request().postDataJSON();
  const card={id:1,type:'movie',title:'Synthetic film',year:2000,url:'https://www.themoviedb.org/movie/1'};
  if(b.op==='catalog')return route.fulfill({json:{candidates:[card]}});
  if(b.op==='prepare')return route.fulfill({json:{card,proof:'selection-fixture',finality:{state:'confirmed'}}});
  if(b.op==='confirm'){
   if(!b.watched)return route.fulfill({status:403,json:{error:{message:'Подтвердите полный просмотр фильма.'}}});
   return route.fulfill({json:{proof:'watched-fixture'}});
  }
  return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'result',result:{status:'rejected',text:null,reviewSummary:'Разбор отклонён проверкой.',usage:[]}})+'\n'});
 });
 await page.goto('ai.html');await page.locator('summary').click();await page.locator('#ai-title-query').fill('Synthetic');await page.locator('#ai-catalog').click();
 await page.getByRole('button',{name:'Выбрать эту карточку'}).click();await page.locator('#ai-analyze').click();
 await expect(page.locator('#ai-status')).toContainText('Подтвердите полный просмотр');
 await page.locator('#ai-watched input').check();await page.locator('#ai-analyze').click();
 await expect(page.locator('#ai-verdict')).toContainText('отклонён');await expect(page.locator('#ai-text')).toBeEmpty();
});

test('small frames warn, maximum three, no browser persistence of image or description',async({page})=>{
 await page.route('**/api/ai',r=>r.fulfill({json:{ready:true}}));await page.goto('ai.html');
 await page.locator('#ai-files').setInputFiles(['tests/fixtures/ai-controls/control-01.jpg','tests/fixtures/ai-controls/control-02.jpg','tests/fixtures/ai-controls/control-05.jpg']);
 await expect(page.locator('.preview')).toHaveCount(3);await expect(page.locator('.warning')).toContainText('Мало деталей');
 await page.locator('#ai-files').setInputFiles('tests/fixtures/ai-controls/control-04.jpg');await expect(page.locator('.preview')).toHaveCount(3);
 expect(await page.evaluate(()=>[Object.keys(localStorage),Object.keys(sessionStorage)])).toEqual([[],[]]);
});
