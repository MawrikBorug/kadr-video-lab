import {savedPosition} from './collector.mjs';
export const JOURNAL_KEY = 'kadr.videoLab.experiments.v1';
export const OLD_LIFT_KEY = 'kadr.lift.journal.v1';
export const POSITION_KEY = 'kadr-lift-experiment-position';
export const LEGACY_KEY = 'kadr.videoLab.v1';
export const MAX_EVENTS = 3000;
export const utc = () => new Date().toISOString();

export const ORIGINAL_SUBJECT = {connection:'lift', materialId:3637, season:null, episode:null};
export function scopeKey(subject = ORIGINAL_SUBJECT) {
  return [subject.connection, subject.materialId, subject.season ?? '-', subject.episode ?? '-'].join(':');
}
export function makeRun(mode, build, subject = ORIGINAL_SUBJECT) {
  return {runId: crypto.randomUUID(), started: utc(), mode, build, subject: {...subject}, generation: 0, droppedEvents: 0,
    rejectedMessages: 0, diagnostics: {trusted:0, accepted:0, rejected:{}, progressReceived:0, progressAccepted:0, arrivalGapsMs:[]},
    events: [], lastPosition: null, observations: {},
    media: Object.fromEntries(['mainVideo','ruAudio','quality','subtitles','ads','navigation','seek','restore','episodeSelection','episodeEnded'].map(key=>[key,'NOT_RUN'])),
    catalog: null, ended: null};
}
export function append(run, event) {
  run.events.push(event);
  if (run.events.length > MAX_EVENTS) { run.events.shift(); run.droppedEvents++; }
  run.updated = event.utc;
}
export function readJournal(storage) {
  const raw = storage.getItem(JOURNAL_KEY);
  if (raw === null) return {schema: 3, runs: [], currentByMode: {}, positions: {}};
  const data = JSON.parse(raw);
  if (data?.schema !== 3 || !Array.isArray(data.runs) || !data.currentByMode || !data.positions
      || data.runs.some(r => !r || !/^[a-f0-9-]{36}$/.test(r.runId) || !['browser', 'safari', 'standalone'].includes(r.mode)
        || !r.subject || !['lift','wt-webrtc','wt-http'].includes(r.subject.connection)
        || !r.diagnostics || !Array.isArray(r.events) || r.events.length > MAX_EVENTS || !Number.isInteger(r.generation)
        || !r.observations || !Number.isFinite(Date.parse(r.started)))) throw Error('journal_invalid');
  return data;
}
export function readPosition(storage) {
  try { return savedPosition(JSON.parse(storage.getItem(POSITION_KEY) || 'null')); } catch { return null; }
}
export function previousLift(storage) {
  try { const raw = storage.getItem(OLD_LIFT_KEY); const data = raw ? JSON.parse(raw) : null; return data?.schema===2 && Array.isArray(data.runs) ? data : null; } catch { return null; }
}
export function positionFor(journal, subject, storage) {
  const value = savedPosition(journal.positions[scopeKey(subject)]);
  if (value) return value;
  // The old global key belongs only to Lift Sintel, never to another source or episode.
  return scopeKey(subject) === scopeKey(ORIGINAL_SUBJECT) ? readPosition(storage) : null;
}
export function exportResult(journal, run, environment, saved, oldLift = null) {
  return {schema: 3, kind: 'KADR_LIFT_STAND_EXPANSION', exported: utc(), runId: run.runId,
    environment, subject: run.subject,
    evidence: 'Real accepted iframe messages and manual observations are separate. No synthetic events in the live harness.',
    completion: 'Not calculated. endedSoon is not ended. No watched flag, coverage or queue.',
    savedPosition: saved, run, runs: journal.runs, positions: journal.positions, legacyLiftJournal: oldLift};
}
