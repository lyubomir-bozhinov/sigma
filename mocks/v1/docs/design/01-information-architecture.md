# Sigma — Information Architecture (v1)

> Платформа за Прозрачни Възлагания · v1 design doc · IA + entities + URL space
> Design prose: English. All user-facing copy in the prototype and product: **Bulgarian.**

## 1. Audience & editorial posture

**Primary audience: the citizen.** Someone who lands on the site after a news story or a Facebook
post and wants to answer one question: _„Къде отиват парите на моята община / на моето
министерство?"_ They are not procurement experts. They will not learn the acronyms.

**Secondary audience: the investigative journalist / NGO researcher.** They arrive with a specific
name in mind — a contractor, an authority, a public figure — and want to pull a thread. They will
tolerate density if it pays off in citable signal.

The IA is optimized for the citizen first. The journalist's needs are served by making every
citizen-facing artifact deeply linkable, filterable, and exportable — they don't need a separate
"pro mode" surface.

**Editorial posture: civic transparency.** Reference points are gov.uk, usaspending.gov,
OpenSpending, the UK National Audit Office. Neutral, utilitarian, accessible. Sans-serif system
typography, near-black on white, generous whitespace, a single deep-blue link colour, red reserved
exclusively for red-flag signals so the colour itself becomes a meaning-bearing element.

No data-art flourishes. No hero images. No dashboards-with-vibe. The signal _is_ the visual
language: a clearly-formatted table of who got how much money is a stronger civic artefact than a
glowing chart of the same data.

## 2. Editorial principles

These principles govern every screen and copy decision downstream.

1. **Always say the leva amount in words a citizen recognises.** EUR is the storage unit; we
   surface it as „4,3 млн. лв." or „1,2 млрд. лв." with the exact figure available on hover /
   secondary line. Internal: EUR. External: лева, with EUR as a parenthetical when precision
   matters (procurement law, EU thresholds).
2. **Every claim is a link to its evidence.** No aggregate number appears without the contracts
   list that produced it being one click away. „Тази институция е похарчила 47 млн. лв." → click →
   the 312 contracts that add up to that number.
3. **Red-flag signals are explained, not asserted.** A contract flagged as "potentially
   problematic" must show _which_ signals triggered the flag, _what each signal means_, and the
   methodology page link. We name patterns, we do not accuse people. The investigative posture
   ranks the patterns; the editorial responsibility is in the framing.
4. **No PII surfaces.** Owner names appear because they are public-registry data, but no addresses,
   no personal IDs, no relatives, no images.
5. **Cross-link everything.** Every entity reference (authority, company, person, CPV code,
   procedure type, EU-funded flag) is a link to that entity's profile or filtered list. The site
   is a navigable graph, not a set of dashboards.
6. **Always state data freshness.** Every screen footer carries the data snapshot date and the
   source registers. Trust is the entire product.

## 3. Entities

Six entity types. The first four are first-class (each has its own URL space and profile screen);
the last two are taxonomies surfaced as filters and badges.

### 3.1 Authority (`Институция`)

The public buyer: ministry, municipality, agency, hospital, school. Keyed by `authority_name`
(which will need a normalization pass — `ОБЩИНА БЛАГОЕВГРАД` vs `Община Благоевград` vs
`Община гр. Благоевград` will all need to collapse to one entity; design assumes this is solved
upstream).

A normalized authority carries a **type** (ministry / municipality / agency / state company /
education / health / other) so we can offer "all municipalities" as a navigable group.

### 3.2 Company (`Компания`)

The contractor / winning bidder. Keyed by **ЕИК** (`contractor_eik`) — the stable national company
ID. `contractor_name` is display-only and can vary slightly across rows; never use it as a key.

### 3.3 Person (`Лице`)

The beneficial owner / representative / shareholder behind one or more companies. Keyed by the
**hashed personal ID** as published in the data.egov.bg Trade Register dump. Joined to companies
via the Trade Register relationships table. The hash is stable across the dump; we surface name +
role + ownership share, never the underlying ID.

This is the entity that makes Sigma more than a procurement explorer. A person can connect
nominally-independent companies, accumulate beneficiary totals across them, and expose
shared-owner concentration patterns that no single-company view can show.

### 3.4 Contract (`Договор`)

A single procurement contract — at the lot granularity. Keyed by `tender_internal_id`; lot rows
roll up to their parent tender for display, but are addressable. A contract carries the full
provenance — procedure type, bids, dates, value history, EU funding, annex flags — and is the
atomic unit of every red-flag signal.

### 3.5 CPV category (`Категория CPV`)

The European Common Procurement Vocabulary code, treated as a taxonomy: 2-digit division →
3-digit group → 5-digit category → 8-digit subcategory. Surfaced as breadcrumb filters and
authority/company "what they buy / sell" breakdowns. Not a first-class profile screen in v1, but
the URL space reserves `/категории/[code]` for the future.

### 3.6 Sector (`Сектор`)

The dataset partition: `строителство` (construction) or `храни` (foods). A coarse filter only;
visible as a chip on every list view. Not a profile page.

## 4. URL space

ASCII-friendly slugs in routes, Bulgarian labels in the UI. The slugs are SEO-friendly and
shareable; they are also typeable, which matters for journalists pasting them into Slack.

| Route | Screen |
|---|---|
| `/` | Home |
| `/търсене?q=…` | Global search results |
| `/институции` | List of authorities (with type filter) |
| `/институции/[slug]` | Authority profile |
| `/компании` | List of companies (top beneficiaries by default) |
| `/компании/[eik]` | Company profile |
| `/лица` | List of people (top beneficial owners) |
| `/лица/[id]` | Person profile |
| `/договори` | Contracts browser (advanced filtered list) |
| `/договори/[id]` | Contract detail |
| `/потоци` | Money flows visualisation |
| `/червени-флагове` | Red-flag leaderboard |
| `/категории` _(v1.1)_ | CPV browser |
| `/методология` | Methodology, glossary, red-flag explanations, data sources |
| `/за-сигма` | About, contact, license, code |

Filters and ranges are URL-encoded query params (`?година=2023&сектор=строителство&мин=1000000`)
so any view a journalist constructs is shareable as a link.

## 5. Global navigation

A single horizontal top nav, citizen-readable, six items:

```
Сигма    Институции   Компании   Лица   Червени флагове   Потоци   Методология
                                                                              ↳ търсене 🔍
```

`Сигма` is the home link. Search lives in the right edge of the header on every screen — global
text input matched against authorities, companies, people, CPV subjects, and contract numbers.

No login. No persistent user state. Bookmarks and links are the storage layer.

Breadcrumbs appear under the header on every non-home screen, gov.uk-style:

```
Начало › Институции › Министерство на регионалното развитие и благоустройството
```

## 6. Cross-link contract (the navigation graph)

Every entity reference, anywhere on the site, is a link to that entity's primary surface. This is
the single most important IA rule — it converts the site from "ten reports" into "one connected
graph the citizen can walk".

| If you see… | …it links to |
|---|---|
| Authority name | Authority profile |
| Company name | Company profile (keyed by ЕИК) |
| Person name | Person profile |
| Contract number / UNP | Contract detail |
| CPV code / subject category | Filtered contracts list `/договори?cpv=…` |
| Procedure type chip | Filtered contracts list `/договори?процедура=…` |
| Sector chip | Filtered contracts list `/договори?сектор=…` |
| EU-funded badge | Filtered contracts list `/договори?eu=1` |
| Year / period label | Filtered contracts list `/договори?година=…` |

A consequence: there is **no dead-end screen**. Every aggregate decomposes to a contract list;
every contract surfaces its parties; every party surfaces its other contracts.

## 7. What is _not_ in v1

Stated up front so scope arguments happen against this list and not against ambient assumptions.

- **No login, no saved searches, no alerts.** The MVP is anonymous and stateless. RSS / email
  alerts for "new contract over X involving authority Y" are an obvious phase-2 addition.
- **No editorial / story layer.** No annotations, no curated "case studies", no journalist
  bylines. The site shows the data; humans tell the stories elsewhere and link in.
- **No map.** Geocoding authority names to municipalities is a substantial side-project. A map
  ("show me my municipality") is a strong v1.1 addition; it is not in v1.
- **No comparison mode.** No "compare two authorities side by side." A journalist can open two
  tabs; we do not need a built-in compare UI.
- **No CPV browser screen.** Reserved in URL space, not built in v1.
- **No write side.** Read-only. No comments, no submissions, no "report this contract".
- **No API.** The data is open at source (АОП register, data.egov.bg). Sigma is a reader of that
  data, not a re-publisher of an API. Bulk CSV export per filtered view is in scope.

## 8. Data dependencies (design assumption, not engineering spec)

The IA assumes three datasets are ingested and joinable:

1. **`raw_aop_contracts`** — the existing 129k-row АОП load.
2. **Authority normalization table** — canonical authority names + types (ministry, municipality,
   agency, …) keyed to the messy `authority_name` strings.
3. **Trade Register relationships** — from data.egov.bg, joining ЕИК to a stable hashed person ID
   with role (owner / manager / representative) and ownership share where available.

Every screen below works without #2 and #3 (the authority list becomes alphabetic and untyped;
the Person entity disappears). But the design is built assuming all three are present.
