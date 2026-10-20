export function newMeasurement() {
  return { intervals: [], watchSeconds: 0, uniqueSeconds: 0, duration: null, coverage: 0, ended: false, completed: false, last: null, mainVideo: false, source: 'native-events', commands: {} };
}

export function unionIntervals(intervals) {
  const result = [];
  for (const [a,b] of intervals.filter(([a,b]) => Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > a).sort((x,y) => x[0]-y[0])) {
    const last = result.at(-1);
    if (last && a <= last[1] + 0.05) last[1] = Math.max(last[1],b); else result.push([a,b]);
  }
  return result;
}

export function excludeUncertainAdWindow(m,at=new Date().toISOString()) {
  // If an insertion was reported after it began, its boundary cannot be inferred
  // from currentTime. Preserve that window as uncertain, never as main viewing.
  m.uncertainAdWindows ||= [];
  m.uncertainAdWindows.push({at,intervals:m.intervals,watchSeconds:m.watchSeconds,uniqueSeconds:m.uniqueSeconds,reason:'manual-ad-reported-without-prior-boundary'});
  m.intervals=[];m.watchSeconds=0;m.uniqueSeconds=0;m.coverage=0;m.completed=false;m.last=null;m.mainVideo=false;
  return m;
}

export function sampleMeasurement(m, { position, duration, now, visible, playing, seeking, mainVideo }) {
  if (Number.isFinite(duration) && duration > 0) m.duration = duration;
  m.mainVideo = Boolean(mainVideo);
  const last = m.last;
  if (last && visible && playing && !seeking && mainVideo && last.eligible) {
    const wall = (now-last.now)/1000, delta = position-last.position;
    // Seek, playback-rate jumps and suspended iOS timers cannot create viewing time.
    if (wall > 0 && wall <= 2.5 && delta > 0 && delta <= wall*1.4 + 0.15) {
      m.watchSeconds += Math.min(wall,delta);
      m.intervals = unionIntervals([...m.intervals,[last.position,position]]);
    }
  }
  m.last = { position, now, eligible: Boolean(visible && playing && !seeking && mainVideo) };
  m.uniqueSeconds = m.intervals.reduce((sum,[a,b]) => sum+b-a,0);
  m.coverage = m.duration ? Math.min(1,m.uniqueSeconds/m.duration) : 0;
  m.completed = Boolean(m.ended && m.coverage >= .9 && mainVideo);
  return m;
}

export function evidenceLevel(record) {
  const m = record.measurement;
  // L4/L5 are never inferred from a fast run, a browser UA, iframe load or elapsed wall time.
  if (m?.mainVideo && m.watchSeconds > 0 && record.layers?.mainVideo?.status === 'observed') return 'L3';
  if (record.layers?.identity?.status === 'matched') return 'L2';
  if (record.layers?.catalog?.status === 'observed') return 'L1';
  return 'L0';
}

// The ladder describes technical evidence. A manual observation is a separate,
// useful result even when the cross-origin player exposes no trustworthy media API.
export function evidenceSummary(record) {
  const level=evidenceLevel(record),layer=record.layers?.mainVideo;
  const latest=(record.manualConfirmations||[]).filter(x=>x.field==='mainVideo').at(-1);
  const manual=latest ? latest.value===true : layer?.status==='observed-manual'&&layer.source==='manual';
  return {modelVersion:2,technicalLevel:level,manualMainVideo:manual,
    mainVideoSource:manual?'manual-observer':layer?.status==='observed'?'native-events':'unconfirmed',
    summary:manual?`Основное видео подтверждено вручную; технический уровень ${level}`:`Технический уровень ${level}; ручное подтверждение основного видео отсутствует`,
    scope:'this-attempt-only',automaticFullSession:false};
}

export function requestRestore(measurement,position,source='manual-command',at=new Date().toISOString()) {
  measurement.last=null;
  measurement.commands.restore={status:'requested',position,source,requestedAt:at,completed:false,playbackResumed:false};
}
export function observeRestore(measurement,{position,seeking,event,at=new Date().toISOString()}) {
  const r=measurement.commands?.restore;if(!r)return false;
  if(r.status==='requested'&&!seeking&&Math.abs(position-r.position)<=.35&&['seeked','position-readback'].includes(event)) {
    Object.assign(r,{status:'observed',completed:true,observedAt:at,observedPosition:position,confirmationSource:'native-'+event});return true;
  }
  if(r.completed&&event==='progress'&&position>r.observedPosition+.2){r.playbackResumed=true;r.resumedAt??=at;return true;}
  return false;
}
