# Спецификация: „Свързани лица" — data foundation (declared interests + ownership)

- **Status:** draft v2 — revised after 3 independent critical passes (data-eng, architecture, legal/external research)
- **Created:** 2026-07-03
- **Owner:** lb
- **Delivers (confirmed):** a **conflict-of-interest** foundation — officials' *declared* company stakes vs public contracts.
- **Contingently unblocks:** #128 checkbox 1 (споделени собственици) and #60, **only if** the unproven TR source (§3.3) clears Phase-0.
- **Continues:** #34 (closed) — but the *external-observer subset* of it, not the full vision (see §1).
- **Depends on:** the ETL pipeline + integrity gate; and **hard-blocks on #173** for any public natural-person output (§8).
- **Publish bar:** **certainty (1.0)** — nothing is auto-published; **human ЕИК-verification is the sole publish gate** (§5). Order: **Phase 0 (feasibility) first.**

## 1. Why this exists — and what it honestly is

Sigma models **one leg** of public money: spending (`authorities → contracts → bidders`, keyed by ЕИК). It is blind to who is behind a bidder and whether they connect to the officials who direct the spend.

**What this foundation confirmedly delivers:** the **conflict-of-interest** join — an official who *declares* a company stake, where that company won public contracts (§5 metric). The data for this (CACBG declarations) is confirmed and lawful to use (§3.1, §8).

**What it does NOT deliver on its own:** #60 and #128's shared-owner checkbox are about **bidder ↔ bidder** hidden ownership ("скрито свързани изпълнители" / "споделени собственици между изпълнители"). CACBG only exposes **official ↔ company** links — it says nothing about two *bidders* sharing an owner unless an official owns both. Bidder↔bidder ownership requires TR ownership of **both** bidders (§3.3), which is **unconfirmed** and which the codebase itself defers (`source-link.ts:6`). So this spec does not "unblock #60/#128" — it delivers conflict-of-interest today and *may* unblock one #128 checkbox if §3.3 succeeds.

**Honesty vs #34.** #34 argued only the **state** can fully do this — mandate owner disclosure, publish all offers, link by ЕИК; "външен наблюдател не може." We are an external observer on partial public data. This foundation delivers the **external-observer subset**: declared conflicts + bounded public ownership. It is a **lead generator over declared/derivable facts**, a floor — not a claim to have found all hidden ownership. The genuinely corrupt do not self-declare; nominee ownership stays invisible. State this on the methodology page.

## 2. Scope

### Confirmed, buildable now (the MVP)
- **CACBG conflict-of-interest foundation** — ingest declarations → officials' declared company stakes → resolve to bidder ЕИК → surface stakes in contract-winning companies. Self-contained; no external dependency beyond CACBG.

### Contingent (ships only if Phase-0 discovery + Phase-2 match rate pass)
- **Bidder↔bidder shared ownership** (#60, #128 #1) — needs TR ownership of both bidders (§3.3, unconfirmed).
- **Donor→bidder links** (party financing) — needs ЕРИК parse + name matching (§3.2).

### Standalone (ships regardless of the matcher outcome)
- **#60's consortium-only graph** — who co-formed обединения, a *fact* from existing data, labelled „съучастие, не собственост". Needs **no** name-matching, so it is decoupled from the §5 matcher and must not die with it.

### Independent of this foundation (buildable from existing data; noted, not owned here)
- Geographic market-splitting; weak **winner-only** rotation — computable from `contracts`+`bidders`+regions without this spec.

### Out of scope (blocked, documented — not forgotten)
- **Co-bidding, cover bidding, true winner-rotation** — need per-bidder offer lines. No public source (`0000_init.sql:106` — "intentionally NO `bids` table"). OCR of комисия protocols is a separate later spike.
- **Регистър на действителните собственици** (ЗМИП/AML BO) — parked. Post-CJEU (C-37/20, 2022) and a **June 2025** Bulgarian move to a "legitimate-interest" access model put the regime in flux; do **not** un-park without a fresh legal check.

### Honest #128 accounting
Of #128's five checkboxes: **1** (shared owners) contingently unblocked via §3.3; **2 & 5** (co-/cover-bidding) permanently blocked on non-public offer data; **3 & 4** (rotation, geo) independent of this spec.

## 3. Data sources

### 3.1 CACBG declarations — CONFIRMED (inspected + legally verified 2026-07-03)

**Legal identity:** register operated by the **Сметна палата, дирекция „Публичен регистър"**; declarations filed/published **под чл. 75 ЗСП** (chain: ЗПКОНПИ repealed → ЗПК in force 6 Oct 2023 → ЗИД ЗСП transferred ЛЗВПД declaration publication to the Court of Audit). Publication is a **statutory obligation** → declared facts are public-by-law and republishable. No open-data licence and no explicit reuse restriction. Methodology page cites **ЗСП чл. 75**, not ЗПКОНПИ.

**Structure** (`register.cacbg.bg/<year>/`, JS-driven over static data):
- `index.html` shell + `../core2.js` (loads `<year>/list.xml`; `/core.php` serves search).
- **`list.xml`** (2025 ≈ 4.8 MB): `root → MainCategory → Category[Name] → Institution[Name] → Person[Name] → Position[Name] → Declaration{Sent, xmlFile}`. **15,925 persons / 34,862 declarations for 2025.** High-signal categories incl. **„Лицата, упълномощени по реда на ЗОП … да сключват договорите"** — procurement signatories.
- Each `xmlFile` is an **individual declaration XML** (≈ 45 KB, `Table/Row/Cell`, ~21 tables). Metadata: `Name`, `Position`, `Address`, `Spouse`, `Children`, `Year`, `DeclarationType`, `ControlHash`. **`EGN` present as a tag but stripped (empty).** **No birthdate.**
- **Company holdings** as rows (confirmed real row): `дружествени дялове | 100% | "ДЕМИР АГРО" ЕООД | Шумен | 100 | <holder> | възмездно` — `type, stake%, company name+form, town, value, holder, mode`. **No ЕИК on companies.**
- **Folder-year vs declared-year offset:** register folder `N` holds declarations whose `Year` field is `N−1` (`/2025/` → `Year=2024`). Temporal joins use `Year`, not the folder.

**Ingestion window:** match the contract data (2020–2026) → register folders `2020`…`2026` (declared years ≈ 2019–2025), whichever exist.

**Do NOT store-for-publish:** `Address` (КЗЛД strips addresses on publication); `EGN` even if ever present; family names except behind masking (§8).

**Ingest = acknowledged NEW infra** (see §7): a **resumable crawler** over ~240k XML files (≈35k/yr × up to 7 yrs) at a polite rate, into a **persistent raw-XML cache keyed on `xml_file` + `ControlHash`** (natural key for idempotency and change detection), decoupled from `normalize`. Host-scoped explicit TLS handling (broken cert chain), never a global bypass.

### 3.2 Party financing — source RESOLVED (ЕРИК); parse shape = Phase-0

**Source:** **ЕРИК — Единен регистър по Изборния кодекс** (`erik.bulnao.government.bg`, Court of Audit), free/public; plus per-party public donor registers (чл. 29, ал. 2 ЗПП). Publishes donor names, donation type/amount/value, origin declarations.
**Caveats to resolve in Phase-0:** (a) **donor ЕИК likely NOT a published field** → donor→bidder resolution falls back to the §5 name+town matcher; (b) likely **HTML-only, no bulk export**; (c) **election-scoped retention** ("до следващите избори") → older cycles in the 2020–2026 window may need archived/Wayback snapshots.

### 3.3 Targeted TR owners — access CONFIRMED public; endpoint/limits = Phase-0

**Per-ЕИК public lookup** (`portal.registryagency.bg`) is free, no fee. Recoverable per ЕИК: **управители, съдружници/собственици на капитала + stakes, капитал, legal form, seat.** **ЕГН masked** → owner identity name-based. Run **only** for the bounded set (bidders + resolved declared/donor companies) — thousands, not ~900k.
**Hard constraints (DPA-verified):** **NEVER bulk-scrape TR** (КЗЛД ruled bulk provision unlawful; CJEU C-200/23 climate). **Never store scraped ЕГН**, even if leaked in a document image. Phase-0 confirms endpoint, fields, and rate limits.

## 4. Data model

New domain tables, built by `normalize-raw.sql` from persistent staging; `interest_links` written by a **JS resolver pass** (§5), NOT by fuzzy SQL.

| Table | Grain | Source | Notes |
|---|---|---|---|
| `persons` | one person **per declaration** | all | id anchored on `(register_year, institution, position, name_normalized)` — **never a bare name key**. **No `birth_year`** (not in data). Cross-institution/cross-year linking is a *review-gated* corroboration step, never automatic. |
| `declarations` | one CACBG declaration | CACBG | `person_id`, `year`, `position`, `institution`, `category`, `xml_file`, `control_hash`, `source_url`, `sent`. Address NOT stored-for-publish. |
| `declared_interests` | one holding row | CACBG | `kind`, `stake_pct`, `company_name_raw`, `company_town`, `value`, `holder_relation` (self/spouse/child), `acquisition_mode`, `acquired_hint` |
| `party_donations` | one donation | ЕРИК | `donor_name`, `donor_kind`, `donor_eik` (**nullable, usually NULL**), `party_name`, `amount`, `date`, `source_url` |
| `company_owners` | one owner/manager record | TR targeted | `company_eik`, `person_name`, `role`, `stake_pct?`, `source_url`, `fetched_at`. No ЕГН stored. |
| `interest_links` | one candidate/verified edge | JS resolver + human review | `subject_person_id`, `company_eik`, `bidder_id`, `contract_id?`, `authority_id?`, `link_kind`, `match_method`, `confidence`, `provenance`, `matcher_version`, `first_asserted_at`, `superseded_at`, **`status`** (candidate/verified/rejected), **`verified_by`, `verified_at`**. Only `status='verified'` is public (certainty bar, §5). |
| `link_suppressions` | one correction/takedown | appeals | survives re-import (§8); a suppressed `(subject, company, source_row)` is never re-asserted. |

**Person identity** has no ЕГН and no birthdate → it is the **weakest** join, not a safe one. The `list.xml` hierarchy binds Person→Position→Institution within a register-year; use that. Homonyms (Георги Иванов) are pervasive → a bare name key would silently merge two distinct officials (false-accusation vector). Therefore per-declaration nodes + cautious, corroborated, review-gated cross-linking only.

## 5. Matching layer (the crux) — a JS resolver pass

**Placement:** D1/SQLite has only FTS5 `MATCH` + BM25 `rank` — **no** Levenshtein/trigram/similarity, and **BM25 rank ≠ a confidence score**. So resolution is a **JS pass**: query `search_index` for candidates → score/tier in code → write resolved rows to staging → `precompute` only rolls up. (Correct §4/§7 accordingly.)

**Method:** normalize the declared `company_name_raw` (canonicalize quotes, extract legal-form token) → FTS candidate set → score by calibrated name similarity, `company_town == bidder.settlement` **when settlement exists**, and legal-form agreement **as a tie-breaker only** (form flips ЕООД↔ООД on ownership change; never reject on form mismatch alone).

**Prerequisite — settlement backfill (Phase-0 blocker).** `bidders.settlement` is populated **only** from OCDS parties (`normalize-raw.sql`), which cover **2026+** entities → it is largely **NULL for the 2020–2025 corpus**. The town gate therefore has no data for most bidders, and "TR fills settlement" is **circular** (TR is keyed by the ЕИК the match is trying to find). Phase-0 must (a) **measure** actual settlement coverage on the bidder set, and (b) backfill it **independently** of the match (bulk ЕКАТТЕ/NUTS, or per-ЕИК TR on the bidder's *own* ЕИК where `eik_valid=1`) — or Tier A must be redefined to not need town and proven empirically.

**Certainty bar = 1.0 → nothing auto-publishes.** A libel/slander-safe tool cannot publish a probabilistic guess that a *named* official is connected to a company. Name-only matching **cannot be certain by construction** (BG trade names aren't unique; no ЕГН; CACBG carries no ЕИК). Therefore the matcher never asserts a public link. It is a **triage/lead tool**: it produces *candidate* links; **publication requires human ЕИК-verification** (§ below). `confidence` is a reviewer-ranking aid only — never a publish gate.

**Candidate tiers (drive the review queue, not publication):**
- **Auto-proposed** — `bidder.eik_valid = 1` + strong name match (+ town agreement where settlement exists) → top of the review queue. Name-keyed/consortium bidders (NULL ЕИК) can never be auto-proposed as certain — they carry no ЕИК to verify against.
- **Weak candidate** — partial/ambiguous → lower in the queue.
- **Held** — below a floor → not surfaced even to reviewers.

**Publish gate — human ЕИК-verification (the only path to an asserted link):** a reviewer confirms *"declared `company name + town` = this exact ЕИК"* against TR (unique name+seat) **and** the source declaration, then signs off. Only human-verified links get `verified_by` + `verified_at` and become public. The declared-company→ЕИК resolution is the sole uncertain step; once a human fixes the ЕИК, everything downstream (owners, contracts, institution overlap) is deterministic. Volume is bounded — only companies that appear in *both* a declaration/donation *and* the winner set need review (expected small). If a deterministic-certain class exists (e.g. a declared row that itself contains an ЕИК, or a provably unique TR name+seat), it may auto-verify — but is treated as review-gated until Phase 0 proves such a class exists at all.

**Provenance (every candidate + link):** `source_url`, raw declared strings, matched `bidder_id`, `match_method`, `confidence`, `matcher_version`, and (once verified) `verified_by`/`verified_at`. UI shows the full receipt chain inline.

**Known recall holes (enumerate on methodology page):** `search_index` is built from `company_totals`, so bidders whose only contracts are FX-rateless (`amount_eur` NULL) are **absent from FTS** and unmatchable; renamed companies; town-changed companies; ownership via HoldCo. Acceptable under false-negatives-over-false-accusations, but stated up front.

**Headline metric:** count of **human-verified** ЛЗВПД holding a *declared* stake in a company that won public contracts, and the subset winning **from the official's own institution** with temporal overlap (§ below). A verified floor, framed as declared leads — never "all conflicts," never an algorithmic estimate.

**Temporal logic:** a declaration is a **point-in-time snapshot**, not an interval. A stake acquired late-year vs a contract won early-year is a **false overlap**; a stake sold mid-year still shows in the prior declaration; entrants/leavers file nothing for years out of office. Use `Year` with an **uncertainty band** + `acquisition_mode/acquired_hint` to bound the holding start. **Verify the ЗОП-signatory category's filing cadence** (annual vs event-triggered) before relying on annual re-filing.

## 6. Phases and proof-gates (numeric, falsifiable)

### Phase 0 — Feasibility spike (kill-criteria; do this before committing to the build)
- **Settlement coverage:** measure `bidders.settlement` fill-rate on the 2020–2025 bidder set; prototype a backfill; decide if the town gate is viable or Tier A must drop town.
- **Ground truth:** hand-label a **stratified pair set** — true matches + **hard negatives** (same-name/diff-town, same-core/diff-form, homonym companies, name-keyed bidders). Used to measure matcher *recall* and candidate-set tightness, not to license auto-publish.
- **Review volume:** estimate how many declared/donor companies intersect the winner set (the actual human-verification workload). If it's thousands, the queue is tractable; if tens of thousands, the review model needs rethinking. This is a primary Phase-0 output.
- **Certain-class probe:** determine whether ANY deterministic-certain match class exists (declared row with an ЕИК; provably unique TR name+seat). If none, confirm that **100% of public links must be human-verified** — and design accordingly.
- **TR:** confirm per-ЕИК endpoint, fields, rate limits, ToS.
- **ЕРИК:** confirm parse shape, donor-ЕИК presence, retention/Wayback for 2020–2026.
- **Cadence:** verify ЗОП-category filing cadence for the temporal model.
- **Gate:** is the human-verified pipeline *viable at this volume* — reviewable candidate set, tractable workload, matcher recall high enough that true links aren't missed? If the intersection is unreviewably large or recall is too low to trust the queue, that is the **no-go** — surface it, don't paper over it.

### Phase 1 — CACBG ingestion (the confirmed MVP; independent of Phase 0's TR/ЕРИК)
Resumable crawler + raw-XML cache (`control_hash` key) → parser → `persons/declarations/declared_interests`.
- **Gate:** ≥ (stated N, e.g. all 2020–2026 folders, ≥95% of `Sent=True` declarations parsed) ingested; **idempotent** re-import (re-run yields zero drift; natural key = `xml_file`+`control_hash`); staging survives the full `normalize` rebuild; adversarial parser tests (malformed XML, empty holdings, missing town, TLS quirk).

### Phase 2 — Matching + review pipeline (the go/no-go)
JS resolver → candidate `interest_links` → **human-verification queue** → verified links.
- **Publish rule = certainty (1.0):** nothing is published as a link without human ЕИК-verification (§5). The matcher's job is recall + tight candidates, never auto-assertion.
- **Gate:** matcher **recall** on the Phase-0 labelled set high enough that reviewers aren't missing true links (target with lb, e.g. ≥0.95 recall into the candidate set); candidate-set precision good enough that reviewer load is tractable (report it, not as a publish gate); a working review UI/workflow that records `verified_by`/`verified_at`; and a **verified** headline count with worked, fully-sourced examples. If humans can't verify the volume, or recall is too low to trust the queue, stop before public UI.

### Phase 3 — Integration (hard-gated on privacy)
- **HARD BLOCKER:** **#173 must land first** — natural-person masking proven on `.json`/`.csv` **and the `.data` twin** (#184's rate-limit fix is merged, but that closed the *limiter* bypass, not the *mask*; the `.data` surface must be re-verified against the masking policy, per the .data under-protection pattern). **Family-relation rows (`holder_relation ≠ self`) stay INTERNAL-only for v1** — the §5 metric is the official's own holdings; do not publish third-party data over surfaces known to leak.
- Fill `ConsortiumParticipant.eik`/`resolvedSlug` (#60); extend `NetworkNode.kind` to `'person'`; add a „Декларирани връзки" panel; feed #128's shared-owner heuristic **iff** §3.3 delivered.
- Build against **`main` after** the in-flight graph work (#140/#144) merges — do **not** cherry-pick unmerged stacked branches (merge-order hazard).
- **#60 consortium-only graph may ship earlier**, independent of all of the above.
- **Gate:** consumed correctly on the fork's ephemeral deploy; masking holds on every output format.

## 7. Architecture fit — honest about what's new

Domain tables + rollups ride the existing pipeline (`normalize-raw.sql` → `precompute.sql` → `ship-domain` → **`assertIntegrity`**). **New infrastructure this genuinely adds** (the "no new infra" claim was wrong): a **resumable, rate-limited, cached crawler** over three external gov registers (one broken-TLS, one rate-limited, one HTML-only); a **JS resolver pass**; a **suppression/correction store** surviving re-import; and **source-schema-drift monitoring** (the integrity gate covers re-import drift, not upstream schema/availability drift across 2020–2026 × annual).

**Workspace:** isolated fork worktree off synced `main`; verify on the fork's ephemeral env; product lands upstream via PR per proven phase.

## 8. Guardrails (non-negotiable — DPA-verified)

**Legal / personal-data (КЗЛД- and CJEU-grounded):**
- **Officials' declared facts** — lawful to republish with a source link (ЗСП publication obligation + GDPR 6(1)(c)/(f) + Art. 85 expression margin). Green-light.
- **Third-party (spouse/child) data** — КЗЛД: publishable only to the extent the law explicitly provides; the declarant's consent does **not** extend to third persons; otherwise **anonymize**. → family-relation rows **internal-only for v1**; if ever surfaced, masked on **every** format, hard-gated on #173 (incl. the `.data` twin).
- **Strip on publication:** address, ЕГН, ID-doc/bank numbers (КЗЛД list) — never store-for-publish.
- **Storage-limitation:** no statutory online-retention window → indefinite republication conflicts with the DPA principle. Add a **retention/refresh statement** to the methodology page.
- **DPIA / lawful-basis note** before any natural-person *aggregation* into a searchable index — apply the BO-register (CJEU C-37/20) "public-by-law ≠ unlimited re-publication" reasoning **symmetrically** to CACBG family/asset data, not only to the parked BO register.
- **TR:** bounded per-ЕИК only, never bulk (DPA-hostile), never store ЕГН.

**Accuracy (project rule — accuracy blocks merge):**
- **Certainty bar (1.0): nothing is auto-asserted — human ЕИК-verification is the sole publish gate** (§5). The Phase-2 gate measures matcher *recall* + reviewer tractability on a labelled set with hard negatives, not an auto-publish precision threshold. Resolver **and** review workflow get adversarial self-tests.
- Present links as „модел за проверка, не обвинение" (#34); the tool shows declared/derivable links, never claims completeness.

**Corrections & lifecycle (defamation-sensitive):**
- **Appeal/correction/takedown workflow** with an intake contact and a resolution SLA — designed, not just named. Corrections land in `link_suppressions` and **survive re-import** (idempotency must not re-assert a removed link).
- **Refresh cadence + source reconciliation:** re-scrape on a stated cadence; handle **withdrawn/amended** declarations and officials leaving office — a stale `interest_link` implies a *current* conflict that has ended (= accuracy defect on live prod).

## 9. Public methodology page (clear and explicit — a hard requirement)

The public site MUST carry a plain-language methodology page. It is part of the libel defence: a reader must see exactly how a link was made and be able to re-derive it. It states, explicitly:
1. **Sources + legal basis** — CACBG declarations (ЗСП чл. 75, Сметна палата); ЕРИК (Изборен кодекс); targeted TR per-ЕИК (public company facts). Each with a direct source link.
2. **What is shown and what is not** — officials' own declared holdings; **family holdings are NOT published** (v1); addresses/ЕГН never shown.
3. **The matching rule, verbatim** — declared `company name + town` → candidate bidder ЕИК → **a human verifies the ЕИК identity against TR + the declaration before any link is published**. No algorithm publishes a link. Every link shows its evidence chain and the reviewer sign-off.
4. **Certainty & framing** — only human-verified links appear; each is a „**модел за проверка, не обвинение**"; the tool shows *declared* links only and **does not claim to find hidden ownership** (it is a floor, not the full picture).
5. **Temporal meaning** — a declaration is a point-in-time snapshot; how overlap with a contract date is (and isn't) interpreted.
6. **Known gaps** — the recall holes (§5), self-reporting limits, sources it cannot see.
7. **Corrections & appeal** — how to contest a link, the contact, the SLA, and that a corrected link stays removed across refreshes (§8).
8. **Retention & freshness** — refresh cadence; how withdrawn/amended declarations are handled.

## 10. Open questions / risks (ranked)

1. **Human-verification volume + matcher recall — THE go/no-go.** Under the 1.0 bar the risk is no longer "can the algorithm be precise" but "is the human-verified pipeline viable": is the declared∩winner intersection small enough to review, and does the matcher surface true links into the queue (recall) without drowning reviewers? Resolved in Phase 0/2.
2. **Family-data masking** — highest *legal* risk; only mitigated if #173 masking is proven on every format incl. `.data`. v1 keeps family rows internal.
3. **Settlement backfill** — the town gate is inert pre-2026 until this is solved (Phase 0).
4. **ЕРИК format/retention** — HTML-only, no donor ЕИК, election-scoped retention may drop older cycles → may shrink §3.2.
5. **Person disambiguation without ЕГН** — conservative per-declaration nodes; cross-year identity may be unneeded for the headline; homonym merge is the failure to avoid.
6. **CACBG storage-limitation** — add retention line (§8); low viability threat, real compliance gap.
7. **BO register regime in flux** (June 2025 legitimate-interest) — stays parked; risk is scope-creep by treating BO as "still public."
