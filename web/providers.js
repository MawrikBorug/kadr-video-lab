export const PROVIDERS = Object.freeze({
  aniliberty: {
    name: 'AniLiberty v1', kind: 'hls', enabled: true,
    gate: 'VERIFIED_DOCUMENTATION', live: 'PASS · JSON / HLS / 1024 байта сегмента',
    source: 'https://anilibria.top/api/docs/v1',
    description: 'Аниме по ID или alias релиза AniLiberty. Сезоны — отдельные релизы; эпизод выбирается по ordinal. Бесплатный анонимный ответ получен; условий SLA и лицензии на каталог это не подтверждает.',
    limitation: 'В выданных URL isWithVideoAds=1 и isWithVideoAdsAlways=1. Параметры сохраняются. Наличие рекламы, русской дорожки и работа на iPhone / в РФ не проверены.',
    namespace: 'AniLiberty ID / alias',
  },
  yapgrid: {
    name: 'YapGrid', kind: 'iframe', enabled: true,
    gate: 'VERIFIED_DOCUMENTATION', live: 'INCONCLUSIVE · embed вернул HTTP 403 в облаке',
    source: 'https://github.com/enikqi/yapgrid',
    description: 'Документирован публичный embed без ключа по TMDB: /embed/movie/{id} или /embed/tv/{id}/{season}/{episode}. Автор заявляет ad-free; это не результат просмотра.',
    limitation: 'Контракт postMessage и внешние команды управления не опубликованы в проверенных документах. Все сообщения iframe отклоняются. DOM, дорожки, реклама и конечный медиахост из родительской страницы недоступны.',
    namespace: 'TMDB ID', origin: 'https://yapgrid.com',
  },
  stellar: {
    name: 'Stellar', enabled: false, kind: 'unconfirmed', gate: 'INCONCLUSIVE', live: 'HTTP 403 · error code 1010',
    source: 'https://stellar.rip/en/api', namespace: 'Не подтверждён',
    description: 'Текущая первичная документация в этой среде недоступна. Старый отчёт не заменяет проверку контракта.',
    limitation: 'Источник не подтвердился. URL плеера, сообщения и условия не додумываются.',
  },
  mapple: {
    name: 'Mapple Player', enabled: false, kind: 'unconfirmed', gate: 'INCONCLUSIVE', live: 'HTTP 403 · error code 1010',
    source: 'https://mappletv.uk/', namespace: 'Не подтверждён',
    description: 'Текущая первичная документация в этой среде недоступна. Публичный режим и условия пока не подтверждены.',
    limitation: 'Источник не подтвердился. Embed и обработчики сообщений отключены.',
  },
  ezvidapi: {
    name: 'ezvidapi', enabled: false, kind: 'unconfirmed', gate: 'INCONCLUSIVE', live: 'HTTP 403 · error code 1010',
    source: 'https://ezvidapi.com/', namespace: 'Не подтверждён',
    description: 'Live-документация недоступна. Выдача stream_url, бесплатность и отсутствие ключа не подтверждены.',
    limitation: 'Источник не подтвердился. Непроверенные endpoints не вызываются.',
  },
});

export const SANDBOX = Object.freeze({
  strict: 'allow-scripts allow-same-origin',
  popups: 'allow-scripts allow-same-origin allow-popups',
  documented: null,
});

export function buildRequest(config) {
  const provider = PROVIDERS[config.provider];
  if (!provider?.enabled) throw new Error('Источник не подтвердился: актуальный публичный контракт недоступен.');
  const id = String(config.id ?? '').trim();
  if (provider.kind === 'iframe') {
    if (config.namespace !== 'tmdb') throw new Error('YapGrid принимает только TMDB ID. IMDb нельзя подставлять вместо TMDB.');
    if (!/^[1-9]\d{0,9}$/.test(id)) throw new Error('Укажите числовой TMDB ID без URL.');
    if (!['movie', 'tv'].includes(config.type)) throw new Error('Выберите фильм или эпизод сериала.');
    let path = `movie/${id}`;
    if (config.type === 'tv') {
      for (const value of [config.season, config.episode]) {
        if (!/^[1-9]\d{0,2}$/.test(String(value))) throw new Error('Сезон и эпизод: целые числа от 1 до 999.');
      }
      path = `tv/${id}/${config.season}/${config.episode}`;
    }
    if (!(config.sandbox in SANDBOX)) throw new Error('Неизвестный режим sandbox.');
    if (config.sandbox === 'documented' && !config.unrestrictedConsent) throw new Error('Для режима без sandbox подтвердите предупреждение об окнах и навигации.');
    if (config.sandbox === 'documented' && !config.cleanSessionConsent) throw new Error('Без sandbox допускается только отдельная чистая тестовая сессия после strict-пробы. Подтвердите это отдельно; не используйте режим первым тестом на личном iPhone.');
    return { kind: 'iframe', url: `https://yapgrid.com/embed/${path}`, origin: provider.origin, sandbox: SANDBOX[config.sandbox] };
  }
  if (config.namespace !== 'aniliberty' || config.type !== 'tv') throw new Error('AniLiberty: выберите аниме-эпизод и ID / alias релиза, а не TMDB или IMDb.');
  if (!/^(?:[1-9]\d{0,8}|[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(id) || id.length > 120) throw new Error('ID / alias AniLiberty содержит недопустимые символы.');
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(String(config.episode)) || Number(config.episode) <= 0) throw new Error('Укажите ordinal эпизода, например 1 или 12.5.');
  if (!['480', '720', '1080'].includes(config.quality)) throw new Error('Выберите качество из списка.');
  return { kind: 'hls', url: `https://anilibria.top/api/v1/anime/releases/${encodeURIComponent(id)}` };
}

export function selectEpisode(release, ordinal, quality) {
  if (!release || !Array.isArray(release.episodes) || typeof release.name?.main !== 'string') throw new Error('Источник не подтвердился: неверная структура релиза.');
  const episode = release.episodes.find(item => Number(item.ordinal) === Number(ordinal));
  if (!episode) throw new Error('Этот эпизод не найден в ответе API. Это не проверка всего каталога.');
  const raw = episode[`hls_${quality}`];
  if (typeof raw !== 'string' || raw.length > 4096) throw new Error('В ответе нет публичного HLS выбранного качества.');
  const url = new URL(raw);
  const hosts = ['libria.fun', 'anilibria.top', 'aniliberty.top'];
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error('Новый или небезопасный медиахост: нужна повторная проверка контракта.');
  return { url: raw, origin: url.origin, title: release.name.main.slice(0, 200), episodeName: String(episode.name ?? '').slice(0, 200), ordinal: Number(episode.ordinal), duration: Number(episode.duration) || null };
}
