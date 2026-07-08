# ADR-0008 — Voice lane маршрутизира през AI Gateway; provisioning-ът е git-деклариран

- **Статус:** Прието
- **Дата:** 2026-07-08
- **Обхват:** assistant voice lane (`/assistant/transcribe`), AI Gateway `sigma-assistant`

## Контекст

PR #66 първоначално извикваше BgGPT Whisper **директно, без AI Gateway** — мотивът беше, че gateway-ът
логва payload-и, а аудиото не бива да се персистира. Но директният път заобикаля и глобалния BgGPT rate
cap, и cost/observability-то на gateway-а — точно account-wide denial-of-wallet breaker-а, който #66
отложи като launch-gate. Voice остава извън единния бюджет: транскрипция може да изразходва платения
BgGPT endpoint, без да се брои срещу общия cap.

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

- Voice влиза в единния BgGPT rate cap / DoW breaker и cost observability-то на gateway-а.
- Route-конфигурацията е reviewable в git, не dashboard-only; дрейфът се коригира при всеки deploy.
- Изгладени спрямо ръчния route: fallback модел (текстов LLM → whisper-turbo), primary timeout
  (3000ms → 20000ms, съвпада с 20s client fetch timeout), retries (3 → 1 на платения primary).
- Компромис: gateway-ът е споделен — merge на промяна в `voice-route.json` засяга route-а, който prod
  обслужва (смекчено от PR review + идемпотентния converge към committed граф).
- Follow-up: аудио-приватността вече зависи от per-request хедър (`cf-aig-collect-log: false`), не от
  заобикаляне на gateway-а — нужен е тест, че хедърът винаги присъства в voice заявката.
