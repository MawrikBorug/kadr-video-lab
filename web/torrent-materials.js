// Public, permitted fixtures. These are not signed media URLs or a Webtor API.
export const TORRENT_MATERIALS = [
  {id:'sintel-public', title:'Sintel · открытая раздача WebTorrent', year:2010,
    infoHash:'08ada5a7a6183aae1e09d831df6748d566095a10', metadata:'fixtures/sintel.torrent',
    filename:'Sintel.mp4', size:129241752, container:'MP4', codecs:'H.264 + AAC',
    source:'https://webtorrent.io/torrents/', webseed:'https://webtorrent.io/torrents/', license:'CC BY 3.0 · Blender Foundation',
    dependency:'WebRTC: нужны совместимые доступные пиры. HTTP: внешний webseed webtorrent.io.',
    allowed:['wt-webrtc','wt-http']},
  {id:'kadr-control', title:'Контроль КАДРа · 60 секунд, синтетика',
    infoHash:'05b36bedda4c62b73af236553176141c51912689', metadata:'fixtures/kadr-control-60s.torrent',
    filename:'kadr-control-60s.mp4', size:572719, container:'MP4', codecs:'H.264 + 2 AAC (тоны, без речи)',
    source:'Собственный математический ролик из исследования КАДРа', license:'Разрешённый тестовый материал автора исследования',
    dependency:'Требуется временная браузерная вкладка-сидер разработчика. Это не автономная публичная раздача.',
    seedFile:'fixtures/kadr-control-60s.mp4', allowed:['wt-webrtc']},
];
export const TRACKERS = ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev'];
