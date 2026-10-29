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

test('watch confirmation precedes a direct generated analysis; text is not executable or marked verified',async({page})=>{
 let analyses=0,analysisInput;
 const headings=['Краткое резюме','Сюжет и финал','Смысл','Детали и отсылки','Создание','Персонажи','Визуальный язык','Теории','Источники'];
 const text=headings.map((h,i)=>`${i+1}. ${h}\n\n${i===2?'Интерпретация: герой меняет своё отношение к прошлому.':'Synthetic generated paragraph.'}`).join('\n\n')+'\n<script>window.modelExecuted=true</script>';
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
  if(b.op==='analysis'){
   analyses++;analysisInput=b;
   return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'result',result:{status:'generated',text,sources:[],usage:[{usage:{total_tokens:123}}]}})+'\n'});
  }
  return route.fulfill({status:400,json:{error:{message:'Unexpected synthetic operation'}}});
 });
 await page.goto('ai.html');await page.locator('summary').click();await page.locator('#ai-title-query').fill('Synthetic');await page.locator('#ai-catalog').click();
 await page.getByRole('button',{name:'Выбрать эту карточку'}).click();await page.locator('#ai-analyze').click();
 await expect(page.locator('#ai-status')).toContainText('Подтвердите полный просмотр');
 expect(analyses).toBe(0);await expect(page.locator('#ai-text')).toBeEmpty();
 await expect(page.locator('#ai-enrich-sources')).not.toBeChecked();
 await page.locator('#ai-watched input').check();await page.locator('#ai-analyze').click();
 await expect(page.locator('#ai-verdict')).toContainText('Разбор создан ИИ');await expect(page.locator('#ai-text')).toContainText('Интерпретация: герой');
 await expect(page.locator('#ai-text h3')).toHaveCount(9);await expect(page.locator('#ai-status')).toHaveText('Разбор готов.');
 expect(analyses).toBe(1);expect(analysisInput.enrichSources).toBe(false);expect(analysisInput.proof).toBe('watched-fixture');
 await expect(page.locator('#ai-text script')).toHaveCount(0);expect(await page.evaluate(()=>window.modelExecuted)).toBeUndefined();
 await expect(page.locator('#ai-verdict')).not.toContainText('проверки');
 await page.locator('#ai-enrich-sources').check();await page.locator('#ai-analyze').click();
 await expect(page.locator('#ai-status')).toHaveText('Разбор готов.');expect(analysisInput.enrichSources).toBe(true);expect(analyses).toBe(2);
});

test('an access error never displays a returned spoiler body as a completed analysis',async({page})=>{
 await page.route('**/api/ai',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{ready:true}});
  const b=route.request().postDataJSON(),card={id:1,type:'movie',title:'Synthetic film',year:2000};
  if(b.op==='catalog')return route.fulfill({json:{candidates:[card]}});
  if(b.op==='prepare')return route.fulfill({json:{card,proof:'selected',finality:{state:'confirmed'}}});
  if(b.op==='confirm')return route.fulfill({json:{proof:'watched'}});
  return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'error',error:{code:'WATCHED_REQUIRED',message:'Подтверждение просмотра истекло.',text:'SPOILER MUST NOT RENDER'}})+'\n'});
 });
 await page.goto('ai.html');await page.locator('summary').click();await page.locator('#ai-title-query').fill('Synthetic');await page.locator('#ai-catalog').click();
 await page.getByRole('button',{name:'Выбрать эту карточку'}).click();await page.locator('#ai-watched input').check();await page.locator('#ai-analyze').click();
 await expect(page.locator('#ai-verdict')).toHaveText('Подтверждение просмотра истекло.');await expect(page.locator('#ai-text')).toBeEmpty();
 await expect(page.locator('body')).not.toContainText('SPOILER MUST NOT RENDER');
});

test('small frames warn, maximum three, no browser persistence of image or description',async({page})=>{
 await page.route('**/api/ai',r=>r.fulfill({json:{ready:true}}));await page.goto('ai.html');
 await page.locator('#ai-files').setInputFiles(['tests/fixtures/ai-controls/control-01.jpg','tests/fixtures/ai-controls/control-02.jpg','tests/fixtures/ai-controls/control-05.jpg']);
 await expect(page.locator('.preview')).toHaveCount(3);await expect(page.locator('.warning')).toContainText('Мало деталей');
 await page.locator('#ai-files').setInputFiles('tests/fixtures/ai-controls/control-04.jpg');await expect(page.locator('.preview')).toHaveCount(3);
 expect(await page.evaluate(()=>[Object.keys(localStorage),Object.keys(sessionStorage)])).toEqual([[],[]]);
});

test('synthetic visibility interruption and late abort preserve a fresh foreground upload',async({page})=>{
 await page.route('**/api/ai',r=>r.fulfill({json:{ready:true}}));
 await page.addInitScript(()=>{
  const original=window.fetch.bind(window);let first=true;
  window.fetch=(input,options)=>{
   if(options?.body&&JSON.parse(options.body).op==='recognize'&&first){
    first=false;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>setTimeout(()=>reject(new DOMException('Late synthetic abort','AbortError')),650),{once:true}));
   }return original(input,options);
  };
 });
 await page.goto('ai.html');await page.locator('#ai-files').setInputFiles('tests/fixtures/ai-controls/control-01.jpg');
 await expect(page.locator('.preview')).toHaveCount(1);await page.locator('#ai-find').click();
 await expect(page.locator('#ai-cancel')).toBeEnabled();
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 await expect(page.locator('.preview')).toHaveCount(0);await expect(page.locator('#ai-status')).toContainText('Страница скрыта');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});});
 await page.locator('#ai-files').setInputFiles('tests/fixtures/ai-controls/control-02.jpg');await expect(page.locator('.preview')).toHaveCount(1);
 await page.waitForTimeout(800);await expect(page.locator('.preview')).toHaveCount(1);await expect(page.locator('#ai-find')).toBeEnabled();
 expect(await page.evaluate(()=>[Object.keys(localStorage),Object.keys(sessionStorage)])).toEqual([[],[]]);
});
