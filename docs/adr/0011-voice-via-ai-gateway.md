# ADR-0011 — Voice lane маршрутизира през AI Gateway; provisioning-ът е git-деклариран

- **Статус:** Прието
- **Дата:** 2026-07-08
- **Обхват:** assistant voice lane (`/assistant/transcribe`), AI Gateway `sigma-assistant`

## Контекст

PR #66 първоначално извикваше BgGPT Whisper **директно, без AI Gateway** — мотивът беше, че gateway-ът
логва payload-и, а аудиото не бива да се персистира. Причините да минем все пак през gateway-а са две:
единна cost/latency observability, и **декларативна fallback оркестрация** (primary → fallback) на ниво
route, вместо в кода на приложението.

Важно разграничение спрямо [0009](0009-global-bggpt-cap-is-a-durable-object.md): глобалният BgGPT лимит
се налага от **Durable Object в request-пътя, не от AI Gateway**. Значи маршрутизирането на voice през
gateway-а само по себе си **не** го поставя под wallet cap-а — това остава грижа на DO-то. Gateway-ът тук
дава наблюдаемост и fallback, не rate limiting.

`custom provider` + `dynamic route` бяха вдигнати ръчно в dashboard-а. Ръчното състояние дрейфва тихо и не
е reviewable — при първото четене route-ът вече съдържаше грешки (текстов LLM като fallback вместо whisper,
3s timeout за 60s аудио).

## Решение

- Voice lane-ът маршрутизира транскрипцията през dynamic route `voice` на gateway-а `sigma-assistant`:
  primary custom provider `bggpt-voice` (`bggpt-whisper-large-v3`) → fallback `workers-ai`
  (`@cf/openai/whisper-large-v3-turbo`). Графът живее в `scripts/ai-gateway/voice-route.json`.
- Аудио-логването се потиска **per-request** (`cf-aig-collect-log: false`, code-level в request-пътя), а не
  чрез заобикаляне на gateway-а — гаранцията на #66 „аудио не се пише в gateway-а" се запазва.
- Provisioning-ът е **git-деклариран и идемпотентен**: `scripts/ensure-voice-provider.mjs` налага gateway
  + provider + route (dry-run по подразбиране; `--apply` в CI), по модела на `ensure-kv-namespace.mjs`.
  Тече в preview/dev/staging/prod. Gateway-ът е account-global (един за всички env-и), но route-дефиницията
  е env-agnostic, затова всеки env конвергира към същия reviewed граф.

## Последствия

- Voice получава единна cost/latency observability и reviewable, декларативен fallback (без fallback-код в
  приложението).
- Route-конфигурацията е reviewable в git, не dashboard-only; дрейфът се коригира при всеки deploy.
- Изгладени спрямо ръчния route: fallback модел (текстов LLM → whisper-turbo), primary timeout
  (3000ms → 20000ms, съвпада с 20s client fetch timeout), retries (3 → 1 на платения primary).
- **DoW/rate защита НЕ идва оттук**: по [0009](0009-global-bggpt-cap-is-a-durable-object.md) глобалният
  BgGPT cap е Durable Object в request-пътя. Wallet защитата на voice зависи от това DO-то да покрива и
  `/assistant/transcribe` пътя — отделен follow-up, не част от тази промяна.
- Компромис: gateway-ът е споделен — merge на промяна в `voice-route.json` засяга route-а, който prod
  обслужва (смекчено от PR review + идемпотентния converge към committed граф).
- Follow-up: аудио-приватността вече зависи от per-request хедър (`cf-aig-collect-log: false`, code-level,
  lane на Niki) — нужен е тест, че хедърът винаги присъства във voice заявката.
