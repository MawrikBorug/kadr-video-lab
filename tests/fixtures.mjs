// Synthetic manual records for regressions only. No provider playback occurred.
import { makeRecord } from '../web/core.js';
export function passedE1() {
  const r = makeRecord({ provider:'yapgrid', namespace:'tmdb', type:'movie', id:'693134', sampleKey:'dune', title:'Synthetic fixture — not a playback result', season:'1', episode:'1', quality:'480', sandbox:'strict', stage:'E1', watchScope:'smoke', accessAcknowledged:true },
    { device:'iphone-safari', country:'RU', network:'home', blocker:'off', sessionId:'synthetic-e1' }, '2026-10-17T00:00:00Z', 'synthetic-e1');
  r.endedAt = '2026-10-17T00:10:00Z'; r.status = 'PASS';
  for (const key of ['pageOpened','exactTitle','videoStarted','fiveMinutes','seek50']) r.checks[key] = 'PASS';
  Object.assign(r.details, { startSeconds:'5', seekRecoverySeconds:'2', voice:'Synthetic language observation; not an actual film', notes:'Fixture only' });
  return r;
}
export function completedE2(e1 = passedE1()) {
  const r = makeRecord({ ...e1.config, stage:'E2', watchScope:'full', e1RecordId:e1.id }, { ...e1.environment, network:'mobile', sessionId:'synthetic-e2' }, '2026-10-17T00:11:00Z', 'synthetic-e2');
  r.endedAt = '2026-10-17T02:00:00Z'; r.status = 'PASS';
  for (const key of ['pageOpened','exactTitle','videoStarted','pause','ended','fullNoAds']) r.checks[key] = 'PASS';
  for (const key of Object.keys(r.ads)) r.ads[key] = 'NOT_OBSERVED';
  r.details.notes = 'Fixture only — no real playback';
  return r;
}
