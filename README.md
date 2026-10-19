# КАДР Video Lab · ТЗ 1.2

Существующий лабораторный стенд расширен по [заданию 1.2](https://docs.google.com/document/d/1uutRVC3PKUMCM1RfdT3uF12oQL8679N7RNjNsBUysAQ/edit). Публикация: https://mawrikborug.github.io/kadr-video-lab/.

Сохранены ручные ID/alias/S/E, журнал, E1/E2, JSON/CSV и файловый Share. Добавлены N14, реестр всех 125 C/X/L ID, подключения по исследованию, очередь выбранных режимов и произведений, пауза/пропуск/отмена, сохранение и возобновление, повторы с устойчивыми связями, частичный экспорт и объединение журналов.

Схема 2 читает старый журнал через прежний ключ `kadr.videoLab.v1`. Переполнение хранилища и повреждение данных видимы; исходный повреждённый журнал не перезаписывается. Media, cookies и секреты не кешируются. L4/L5 автоматически не присваиваются. Успех тестовых Apple/Blender не означает работоспособность N14.

Реализация и ограничения: [docs/implementation-1.2.md](docs/implementation-1.2.md), [режимы](docs/providers-1.2.md), [доступы](docs/access-1.2.md). Старые документы `docs/*` без суффикса 1.2, `evidence/probes.json` и `protocol/blank-results.json` сохранены как исторические материалы версии 3.3.

## Проверки для разработчика / CI

Node 24, без новых платных зависимостей:

```sh
npm ci --ignore-scripts
npm test
npm run build
node scripts/check-public.mjs
npx playwright install --with-deps chromium
npm run test:browser
npm run package
```

Browser-тесты используют явно синтетические фикстуры и блокируют внешнюю сеть. `scripts/live-browser.mjs` отдельно измеряет живые источники и сохраняет обезличенные результаты в `artifacts/`; переменная `LAB_URL` задаёт проверяемую сборку, `EXPECTED_COMMIT` проверяет её commit. Это облачный Chromium, а не физический Safari/PWA в России.

Публичная сборка — `dist/`. В ней нет `server/`, `.env` или provider credentials. `server/adapter.mjs` содержит отдельный подготовленный закрытый адаптер; он не размещён на Pages. Собственные доступы ещё не выданы.

GitHub Actions публикует только main после unit/browser/build-проверок и затем проверяет реальный HTTPS и build commit. Резерв исходника: ветка `archive/pre-spec-1-2-8936701`, commit `893670116e0112d8d355ec4295f1c6e402aa9e00`. Откат выполняется восстановлением её дерева отдельным commit в main; журнал предварительно сохраняется в расширенной схеме.
