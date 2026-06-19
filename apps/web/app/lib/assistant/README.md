# AI асистент — имплементация (foundation)

Наша имплементация на [`docs/spec/ai-assistant.md`](../../../../../docs/spec/ai-assistant.md),
включително хардунирането от **§9** (ревизия 2026-06-19, PR #79). Този модул е **основата**: чистите,
тествани, security-критични части плюс RAG слоя. Тежките части, които изискват cloud ресурси и
`BGGPT_API_KEY` (agent loop, dock UI, streaming, глас, `/reports/:id`), са разписани като пътна
карта по-долу и **още не са имплементирани** — нарочно, докато няма ревю + provisioning.

## Какво има тук (имплементирано и проверено)

| Файл | Роля | Спец. |
|------|------|-------|
| `report-schema.ts` | Block речник + **сървърно обвързване на стойностите** | §4, §9.1 |
| `sql-guard.ts` | Read-only структурен guard + LIMIT + byte cap | §7, §9.4 |
| `describe-schema.ts` | Куриран речник на данните с капаните | §3, §9.2 |
| `rag.ts` | Vectorize + Workers AI RAG (схема-grounding + semantic search) | *добавка* |
| `*.test.ts` | Unit тестове за обвързването и guard-а | §9.9 |

**Проверено:** `pnpm --filter web typecheck` → 0; `pnpm --filter web test` → 75 преминават
(вкл. новите); Prettier чист. Модулите са чисти (без нови deps/bindings), затова са deploy-независими.

## Ключово дизайн-решение: стойностите се владеят от сървъра (§9.1)

Сърцето на интегритета. Моделът **не пише числа** — `emit_report` блоковете *референцират* хендъли към
резултатни множества, които сървърът реално е изпълнил (`run_sql`/курирани инструменти), а
`bindReport()` пре-свързва реалните стойности. Таблиците взимат редовете изцяло от резултата, така че
моделът не може да инжектира измислен ред или да напише „12 млрд." вместо „1,2 млрд." — точно
векторът за клевета от [architecture.md](../../../../../docs/architecture.md) §3. Само `text`/`callout`
носят авторска проза и са markdown-санитизирани (без raw HTML → затваря stored-XSS на публичния
`/reports/:id`).

## RAG — добавка спрямо спецификацията (важно)

Спецификацията (§1–§9) е **text→SQL агент с инструменти, БЕЗ векторно извличане.** RAG е добавен тук
нарочно, на двете места, където носи най-много при слаб 27B модел:

1. **Grounding на схемата (основно).** `rag.ts` влага (`@cf/baai/bge-m3`, многоезичен) trap-правилата +
   каноничните заявки от `describe-schema.ts` във Vectorize и извлича най-релевантните парчета за
   конкретния въпрос → в системния prompt. Това е retrieval-augmented формата на **§9.2** (най-силният
   лост върху коректността на SQL) вместо да налива целия речник.
2. **Семантично търсене (`semantic_search` инструмент).** Векторно търсене над заглавия на
   същности/договори — хваща парафрази/синоними, където FTS `search_entities` пропуска. **Допълва**, не
   заменя FTS.

> Бележка: ако решим, че RAG е извън обхвата на v1, схема-grounding-ът може да падне обратно до
> статичния `describeSchema()` (вече имплементиран) без друга промяна. Чакам решение по обхвата.

## Пътна карта (още не имплементирано — нужни deps/bindings/ключ)

**Нови зависимости:** `ai` + `@ai-sdk/openai` (Vercel AI SDK), `zod` (schema на `emit_report`),
`node-sql-parser` (AST guard — §9.4 основен guard над структурния слой тук).

**Нови wrangler bindings/vars (apps/web):** R2 `REPORTS`; Vectorize `VECTORIZE` (1024-dim, cosine);
Workers AI `AI`; `AI_GATEWAY_BASE_URL` (§9.5 — маршрутизиране през AI Gateway, не директно към
`api.bggpt.ai`); `BGGPT_API_KEY` (**secret**); config `[vars]` `BGGPT_RATE_LIMIT_RPM`, `MAX_STEPS`.

- **Фаза 1** — agent loop (Vercel AI SDK → AI Gateway → BgGPT), `/assistant/chat` (SSE streaming),
  инструментите (`run_sql` + node-sql-parser AST + read-only път, `describe_schema`, курирани,
  `semantic_search`), глобален dock UI.
- **Фаза 2** — `emit_report` (Zod) → `bindReport` (готово) → renderer върху компонентите на сайта +
  нов `timeseries`; R2 персистенция, `/reports/:id`, chat карти, индекс `/reports`. Воден знак
  „AI-генерирано, неофициално" + показан въпрос (§9.12). Достъпни таблици-алтернативи за SVG (§9.6).
- **Фаза 3** — глас (`/assistant/transcribe` → Whisper), `eop_fetch` (+ hardening §9.7), `source_link`.
- **Launch gate** — Turnstile + Rate Limiting binding + circuit-breaker; HMAC-подпис на сървърните
  съобщения (§9.3); memoize `(sql_hash, freshness)` + дедуп на справки (§9.8); golden-report CI (§9.9).

## Защо foundation, а не цялото v1

Пълното v1 иска нови deps, четири cloud bindings и `BGGPT_API_KEY` — нищо от това не може да се
provision-не/верифицира в тази среда. Затова имплементирах първо това, което е (а) най-висок приоритет
по §9 (интегритет на публикувания артефакт), (б) чисто и **тествано**, и (в) deploy-независимо — за да
има реален, проверим код за ревю, преди да пораснем към agent loop-а и UI-я.
