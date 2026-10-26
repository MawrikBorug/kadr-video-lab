// Isolated diagnostic for commands found in the native Lift embed HTML.
// No playback, authentication or guessed pause/seek commands.
const ORIGIN = 'https://embed.liftw.ws';
const KEYS = ['quality', 'sound', 'cc', 'speed'];
export function safeValue(v) {
  return (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e6) ||
    (typeof v === 'string' && v.length <= 80 && !/[<>]|https?:|\/\/|[A-Za-z0-9_+=/-]{32,}/i.test(v));
}
export function parseSetting(data) {
  if (!data || typeof data !== 'object' || !KEYS.includes(data.key)) return null;
  if (data.event === 'setting ls' && Array.isArray(data.ls) && data.ls.length <= 100 && data.ls.every(safeValue))
    return {event: data.event, key: data.key, ls: [...data.ls]};
  if (data.event === 'setting' && safeValue(data.value))
    return {event: data.event, key: data.key, value: data.value};
  return null;
}
export function attachLiftSettingsProbe(frame, generation, currentGeneration) {
  if (new URL(frame.src).origin !== ORIGIN) throw Error('Unexpected frame origin');
  let disposed = false, seq = 0;
  const lists = {}, records = [];
  const panel = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'A01: штатные настройки Lift — диагностическая проверка';
  panel.append(summary);
  const intro = document.createElement('p');
  intro.textContent = 'Кодовый контракт найден. Ответ и фактическое изменение ещё требуют проверки. Команд паузы и перемотки эта панель не отправляет.';
  panel.append(intro);
  const output = document.createElement('pre'); output.setAttribute('aria-live', 'polite');
  const selectByKey = {};
  const record = value => { records.push({utc: new Date().toISOString(), seq: ++seq, generation, ...value}); if (records.length > 250) records.shift(); output.textContent = JSON.stringify(records.slice(-20), null, 2); };
  const valid = () => !disposed && frame.isConnected && generation === currentGeneration();
  const send = command => { if (!valid()) return; frame.contentWindow.postMessage(command, ORIGIN); record({kind: 'command', command}); };
  for (const key of KEYS) {
    const row = document.createElement('p');
    const title = document.createElement('strong'); title.textContent = key + ' '; row.append(title);
    for (const [name, req] of [['Список', 'setting ls'], ['Прочитать', 'setting get']]) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = name; b.onclick = () => send({req, key}); row.append(b);
    }
    const select = document.createElement('select'); select.setAttribute('aria-label', key + ': значение из ответа Lift'); select.disabled = true; row.append(select); selectByKey[key] = select;
    const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = 'Установить';
    apply.onclick = () => { const value = lists[key]?.[select.selectedIndex]; if (!safeValue(value) || !lists[key]?.includes(value)) return; send({req: 'setting set', key, value}); };
    row.append(apply); panel.append(row);
  }
  const listener = e => {
    if (!valid() || e.origin !== ORIGIN || e.source !== frame.contentWindow) return;
    const value = parseSetting(e.data); if (!value) return;
    record({kind: 'reply', ...value});
    if (value.event === 'setting ls') {
      lists[value.key] = value.ls;
      const select = selectByKey[value.key]; select.replaceChildren(...value.ls.map(v => new Option(String(v)))); select.disabled = !value.ls.length;
    }
  };
  const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.textContent = 'Экспорт JSON A01';
  exportButton.onclick = () => {
    const a = document.createElement('a'); const url = URL.createObjectURL(new Blob([JSON.stringify({scope: 'A01 settings diagnostic; observations are not automatic proof of actual track/quality', records}, null, 2)], {type: 'application/json'}));
    a.href = url; a.download = 'KADR_A01_SETTINGS.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  panel.append(exportButton, output); frame.parentElement.after(panel); addEventListener('message', listener);
  return {dispose() { disposed = true; removeEventListener('message', listener); panel.remove(); }};
}
