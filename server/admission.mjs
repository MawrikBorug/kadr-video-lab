import {put,head} from '@vercel/blob';
import {setTimeout as delay} from 'node:timers/promises';
import {Failure,demand} from './core.mjs';

// Atomic create-only objects. Only typed accounting metadata; NEVER prompts/images/text.
export class Admission {
  constructor({job,operation,signal,clock=Date.now,storage={put,head}}){Object.assign(this,{job,operation,signal,clock,storage});this.day=new Date(clock()).toISOString().slice(0,10);}
  async create(path,value){
    try{await this.storage.put(path,JSON.stringify(value),{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'});return true;}
    catch(e){if(e.name==='BlobAlreadyExistsError'||/already exists|alreadyexists/i.test(e.message))return false;throw new Failure('LEDGER_UNAVAILABLE','Счётчик бюджета недоступен: запрос остановлен без обращения к AI.',503);}
  }
  async reserve(){
    demand(/^[a-f0-9-]{36}$/i.test(this.job),'JOB_ID','Недействительный номер операции.');
    demand(await this.create(`kadr/requests/${this.day}/${this.job}.json`,{operation:this.operation,at:this.clock(),expires:this.clock()+86400000}),
      'DUPLICATE','Этот запрос уже запускался. Его повтор не расходует AI; начните новый поиск.',409);
    const needed=this.operation==='analysis'?4:this.operation==='recognize'?2:0;let got=0;
    // 20 slots × 7900 = 158000 reserved tokens/day across ALL deployed instances.
    for(let i=0;i<20&&got<needed;i++)if(await this.create(`kadr/budget/${this.day}/${i}.json`,{job:this.job,reserved:7900,at:this.clock()}))got++;
    demand(got===needed,'DAILY_BUDGET','Дневной бюджет лаборатории исчерпан. Повторите завтра.',429);
  }
  async checkpoint(){
    if(this.signal?.aborted)throw new Failure('CANCELLED','Операция отменена.',499);
    try{await this.storage.head(`kadr/cancel/${this.job}.json`);throw new Failure('CANCELLED','Операция отменена.',499);}
    catch(e){if(e instanceof Failure)throw e;if(e.name!=='BlobNotFoundError'&&!/not found|does not exist/i.test(e.message))throw new Failure('LEDGER_UNAVAILABLE','Не удалось проверить отмену. Операция остановлена.',503);}
  }
  async beforeCall(){
    await this.checkpoint();
    // Each call reserves a future 65-second slot globally; no inference retries.
    const slot=Math.floor(this.clock()/65000)+1;
    demand(await this.create(`kadr/starts/${slot}.json`,{job:this.job,start:slot*65000}),
      'BUSY','Другой запрос уже выполняется. Подождите около минуты и повторите.',429);
    while(this.clock()<slot*65000){this.signal?.throwIfAborted();await delay(Math.min(5000,slot*65000-this.clock()),undefined,{signal:this.signal});}
    await this.checkpoint();
  }
  async cancel(){await this.create(`kadr/cancel/${this.job}.json`,{at:this.clock(),expires:this.clock()+86400000});}
}
