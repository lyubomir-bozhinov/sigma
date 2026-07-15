# Разделяне на акаунти: dev + preview на отделен Cloudflare акаунт

Средите **dev** и **preview** живеят на **отделен Cloudflare акаунт** от production/staging. Целта е
изолация: dev/preview данните (изцяло възстановими от публичната EOP емисия) и техните ресурси никога
не докосват production акаунта, а един компрометиран dev/preview token няма достъп до prod.

| | dev + preview | production + staging |
|---|---|---|
| Cloudflare акаунт | `Info@midt-crew.eu` — id `b2abee0097d289c0762fd5b85a61353d` | оригиналният акаунт (committ-нат default) |
| Хостинг | само `*.workers.dev` (без custom домейн, без Access) | `sigma.midt.bg` зад Access (виж [`deploy.md`](deploy.md) §6) |
| Данни | собствена `sigma-dev` D1 (preview я споделя read-only) | собствени prod/staging бази |
| AI асистент | **включен** (собствени gateway + Vectorize + R2) | по [`deploy-assistant.md`](deploy-assistant.md) |

> **Принцип (непроменен от [`deploy.md`](deploy.md)).** Committ-натите `wrangler.*` държат default-ите на
> оригиналния акаунт; реалните имена/id-та и **акаунт-id-то на AI Gateway** идват от GitHub Environment
> променливи в момента на деплой. Едно и също дърво се деплойва към двата акаунта без редакция на файлове.

## Какво прави разделянето възможно — `SIGMA_AI_GATEWAY_ACCOUNT`

Единствената нова връзка е акаунт-id-то, вградено в `AI_GATEWAY_BASE_URL` / `BGGPT_STT_BASE_URL`
(AI Gateway е account-scoped). [`scripts/wrangler-render.mjs`](../scripts/wrangler-render.mjs) вече
подменя 32-hex акаунт сегмента в двата URL-а от `SIGMA_AI_GATEWAY_ACCOUNT` в момента на деплой:

- **Зададена** (dev + preview) → URL-ите сочат към gateway-а на `b2abee…`.
- **Незадена** (production + staging) → URL-ите остават **байт-идентични** с committ-натите.

Wire-нато е в [`deploy.yml`](../.github/workflows/deploy.yml) и [`preview.yml`](../.github/workflows/preview.yml).
Другите ресурси се именуват per-env както досега (`SIGMA_D1_NAME`, `SIGMA_REPORTS_NAME`,
`SIGMA_VECTORIZE_NAME`, …); на новия акаунт те носят суфикс `-dev`.

## 1. Provisioning на новия акаунт (еднократно)

Предпоставки: акаунтът е на **Workers Paid** план, а **R2 е активиран** през dashboard-а (иначе
`wrangler`/API дават `error 10042`). `wrangler` автентикиран към `b2abee…` (scoped token с Workers
Scripts / D1 / R2 / KV / Vectorize / AI Gateway — всички **Edit** — + Account **Read**).

```bash
export CLOUDFLARE_ACCOUNT_ID=b2abee0097d289c0762fd5b85a61353d
export CLOUDFLARE_API_TOKEN=<scoped-token>

# D1 (сервираните данни) — запишете отпечатания database_id → секрет SIGMA_D1_ID
SIGMA_D1_NAME=sigma-dev node scripts/bootstrap.mjs --apply       # или: wrangler d1 create sigma-dev

# R2: CSV кеш + отчетите на асистента
wrangler r2 bucket create sigma-csv-cache-dev
wrangler r2 bucket create sigma-reports-dev

# Vectorize (RAG индекс) — 1024 dims = @cf/baai/bge-m3
wrangler vectorize create sigma-assistant-dev --dimensions=1024 --metric=cosine

# KV (dedup) — CI го пресъздава идемпотентно; ръчно:
node scripts/ensure-kv-namespace.mjs sigma-dedup-dev            # отпечатва id

# AI Gateway `sigma-assistant` + voice провайдър `bggpt-voice` (custom-bggpt-voice) → https://api.bggpt.ai.
# Скриптът създава САМО voice провайдъра; chat провайдърът `bggpt` се създава отделно (по-долу).
node scripts/ensure-voice-provider.mjs --apply
```

> **⚠ Два различни upstream-а — сверено с оригиналния акаунт (source of truth):**
> `bggpt` (chat, `custom-bggpt`) → **`https://api.mamay.ai`** · `bggpt-voice` (STT, `custom-bggpt-voice`) →
> **`https://api.bggpt.ai`**. Не са еднакви! (`custom-bggpt/v1` → `api.mamay.ai/v1/chat/completions` —
> сверено; committ-ната бележка в `wrangler.jsonc` го потвърждава.) С грешен chat upstream (`api.bggpt.ai`)
> чат заявките връщат **404**, докато embeddings-ите минават (те са Workers AI, не BgGPT).
>
> **Бележки:**
> - `deploy-assistant.md` §2 и `ensure-voice-provider.mjs` са коригирани в тази промяна: чат upstream-ът
>   вече е `api.mamay.ai`, а скриптът праща пълната gateway схема и създава провайдъра **key-less** (без
>   `headers`) — коректно и на съвсем чист акаунт.
> - `ensure-voice-provider.mjs` създава САМО voice провайдъра (`bggpt-voice` → `api.bggpt.ai`); chat
>   провайдърът `bggpt` (→ `api.mamay.ai`) и самият gateway се провизират през REST по-долу (или dashboard).
>
> **Turnstile домейни.** Widget-ът трябва да изброява **точния** хост (`sigma-dev.midt-platforms.workers.dev`
> и всеки `sigma-pr-<n>.…`), не само apex-а — иначе challenge платформата връща 400 и чатът дава 403.

Chat провайдър + gateway през REST (скриптът провизира само voice провайдъра):

```bash
A=$CLOUDFLARE_ACCOUNT_ID; T=$CLOUDFLARE_API_TOKEN; API=https://api.cloudflare.com/client/v4
# gateway (пълна текуща схема)
curl -s -X POST "$API/accounts/$A/ai-gateway/gateways" -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"id":"sigma-assistant","cache_invalidate_on_update":false,"cache_ttl":0,"collect_logs":true,"rate_limiting_interval":0,"rate_limiting_limit":0,"rate_limiting_technique":"fixed"}'
# провайдъри (headers ПРОПУСНАТ = per-request auth) — РАЗЛИЧНИ upstream-и:
mkprov() { curl -s -X POST "$API/accounts/$A/ai-gateway/custom-providers" -H "Authorization: Bearer $T" \
  -H 'content-type: application/json' -d "{\"name\":\"$1\",\"slug\":\"$1\",\"base_url\":\"$2\"}"; }
mkprov bggpt       https://api.mamay.ai   # chat
mkprov bggpt-voice https://api.bggpt.ai   # STT
```

## 2. Зареждане на `sigma-dev` D1 (веднъж)

`sigma-dev` не е в committ-натата migrate конфигурация, а `ship-domain.mjs` пуска
`wrangler d1 migrations apply sigma-dev` (резолвва имена от `apps/web/wrangler.jsonc`). Затова за
времето на зареждането добавете **временен, некомитнат** `d1_databases` запис за `sigma-dev` (реалния
`database_id`) в `apps/web/wrangler.jsonc`, изпратете, после го върнете:

```bash
# от локално преизградена база (виж deploy.md) или наличния work SQLite:
SIGMA_D1_NAME=sigma-dev node scripts/ship-domain.mjs --work-db=data/work/backfill.sqlite --remote --yes
```

Прилага 4-те миграции, изпраща domain таблиците (chunked), пуска `precompute.sql` (rollup-и + FTS) и
integrity gate-а. Верифицирайте: `home_totals` има `id=1` с реални стойности; после **върнете
временния запис** (никога не го committ-вайте). Деплойнатият `sigma-etl-dev` cron поддържа свежестта.

## 3. GitHub Environments (`dev` + `preview`)

Задават се на repo-то, което носи тези среди. `production`/`staging` **не се пипат** (остават на
оригиналния акаунт).

**Секрети (и на двете среди):**

| Secret | Стойност |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token на `b2abee…` |
| `CLOUDFLARE_ACCOUNT_ID` | `b2abee0097d289c0762fd5b85a61353d` |
| `SIGMA_D1_ID` | `database_id` на `sigma-dev` (preview използва **същия** — споделя dev D1) |
| `ASSISTANT_API_KEY` | ключ за BgGPT (+ опц. `VOICE_ASSISTANT_API_KEY`) |

`ASSISTANT_HMAC_KEY` / `LOG_IP_KEY` се генерират автоматично при деплой (`ensure-worker-secret.mjs`).

**Променливи — `dev`:**

| Var | Стойност |
|---|---|
| `SIGMA_WEB_NAME` | `sigma-dev` |
| `SIGMA_ETL_NAME` | `sigma-etl-dev` |
| `SIGMA_WORKFLOW_NAME` | `sigma-refresh-dev` |
| `SIGMA_D1_NAME` | `sigma-dev` |
| `SIGMA_CSV_CACHE_NAME` | `sigma-csv-cache-dev` |
| `SIGMA_REPORTS_NAME` | `sigma-reports-dev` |
| `SIGMA_VECTORIZE_NAME` | `sigma-assistant-dev` |
| `SIGMA_ASSISTANT_ENABLED` | `true` |
| `SIGMA_ENVIRONMENT` | `development` |
| `SIGMA_AI_GATEWAY_ACCOUNT` | `b2abee0097d289c0762fd5b85a61353d` |

**Променливи — `preview`:** `SIGMA_D1_NAME=sigma-dev`, `SIGMA_CSV_CACHE_NAME=sigma-csv-cache-dev`,
`SIGMA_REPORTS_NAME=sigma-reports-dev`, `SIGMA_VECTORIZE_NAME=sigma-assistant-dev`,
`SIGMA_AI_GATEWAY_ACCOUNT=b2abee0097d289c0762fd5b85a61353d`. (`SIGMA_WEB_NAME` = `sigma-pr-<n>` и
`SIGMA_ENVIRONMENT=preview` се изчисляват в `preview.yml`.)

> `SIGMA_REPORTS_NAME` + `SIGMA_VECTORIZE_NAME` са **задължителни** тук: guard-ът на `deploy.yml`
> отказва non-prod деплой без тях, а на новия акаунт committ-натите default-и (`sigma-reports` /
> `sigma-assistant`) **не съществуват** — затова и `preview.yml` вече ги подава (иначе REPORTS/VECTORIZE
> binding-ите биха сочили към несъществуващи ресурси).

## 4. Деплой + верификация

```bash
gh workflow run deploy.yml --ref <branch> -f environment=dev     # dev
```

Previews се деплойват автоматично при отваряне на PR. После:

- Отворете `sigma-dev.<нов-subdomain>.workers.dev` — реални суми (~194 хил. договора · ~€51,7 млрд.).
- Seed на Vectorize: `POST /assistant/reindex` с `ASSISTANT_SEED_TOKEN` (без него RAG-ът е празен).
- Проверете, че `/assistant/chat` и `/assistant/transcribe` отговарят (gateway на новия акаунт).
- Reaper/teardown (`preview-reap.yml`, `teardown-remote.mjs`) вече сочат новия акаунт (четат account-id-то
  на `preview` средата).

## 5. Извеждане на старите dev/preview ресурси

След като новите dev/preview са потвърдено здрави, изтрийте **на оригиналния акаунт** старите
`sigma-dev` / `sigma-etl-dev` / `sigma-refresh-dev` / `sigma-dev` D1 / `sigma-csv-cache-dev` /
`sigma-reports-dev` / `sigma-assistant-dev` Vectorize / `sigma-dedup-dev` KV и всякакви остатъчни
`sigma-pr-*`. **Само с изрично потвърждение** и след като верифицирате, че името се резолвва към стария
ресурс (никога production). Production/staging остават непокътнати.

## 6. Портируемост между repo-та — `PREVIEW_WORKER_PREFIX`

Preview worker-ите се именуват `<префикс>-<PR номер>` (по подразбиране `sigma-pr-<n>`). За да върви
същият pipeline в друго repo под различно име на приложението, задайте repo/environment променливата
**`PREVIEW_WORKER_PREFIX`** (напр. `midt-pr`). Един източник на истина: `preview.yml` (deploy + teardown)
и reaper-ът четат **същия** префикс, а deletion allowlist-ът в
[`scripts/teardown-remote.mjs`](../scripts/teardown-remote.mjs) (`^<префикс>-\d+$`, с escape на regex
метасимволи) гарантира, че teardown/reaper трият само тези preview-и и никога дълготраен worker. Unset →
`sigma-pr` (байт-идентично поведение).

> **workers.dev subdomain.** URL-ите излизат на account-широкия `*.workers.dev` subdomain (напр.
> `midt-platforms.workers.dev`). Той е **account-level и еднократно регистрируем** — не се сменя през
> API (`error 10036`), а през dashboard-а; за различен subdomain per-repo трябва custom домейн/зона.
> Workflow-ите го парсват динамично от изхода на `wrangler`, така че кодът е subdomain-агностичен.
