# Sigma — Screens (v1)

> Per-screen purpose, primary user job, and key elements. No layout specs, no SQL, no viz specs
> — that's the next pass. The intent here is to argue scope before committing to detail.

Reading order: home → entity profiles → leaderboards → flows → reference. Twelve screens, plus
two reference pages.

---

## A. Entry points

### A.1 `/` Home (`Начало`)

**Purpose.** Convert a cold visitor — "what is this site?" — into a productive first action within
ten seconds. Optimized for the citizen, but a journalist landing here should reach a useful list
in two clicks.

**Primary user jobs.**

- _Citizen:_ „Покажи ми къде отиват парите на моята община/министерство" — pick an authority, land
  on its profile.
- _Citizen:_ „Кои са най-големите печеливши?" — see the top-beneficiaries leaderboard preview,
  click through.
- _Journalist:_ „Какво ново и съмнително?" — see the latest / largest red-flag contracts, click
  through.

**Key elements.**

- One-sentence mission statement, plain Bulgarian, no jargon.
- Three corpus totals as plain text: брой договори, обща стойност (лв.), брой институции
  / компании / лица. Stated as facts, not as "hero stat cards".
- A prominent search/jump field with placeholder examples: „Община Благоевград", „Главболгарстрой",
  „Иван Петров", „00097-2020-0001".
- An "Намери своята институция" entry: dropdown or type-ahead grouped by authority type
  (министерства, общини, агенции, болници, училища, други).
- A short "Топ 10 бенефициенти" preview list with link to the full leaderboard.
- A short "Сигнали за внимание" preview — three to five latest / largest red-flag contracts,
  each with the firing signals visible.
- A "Как се чете тази платформа" link to the methodology page.
- Footer: data snapshot date, source registers, license, link to source code.

**What's deliberately not here.** No carousel. No hero illustration. No animated charts. No
testimonial / endorsement section.

---

## B. Entity profiles

The four entity types each have a profile screen. They share a common skeleton — title, key facts
panel, three to five report sections, a contracts table at the bottom — so a user who learns to
read one learns to read all four.

### B.1 `/институции/[slug]` Authority profile (`Профил на институция`)

**Purpose.** Answer the citizen question „Къде харчи парите тази институция и на кого?" Make the
counter-question „Кой печели прекалено много от тази институция?" surface naturally.

**Primary user jobs.**

- See the total spent by this authority and over what period.
- See the top contractors that won money from it, and the share of the authority's total each
  represents (concentration is the story).
- See the CPV / contract-kind mix — _what_ is being bought.
- See the procedure-type mix — _how_ it's being procured (competitive vs negotiated).
- See the red-flag signals firing for this authority, with examples.
- Drill into the full contracts list filtered to this authority.

**Key elements.**

- Header: authority name, type chip (министерство / община / агенция / …), normalized canonical
  form note if the source data had variants.
- Key facts row: общо договори, обща стойност, период (от … до …), брой различни изпълнители,
  дял на ЕС финансиране, средно оферти на търг.
- "Топ изпълнители" — ranked table of contractors with money won, contract count, % share of
  this authority's spend. Each contractor name links to their company profile.
- "Какво купува" — CPV breakdown (treemap or sorted bar list; we'll pick later).
- "Как купува" — procedure-type distribution; non-competitive procedures highlighted.
- "Сигнали" — red-flag signals firing for this authority with one-line explanations and a link
  to the methodology entry for each. (The leaderboard equivalent for one entity.)
- "Всички договори" — paginated table at the bottom, filterable, sortable, exportable.
- Sticky breadcrumb above: `Начало › Институции › [name]`.

### B.2 `/компании/[eik]` Company profile (`Профил на компания`)

**Purpose.** Answer „Какво е спечелила тази компания от държавата и как?" Surface concentration,
EU-funding share, owner connections, and red-flag signals tied to this contractor.

**Primary user jobs.**

- Total money won, contract count, period — at a glance.
- Which authorities they win from (the inverse of B.1's "Топ изпълнители").
- CPV mix — what they sell.
- Procedure-type mix — how competitively they win.
- Their beneficial owners (people) and any other companies those owners control.
- Red-flag signals tied to this contractor.

**Key elements.**

- Header: company name, ЕИК (with copy button), registered seat / address from Trade Register
  (city level only, no street).
- Key facts row: общо спечелено, брой договори, брой институции, брой различни CPV категории,
  дял ЕС финансиране, среден брой оферти на търг.
- **"Собственици и свързани лица"** — owner panel. Lists each beneficial owner, their share if
  available, and a click-through to that person's profile. _Owner-data is integrated in v1, so
  this is a first-class section, not a stub._
- "Свързани компании чрез споделени собственици" — list of other companies controlled by the
  same person(s), with their total public money won. The shared-owner concentration story.
- "Откъде печели" — ranked authorities by money won from each.
- "Какво продава" — CPV breakdown.
- "Как печели" — procedure-type distribution, competitive bid count distribution.
- "Сигнали" — red-flag signals for this company.
- "Всички договори" — table at the bottom.

### B.3 `/лица/[id]` Person profile (`Профил на лице`)

**Purpose.** Aggregate the public benefit accruing to a single person across all the companies
they control. This is the screen that makes Sigma more than a procurement explorer.

**Primary user jobs.**

- See the total amount of public money won by all companies this person is a beneficial owner /
  manager of, summed.
- See which companies, with each one's contribution.
- See which authorities ultimately paid that money (collapsed through the companies).
- See the red-flag signals across the controlled portfolio (e.g. multiple controlled companies
  bidding for and "competing" on the same tenders).

**Key elements.**

- Header: name + role chip (собственик / управител / представител). No personal ID, no address,
  no other PII.
- Key facts row: общо публични средства към свързани компании, брой свързани компании, брой
  институции платци, период.
- "Свързани компании" — table of companies with this person's role + ownership share + money
  won. Each row links to the company profile.
- "Откъде идват парите" — authorities aggregated through the controlled companies.
- "Сигнали на ниво лице" — red-flag signals that exist at this aggregation level (notably the
  shared-owner-concentration signal, only visible here and on the flows screen).
- "Данни" — source disclosure: per data.egov.bg Trade Register, snapshot date, license note.

### B.4 `/договори/[id]` Contract detail (`Профил на договор`)

**Purpose.** The atomic record. Every aggregate, every red flag, every story eventually points
here. Must show the full provenance and the firing red-flag signals with explanations.

**Primary user jobs.**

- Read the contract subject, parties, value, period, procedure.
- Understand which red flags (if any) apply, and why each one fired.
- Jump to the authority profile, the company profile, the person profiles, the CPV category, or
  to other lots of the same parent tender.
- Cite the contract by UNP or share a link to it.

**Key elements.**

- Header: contract number / UNP (copyable), subject, status chip (изпълнен / в изпълнение /
  прекратен when derivable).
- Parties block: authority (linked), contractor (linked, with owners listed and linked), EU-funded
  flag, sector chip, CPV code (linked).
- Procurement details: procedure type, bids received, published in OJEU.
- Value history: estimated → signing → current, with growth percentages and annex count.
- Dates: signing, start, end.
- "Сигнали за внимание" — every red-flag signal firing on this contract, each with a one-sentence
  explanation and a methodology link. If no signals fire, an explicit "Няма открити сигнали" note.
- "Друго от тази поръчка" — sibling lots under the same `parent_tender_id`.
- Source row: link out to the original АОП record (we store the official URL where possible).

---

## C. Leaderboards & lists

The "rank by money" surfaces. The investigative posture we picked means these are named-and-ranked
lists, not "trend" charts.

### C.1 `/компании` Top beneficiaries (`Топ бенефициенти`)

**Purpose.** Answer „Кой печели най-много от държавата?" by company. Default sort: total signed
value descending.

**Primary user jobs.** Browse the leaderboard, switch the sort (by total / by contract count / by
authority count), filter by sector / EU-funded / period.

**Key elements.**

- Ranked table: компания (linked), общо спечелено, брой договори, брой институции, дял ЕС, брой
  собственици, сигнали (red badge if any).
- Filter rail: сектор, година(и), EU финансиране, тип процедура, минимална сума.
- A toggle: "по компании" / "по лица" — flips to the person leaderboard B-equivalent without a
  context switch.
- CSV export of the current filtered view.

### C.2 `/институции` Top spenders (`Институции по разход`)

**Purpose.** The inverse — „Коя институция харчи най-много?" Default sort: total signed value
descending.

**Key elements.**

- Ranked table: институция (linked), тип, общо разход, брой договори, брой различни изпълнители,
  концентрация (top-1 contractor's share, useful red-flag-adjacent signal), сигнали.
- Filter rail: тип институция (министерство / община / …), сектор, година, EU финансиране.
- Group-by toggle: "общо" / "по тип институция" (collapses to ministry totals, municipality
  totals, etc.).
- CSV export.

### C.3 `/лица` Top beneficial owners (`Топ собственици`)

**Purpose.** Rank people by the public money accruing across all companies they control. The
unique killer view enabled by the owner-data layer.

**Key elements.**

- Ranked table: лице (linked), общо през свързани компании, брой свързани компании, брой
  институции платци, сигнали.
- Filter rail: сектор, година, минимален брой компании (≥2 surfaces shared-owner
  concentration), EU финансиране.
- CSV export.

### C.4 `/червени-флагове` Red-flag leaderboard (`Червени флагове`)

**Purpose.** The investigative-posture flagship surface. Ranks _contracts_ by a composite red-flag
score, with the firing signals visible inline. Also offers an "by actor" toggle for ranking
companies / authorities / people by aggregated red-flag exposure.

**Primary user jobs.**

- Browse the worst-scoring contracts, see at a glance which signals fired.
- Filter to a single signal type to study it ("show me only single-bid contracts above 1M лв.").
- Switch to "by actor" view to see who systematically appears in flagged contracts.

**Key elements.**

- Top of page: a brief plain-language explanation of what the score means and a methodology link.
  Trust framing: „Класирането е по обективни характеристики, не по подозрение."
- View tabs: договори (default) / институции / компании / лица.
- Filter rail: сигнали (multi-select of signal types — single-bid, негативна процедура, ръст на
  стойност, концентрация, ЕС финансиране без конкуренция, чести анекси, споделени собственици),
  сектор, година, минимална сума.
- Ranked table (договори view): договор / предмет, институция (linked), изпълнител (linked),
  стойност, сигнали (chips showing which fired), резултат.
- Each row expands to show the explanations for the firing signals — no need to click through to
  read the why.
- CSV export.

### C.5 `/договори` Contracts browser (`Договори`)

**Purpose.** The generic filtered list. Every aggregate on the site, when clicked, lands here with
its filters pre-applied. The "decompose any number to its evidence" surface.

**Primary user jobs.** Build an arbitrary filtered view of contracts; sort by any of the key
fields; export.

**Key elements.**

- Filter rail: full set — сектор, тип институция, конкретна институция (search), конкретен
  изпълнител (search), конкретно лице (search), CPV код, тип процедура, EU финансиране, OJEU
  публикация, период (от / до), стойностен диапазон, брой оферти, сигнали.
- Table: договор (linked, UNP), предмет (truncated), институция (linked), изпълнител (linked),
  стойност, дата на подписване, процедура (chip), сигнали (badges).
- Sort by any column.
- CSV export of the current filtered view.
- The currently-applied filters render as removable chips above the table so the user can
  understand and edit the view at a glance.

---

## D. Visualisation

### D.1 `/потоци` Money flows (`Потоци на пари`)

**Purpose.** Show the citizen the shape of where the money goes — from authorities, through
companies, to people. The single most visually ambitious screen in v1. Not a kitchen-sink network
graph; a focused Sankey-style flow.

**Primary user jobs.**

- See the largest authority → company flows at a glance, scoped to a sector / year / EU-funded
  filter.
- Click any flow to drill into the contracts behind it.
- Toggle a third layer that surfaces the beneficial-owner connections behind the companies —
  collapsing nominally-separate companies into the same owner column. This is where the
  shared-owner concentration story becomes visual.

**Key elements.**

- Three-column Sankey: Институции (left) → Компании (middle) → Лица (right). The right column is
  toggleable: hide it for the procurement-only view, show it for the beneficial-owner view.
- Initial view is scoped — the full graph is unreadable. Default scope: top N flows by value, one
  sector, one year. The user can change all three.
- Hover any node or flow: tooltip with the underlying total, contract count, and a "виж договори"
  action.
- Click any node: zooms to flows touching that node (filter applied to the rest).
- A "Сценарии" sidebar with two or three pre-built filtered views ("Строителство 2023 — топ 20
  потока", "Храни ЕС-финансирани — топ 15 потока", "Институции с висока концентрация на един
  изпълнител") — anchored examples the citizen can click rather than building their own filter
  from scratch.
- "Защо това има значение" — short prose block under the visualisation explaining what the user
  is looking at and what patterns to watch for. (Civic-transparency posture: educate, don't
  decorate.)
- Below the visualisation: the contracts table for the currently-scoped view. Same "decompose to
  evidence" pattern as everywhere else.

---

## E. Search

### E.1 `/търсене?q=…` Global search (`Търсене`)

**Purpose.** A single text field, results grouped by entity type. The journalist's primary entry
point.

**Key elements.**

- One text input at the top, pre-filled with the query.
- Five result groups, each with a count and a "виж всички" link: Институции, Компании, Лица,
  CPV категории, Договори (matched by UNP, contract number, or subject substring).
- Within each group: up to five preview rows with a one-line summary.
- Empty-state: suggestions of common searches and a link to the contracts browser.

---

## F. Reference

### F.1 `/методология` Methodology (`Методология`)

**Purpose.** The trust spine. Where every red-flag signal is defined, every aggregation is
explained, every data limitation is disclosed.

**Key elements.**

- "Какво е Сигма" — one-paragraph mission, audience, scope.
- "Какво има в данните" — sectors covered, snapshot date, row count, fields included, fields
  excluded.
- "Какво не може Сигма да каже" — the honest limitations: missing periods, normalization
  caveats, ownership data coverage gaps, no causation claims.
- "Червени флагове" — the full catalog (see `03-red-flag-catalog.md`). Each signal: definition,
  data fields used, what it can mean, what it _cannot_ prove.
- "Източници" — АОП register link, data.egov.bg Trade Register link, license terms.
- "Речник" — glossary of procurement terms in plain Bulgarian: ЕИК, CPV, OJEU, anex, процедура
  types.

### F.2 `/за-сигма` About (`За Сигма`)

**Purpose.** Who builds this, how to contact, how to cite.

**Key elements.** One-paragraph "Какво е Сигма", maintainers / organisation, contact (email),
link to source code, license, citation guidance for journalists.

---

## G. What gets built in the prototype, and what stays as a doc

For this round, the clickable HTML prototype implements five screens at low-fidelity:

- **Home** (`index.html`) — full
- **Authority profile** (`authority.html`) — one realistic example (ОБЩИНА БЛАГОЕВГРАД-style)
- **Company profile** (`company.html`) — one realistic example (top-beneficiary contractor)
- **Person profile** (`person.html`) — one example, the owner-layer demo
- **Money flows** (`flows.html`) — Sankey with toggleable owner column
- **Red flags** (`red-flags.html`) — leaderboard with expandable rows

The other screens (search, contract detail, contracts browser, top-spenders, top-owners,
methodology, about) are documented above and will be built when we move from "argue scope" to
"design specs".
