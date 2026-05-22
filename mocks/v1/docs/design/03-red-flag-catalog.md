# Sigma — Red-flag signal catalog (v1)

> Investigative posture: we name and rank patterns. We do not accuse people. Every signal in the
> UI is accompanied by its definition and a link back to this catalog.

## 0. Framing

Each red flag is a **characteristic that warrants scrutiny**, not a verdict. A contract can fire
several signals and be entirely legitimate; a contract can fire zero signals and still be corrupt.
The signals are what the available data lets us detect. We surface them, we explain them, we let
the user decide.

Every signal has, in this document and in the UI:

1. **Name** — short Bulgarian label, used as a chip everywhere it surfaces.
2. **Definition** — the precise data condition that fires it, in plain words.
3. **Fields used** — the columns from `raw_aop_contracts` and Trade Register.
4. **Interpretation** — what the pattern can mean, including innocent explanations.
5. **What it cannot prove** — the explicit limitation, so we never overclaim.
6. **Where it surfaces** — which screens render this signal.

The scoring rule (how signals combine into a contract / actor score) is at the bottom.

---

## 1. Single-bid award (`Една оферта`)

**Definition.** The contract was awarded with `bids_received` ≤ 1 — only one bidder participated
in a procedure that was nominally competitive.

**Fields used.** `bids_received`.

**Interpretation.** Genuine competition produces multiple bids. A single-bidder award in an open
or public-contest procedure can indicate the tender was scoped so narrowly that only one company
could qualify, that potential bidders self-excluded for reasons worth understanding, or that the
market for this good is genuinely thin (one supplier in the region).

**What it cannot prove.** That the procurement was rigged. Single-supplier markets are real,
especially for specialised construction or geographically constrained food supply.

**Where it surfaces.** Contract detail, red-flag leaderboard, all entity profile "Сигнали"
panels, contracts browser filter, every contract row badge.

---

## 2. Non-competitive procedure (`Без конкурентна процедура`)

**Definition.** `procedure_type` is one of: `Пряко договаряне`, `Договаряне без предварително
обявление`, `Договаряне без обявление за обществена поръчка`, or other procedure types that the
PPA classifies as non-competitive.

**Fields used.** `procedure_type`.

**Interpretation.** Direct negotiation is legitimate in the Public Procurement Act for specific
exceptions (emergencies, sole supplier, technical reasons, …). Heavy use of these procedures, or
their use for routine purchases that could have been competitively procured, warrants scrutiny.

**What it cannot prove.** That the exception invoked was unjustified.

**Where it surfaces.** Contract detail, red-flag leaderboard, authority/company profile "Как
купува" / "Как печели" sections, procedure-type filter chip.

---

## 3. Estimated → signing → current value growth (`Ръст на стойността`)

**Definition.** The contract's `current_value_eur` exceeds `signing_value_eur` by more than a
threshold (default proposal: > 20% or > 100 000 EUR, whichever is larger), or the signing value
exceeds the estimated value by a similar threshold.

**Fields used.** `estimated_value_eur`, `signing_value_eur`, `current_value_eur`, `annex`.

**Interpretation.** Costs grow for legitimate reasons — unforeseen site conditions, scope changes
agreed by both parties. Growth that is large, repeated, or systematic at the level of a single
contractor or authority is a known corruption pattern (bid low, profit through amendments).

**What it cannot prove.** That the growth was unjustified. Construction in particular has known
inflation drivers (steel, fuel, labour).

**Where it surfaces.** Contract detail (with the three values shown side by side and the delta
%), red-flag leaderboard, company / authority profile "Сигнали" panels.

---

## 4. Frequent annexes (`Чести анекси`)

**Definition.** Contract has annex / amendment indicators (`annex` field) present and the count
exceeds a threshold (default proposal: ≥ 3 annexes, or ≥ 2 annexes combined with signal #3).

**Fields used.** `annex` (currently a flag; needs to be a count after a small ETL pass — design
notes this as a data dependency).

**Interpretation.** Many amendments to a single contract can indicate poor initial scoping
(innocent), a contractor unable to deliver as bid (operational risk), or a deliberate strategy of
post-award negotiation (corruption pattern).

**What it cannot prove.** That the amendments were improper.

**Where it surfaces.** Contract detail, red-flag leaderboard. Often co-fires with signal #3.

---

## 5. Authority concentration (`Концентрация на изпълнител`)

**Definition.** At the **authority** level: one company won more than a threshold share (default
proposal: > 40%) of an authority's total spend in a calendar year, while the authority awarded at
least N contracts (default proposal: N ≥ 5) so this isn't an artefact of low denominator.

**Fields used.** Aggregated `signing_value_eur` per (`authority_name`, `contractor_eik`, year) over
the authority's total in that year, with contract count threshold.

**Interpretation.** A single contractor dominating a single authority's spend year over year
suggests either a long-term framework agreement (legitimate but worth understanding), a
specialised market with one viable supplier (legitimate), or a captured procurement function
(corruption pattern).

**What it cannot prove.** That the relationship is improper. Framework agreements are legal and
common.

**Where it surfaces.** Authority profile (top of "Сигнали" section, with the contractor named and
the % share quantified), red-flag leaderboard "by actor — institutions" view, flow visualisation
(visually evident as a single thick flow from one node).

---

## 6. EU funding without competition (`ЕС средства без конкуренция`)

**Definition.** `eu_funded = 1` AND (`procedure_type` is non-competitive OR `bids_received` ≤ 1).

**Fields used.** `eu_funded`, `procedure_type`, `bids_received`.

**Interpretation.** EU funds carry stricter procurement obligations than national funds. A
non-competitive award of EU money is a higher-severity version of signals #1 and #2 — it is also
auditable by EU bodies, which makes it both more serious and more discoverable.

**What it cannot prove.** That the EU procurement rules were violated. Exceptions exist; the
audit determination is not ours to make.

**Where it surfaces.** Contract detail (with an EU badge and the firing signal shown), red-flag
leaderboard (this is the highest-scoring single-signal category in the default scoring rule).

---

## 7. Shared-owner concentration (`Споделени собственици`) ✨ _owner-data layer_

**Definition.** Two or more companies sharing a beneficial owner (via the Trade Register
relationships table) bid on or win contracts from the same authority, especially within the same
tender or within a short time window. Two sub-variants:

- **7a — Same-tender shared owners.** Two or more bidders in a single tender share an owner. This
  is the classic "phantom competition" pattern.
- **7b — Same-authority concentration through shared owners.** One authority's spend that looks
  diversified across N companies collapses to a much smaller set of beneficial owners. Computed
  by aggregating signal #5 at the person level instead of the company level.

**Fields used.** `contractor_eik`, `authority_name`, `tender_internal_id` (for 7a) + Trade
Register relationships (person ↔ company).

**Interpretation.** 7a is one of the strongest paper-trail signals of bid rigging. 7b reframes
the apparent diversification of an authority's awards and is often the first visible sign of a
captured procurement function. Both depend entirely on the owner-data layer being present and
clean.

**What it cannot prove.** That the bidders coordinated. Two companies can share an owner and
genuinely compete (e.g. holding-company subsidiaries). The signal warrants scrutiny; it does not
adjudicate intent.

**Where it surfaces.** Person profile (the dedicated screen for this signal), company profile
("Свързани компании чрез споделени собственици"), flow visualisation (with owner column toggled
on, the pattern becomes geometrically visible), red-flag leaderboard "by actor — people" view.

---

## 8. Late publication / no OJEU when required (`Без публикация в ОВ на ЕС`) _(v1.1)_

**Definition.** Contracts above the EU thresholds that were not published in the Official Journal
of the European Union (`published_ojeu = 0`).

**Fields used.** `signing_value_eur`, `contract_kind`, `published_ojeu`.

**Status.** Drafted but not in the v1 prototype — requires the current EU thresholds table by
contract kind and year, which is a small but explicit data dependency. Reserved as v1.1.

---

## 9. Repeat-contractor on non-competitive procedure (`Многократно директно възлагане`) _(v1.1)_

**Definition.** Same `contractor_eik` won ≥ N contracts under non-competitive procedures from the
same `authority_name` within a calendar year (default proposal: N ≥ 3).

**Status.** Drafted but not in the v1 prototype — it is a useful refinement once #2 and #5 are
both deployed. Reserved as v1.1.

---

## Composite scoring (proposal, not committed)

Each contract earns points per signal it fires:

| Signal | Points |
|---|---|
| #1 Single bid | 20 |
| #2 Non-competitive procedure | 25 |
| #3 Value growth > threshold | 25 (capped) |
| #4 Frequent annexes | 15 |
| #5 Authority concentration (rolled up to contract) | 15 |
| #6 EU funding without competition | 30 (additive on top of #1 or #2) |
| #7a Same-tender shared owners | 40 |
| #7b Authority concentration through shared owners (rolled up to contract) | 25 |

A contract's red-flag score is the sum of points from signals it fires, capped at 100. The
leaderboard ranks by score, then by signing value as a tiebreaker so we prefer surfacing the
larger of two equally-flagged contracts.

For actors (companies / authorities / people), the score is **not** the sum of contract scores
(which would just reward volume). It is computed as: `% of the actor's contracts that fire any
signal × log(actor's total value)`. The weighting can be tuned; the principle — a 10-contract
actor with all 10 flagged outranks a 1000-contract actor with 30 flagged — is the design intent.

This scoring is a v1 starting proposal. The methodology page must always show the current rule.
