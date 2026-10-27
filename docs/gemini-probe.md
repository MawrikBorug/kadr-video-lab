# Gemini: один ручной тест технического доступа

Это отдельный диагностический тест, аналог существующего Groq probe. Он отправляет один фиксированный короткий синтетический текст в `gemini-3.5-flash-lite` через `generateContent`. Нет кадров, пользовательских данных, поиска моделей, tools, файлов, кешей, фоновых заданий или SDK. `maxOutputTokens=64`; исчерпание cap не выдаётся за качество PASS.

## Два действия после проверенного merge

1. В [repository Actions secrets](https://github.com/MawrikBorug/kadr-video-lab/settings/secrets/actions) добавить **GEMINI_API_KEY** собственного существующего **Free** API project, если секрет ещё не настроен. Значение вводить только в GitHub Secret. Не использовать ключ платного проекта, не включать billing, не присылать ключ в чат/Drive/issue. Подписка AI Pro не доказывает API-key или API-квоты.
2. В [Actions](https://github.com/MawrikBorug/kadr-video-lab/actions) выбрать **Gemini access probe (manual)** → **Run workflow** → **main**, включить `confirm_one_request`, запустить один раз под **MawrikBorug**. Обычная кнопка workflow_dispatch требует workflow в default branch. До merge не запускать. Если текущий Free API key отсутствует, это точный блокер, а не разрешение создавать новый аккаунт/платёжный проект.

Секрет только в заголовке `x-goog-api-key`, никогда в query URL. Запрос уходит напрямую на фиксированные HTTPS host/path с проверкой сертификата; redirects, proxy env и retries не используются. Таймаут/транспортная ошибка дают неизвестный исход и не повторяются. `Re-run jobs` блокируется; новый manual run — отдельная потенциально расходующая квоту попытка.

## Что доказывает результат

`ACCESS_CONFIRMED` — один HTTP200 ответ запрошенной модели, один candidate с STOP и текстом. Текст не сохраняется и не оценивается. `ACCESS_CONFIRMED_INCOMPLETE` — корректный ответ с другим известным finishReason, например MAX_TOKENS; это не полноценное завершение или PASS качества. Отсутствующий ключ — NOT_RUN, 0 запросов. 401/403/404/429 фиксируются без чтения provider error body и без догадок о причине: один HTTP403 не доказывает региональную причину.

В логе и artifact только фиксированный requested model ID, проверка совпадения версии (boolean), HTTP status, latency, ограниченные числовые usageMetadata, числовой Retry-After при наличии. Не публикуются raw response/modelVersion, prompts, outputs, request/response IDs, полные headers, ошибки и секреты. Artifact содержит только `artifacts/gemini-probe/report.json`, хранится 7 дней. В public repo безопасные usage-метрики могут быть видимы другим. Usage token fields сохраняются отдельно: thoughts/cached counters нельзя произвольно второй раз прибавлять к total.

Этот тест с GitHub-hosted runner не подтверждает доступ iPhone из РФ, соблюдение региональных условий, текущую политику данных, все квоты, качество vision, рекомендации или полноценные автоматические разборы. Официальный список доступных регионов и условия остаются отдельным договорным ограничением; отсутствие РФ в списке не объявляется доказанной технической неисправностью и не исключает Gemini автоматически. Обхода/маскировки региона в probe нет. Сообщённый владельцем прошлый успех Gemini в Telegram — полезный контекст, а не результат нынешней проверки.

Полноценные спойлерные разборы со всеми согласованными разделами и серверными gates остаются обязательным следующим eval. Шаблоны вместо разбора и Максим как постоянный редактор не утверждены. Нынешний API-запрос синтетический: Free-условия Gemini допускают использование вводов/выводов для улучшения продуктов и human review, поэтому личные/конфиденциальные данные сюда не передаются.

## Контроль и побочные действия

Owner/main/manual-confirm/attempt1 gates, pinned checkout/upload actions, contents:read, отсутствие секретов в offline tests. Safety tests используют только fake transport; Node wrapper включает их в прежний Verify npm test. Groq script/workflow остаются без изменений. В Pages paths-ignore добавлены ровно пять Gemini paths; существующее исключение pages.yml сохранено. Поэтому Gemini-probe-only merge не публикует стенд, изменения других путей сохраняют прежний Pages запуск. Verify PR/push остаётся прежним; Controlled A не запускается этой веткой.

На 27.10.2026 официальный каталог помечает `gemini-3.5-flash-lite` Stable, pricing показывает Free text input/output, deprecations не объявляет shutdown. Собственная доступность модели и квоты ещё не проверены. Семейство 2.5 теперь ограничено ранее активными пользователями, поэтому его старые ID не перенесены автоматически.

Первичные источники:

- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite
- https://ai.google.dev/gemini-api/docs/models
- https://ai.google.dev/gemini-api/docs/deprecations
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/api-key
- https://ai.google.dev/gemini-api/docs/available-regions
- https://ai.google.dev/gemini-api/terms
