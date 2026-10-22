import {savedPosition} from './collector.mjs';
export const JOURNAL_KEY = 'kadr.lift.journal.v1';
export const POSITION_KEY = 'kadr-lift-experiment-position';
export const LEGACY_KEY = 'kadr.videoLab.v1';
export const MAX_EVENTS = 3000;
export const utc = () => new Date().toISOString();

export function makeRun(mode, build) {
  return {runId: crypto.randomUUID(), started: utc(), mode, build, generation: 0, droppedEvents: 0,
    rejectedMessages: 0, events: [], lastPosition: null, observations: {}, ended: null};
}
export function append(run, event) {
  run.events.push(event);
  if (run.events.length > MAX_EVENTS) { run.events.shift(); run.droppedEvents++; }
  run.updated = event.utc;
}
export function readJournal(storage) {
  const raw = storage.getItem(JOURNAL_KEY);
  if (raw === null) return {schema: 2, runs: [], currentByMode: {}};
  const data = JSON.parse(raw);
  if (data?.schema !== 2 || !Array.isArray(data.runs) || !data.currentByMode
      || data.runs.some(r => !r || !/^[a-f0-9-]{36}$/.test(r.runId) || !['safari', 'standalone'].includes(r.mode)
        || !Array.isArray(r.events) || r.events.length > MAX_EVENTS || !Number.isInteger(r.generation)
        || !r.observations || !Number.isFinite(Date.parse(r.started)))) throw Error('journal_invalid');
  return data;
}
export function readPosition(storage) {
  try { return savedPosition(JSON.parse(storage.getItem(POSITION_KEY) || 'null')); } catch { return null; }
}
export function exportResult(journal, run, environment, saved) {
  return {schema: 2, kind: 'KADR_LIFT_STAND', exported: utc(), runId: run.runId,
    environment, material: {id: 3637, title: 'Sintel', year: 2010, track: 'original English only'},
    evidence: 'Real accepted iframe messages and manual observations are separate. No synthetic events in the live harness.',
    completion: 'Not calculated. endedSoon is not ended. No watched flag, coverage or queue.',
    savedPosition: saved, run, runs: journal.runs};
}
