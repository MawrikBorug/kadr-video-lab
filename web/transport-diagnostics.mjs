// Observed stages only. A timeout cannot prove that a public swarm has no seeders.
export function transportTimeout(state, httpOnly=false) {
  const steps=state.steps || {};
  if(steps.library!=='ready')return {code:'LIBRARY_NOT_READY',label:'Браузерная библиотека не загрузилась'};
  if(steps.worker!=='ready')return {code:'WORKER_NOT_READY',label:'Не готов локальный Service Worker потока'};
  if(!state.metadataReady)return {code:'METADATA_NOT_READY',label:'Не получены или не проверены metadata раздачи'};
  if(httpOnly)return {code:state.webSeedConnections?'WEBSEED_NO_PAYLOAD':'WEBSEED_NOT_CONNECTED',label:'HTTP webseed не передал медиабайты; P2P выключен'};
  if(state.nativeIceComplete && !state.nativeIceCandidates)return {code:'LOCAL_ICE_NO_CANDIDATES',label:'Локальная ICE-проба завершена без кандидатов. Сетевые/браузерные ограничения возможны; отсутствие сидеров этим не доказано'};
  if(state.iceFailures)return {code:'ICE_OR_RTC_FAILED',label:'Наблюдалась ошибка ICE/WebRTC после обнаружения кандидата'};
  if(!state.trackerAnnounces)return {code:'NO_TRACKER_RESPONSE',label:'Нет ответа трекеров; проверьте сигнализацию и сеть'};
  if(!state.peersDiscovered)return {code:'NO_COMPATIBLE_PEER_OBSERVED',label:'Совместимый кандидат за время пробы не обнаружен. Отсутствие сидеров не доказано'};
  if(!state.peersWebRTC)return {code:'RTC_NOT_CONNECTED',label:'Кандидат обнаружен, но WebRTC-соединение не установлено'};
  return {code:'RTC_NO_PAYLOAD',label:'WebRTC-соединение есть, но медиабайты не получены'};
}
