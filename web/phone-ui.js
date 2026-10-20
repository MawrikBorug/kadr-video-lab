const $=id=>document.getElementById(id);
export function initPhoneUI({applyConditions,retry,diagnostic,current,notice}){
 for(const key of ['device','country','network','vpn','blocker']){
  const target=$('next-'+key);target.replaceChildren(...[...$(key).options].map(o=>o.cloneNode(true)));target.value=$(key).value;
 }
 $('conditions-apply').onclick=()=>{
  const env={};for(const key of ['device','country','network','vpn','blocker'])env[key]=$('next-'+key).value;
  env.notes=$('next-notes').value;env.confirmationSource='manual-conditions-form';env.conditionsConfirmedAt=new Date().toISOString();env.conditionSetId=crypto.randomUUID();
  applyConditions(env);$('conditions-summary').textContent=`Для новых попыток: ${env.device}, ${env.country}, ${env.network}, VPN ${env.vpn}. Старые условия сохранены.`;
 };
 $('retry-conditions').onclick=()=>retry();
 $('diagnostic-show').onclick=()=>{if(!current()){notice('Сначала откройте iframe-источник.',true);return;}$('diagnostic-panel').hidden=false;$('diagnostic-ack').checked=false;};
 $('diagnostic-start').onclick=()=>{if(!$('diagnostic-ack').checked){notice('Нужно явно подтвердить предупреждение перед диагностическим запуском.',true);return;}diagnostic(false);};
 $('diagnostic-external').onclick=()=>{if(!$('diagnostic-ack').checked){notice('Подтвердите предупреждение для отдельной диагностической вкладки.',true);return;}diagnostic(true);};
 $('diagnostic-cancel').onclick=()=>{$('diagnostic-panel').hidden=true;};
}
