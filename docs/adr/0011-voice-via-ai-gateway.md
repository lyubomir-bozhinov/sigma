# ADR-0011 — Voice lane маршрутизира през AI Gateway; provisioning-ът е git-деклариран

- **Статус:** Прието
- **Дата:** 2026-07-08
- **Обхват:** assistant voice lane (`/assistant/transcribe`), AI Gateway `sigma-assistant`

## Контекст

PR #66 извикваше BgGPT Whisper **директно, без AI Gateway**, защото gateway-ът логва payload-и, а аудиото
не бива да се персистира. Минаваме все пак през gateway-а заради единна cost/latency/rate observability —
но при **твърдо условие**: аудиото остава transient. Моделите са само транскрибери: `audio → text`, а
текстът отива към главния chat модел; **нищо (D1/R2/KV/disk/gateway logs/cache) не персистира аудио**.

Емпирично установено (2026-07-08): **един dynamic route с primary+fallback не работи за аудио.** Gateway-ът
препраща тялото непроменено, а провайдърите искат несъвместими формати: BgGPT = multipart
`/audio/transcriptions`; Workers AI whisper = JSON `{ audio: base64 }` (multipart → HTTP 400); Deepgram
Nova-3 = raw bytes. Няма CF-native STT модел с multipart, а gateway-ът не транскодира аудио (OpenAI-compat
слоят е само за chat). Значи един body не може да храни два провайдъра.

Разграничение спрямо [0009](0009-global-bggpt-cap-is-a-durable-object.md): глобалният BgGPT лимит е Durable
Object в request-пътя, **не** gateway-ът — маршрутизирането през gateway-а не дава wallet cap.

## Решение

- Route `voice` носи **само** primary-а `custom-bggpt-voice` (`bggpt-whisper-large-v3`), без in-route
  fallback (`fallback → END`). Граф в `scripts/ai-gateway/voice-route.json`.
- Fallback-ът е **отделен dynamic route `voice-fallback` с отделен провайдър** — CF-native Workers AI
  whisper (JSON base64), за да остане аудиото на CF/INSAIT infra (без US egress). Provisioning по същия
  gitops модел (follow-up).
- Оркестрацията е **code-level** (lane на Niki): app-ът вика `voice`, при неуспех `voice-fallback`, всеки
  route със собствения си формат. Разделянето маха несъвместимостта на форматите.
- **Аудиото не се персистира.** Всяка STT заявка през gateway-а носи `cf-aig-collect-log: false` (спира
  body-логването); `cache_ttl=0` (без кеш на аудио). Това е **load-bearing** — решението „voice през
  gateway" зависи от него; ако log-suppression не пази аудиото, връщаме се на директни извиквания за аудио.
- Provisioning-ът е git-деклариран и идемпотентен (`scripts/ensure-voice-provider.mjs`, `--apply` в CI).
  Gateway-ът е account-global; route-дефиницията е env-agnostic → всеки env конвергира към същия граф.

## Последствия

- И двата STT крака минават през gateway-а → observability на primary **и** fallback (директният
  `env.AI.run` bypass не даваше това), при запазена transient-аудио гаранция.
- Sovereignty: fallback остава CF-native (Workers AI) — без audio egress към US (Groq/OpenAI отхвърлени).
- Изгладено спрямо ръчния route: махнат невалидният `workers-ai` fallback node (грешен формат, емпирично
  HTTP 400); primary timeout (3000ms → 20000ms), retries (3 → 1 на платения primary).
- Цена: повече code-level routing (два route-а, два формата, app-side fallback решение) — lane на Niki.
- **DoW/rate защита не идва оттук** ([0009](0009-global-bggpt-cap-is-a-durable-object.md) — DO); wallet
  защитата на voice зависи DO-то да покрива `/assistant/transcribe` — отделен follow-up.
- Компромис: gateway-ът е споделен — промяна в графа засяга route-а, който prod обслужва (смекчено от PR
  review + идемпотентния converge).
- **MUST-verify (follow-up, преди да разчитаме на пътя):** (1) `cf-aig-collect-log: false` реално спира
  съхранението на аудио (провери през Logs API); (2) Workers AI whisper резолвва през dynamic route с JSON
  base64; (3) хедърът за log-suppression винаги присъства във voice заявките (тест).
