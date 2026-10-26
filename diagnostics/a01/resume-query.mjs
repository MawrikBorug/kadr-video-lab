// SDK 0.3.6 reads `t` from the embedding document referrer, not the signed iframe URL.
// Diagnostic-only: never expose arbitrary application/auth URLs through unsafe-url.
export function resumePlan(href, seconds = null) {
  const url=new URL(href);
  const publicLab=url.origin==='https://mawrikborug.github.io' && url.pathname==='/kadr-video-lab/a01/';
  const localLab=url.origin==='http://terminal.local:4173' && url.pathname==='/';
  if(!publicLab && !localLab)throw Error('resume_path_not_allowed');
  if(url.username || url.password || url.hash || [...url.searchParams.keys()].some(k=>k!=='t'))throw Error('resume_url_not_public_clean');
  url.search='';
  if(seconds!==null) {
    if(!Number.isFinite(seconds) || seconds<1 || seconds>86400)throw Error('resume_time_invalid');
    url.searchParams.set('t',String(Math.floor(seconds)));
  }
  return {href:url.href,referrerPolicy:seconds===null?null:'unsafe-url',seconds:seconds===null?null:Math.floor(seconds)};
}
export function checkpointSeconds(saved, material) {
  if(material.series || !saved || !Number.isFinite(saved.time) || !Number.isFinite(saved.duration) || saved.time<1 || saved.time>=saved.duration)throw Error('resume_checkpoint_unavailable');
  return Math.floor(saved.time);
}
