# Sigma — Regulatory Compliance Map

*Scope: legal/regulatory regimes governing government / public-interest websites and apps in the EU and Bulgaria, as they apply to Sigma (a Bulgarian public-procurement transparency web app + JSON API + CSV/sitemap exports). Where applicability depends on **who operates Sigma**, this is flagged explicitly. Corrected per independent fact-check; verdicts that were not "confirmed" have been folded into the text below.*

> **Companion to** the code review [`../qa/code-review-2026-06-03.md`](../qa/code-review-2026-06-03.md) — the accessibility and beneficial-owner-name findings there are the live hooks for regimes #1–#4 below. **Method:** multi-agent web research across 5 regulatory domains (23 regulations); 15 load-bearing claims (dates, scope, BG transposing instruments) independently fact-checked against EUR-Lex / CJEU / Държавен вестник / official BG guidance — 5 were corrected and folded in. **This is an engineering compliance map, not legal advice** — use it to brief counsel and scope the work, not as a substitute for a qualified DPO/lawyer.

> **Operator status — DETERMINED (2026-06-03): Sigma is operated by a PUBLIC-SECTOR BODY.** The **PUB branch applies throughout.** This activates, *directly and with legal teeth*: the **Web Accessibility Directive 2016/2102** (→ ЗЕУ чл. 58в–58г — WCAG 2.1 AA / EN 301 549, *декларация за достъпност*, feedback mechanism, МЕУ monitoring); **NIS2 as an "essential entity"** (→ Закон за киберсигурност — full ISMS, МЕУ registration, 24h/72h/1-month incident reporting, management-body accountability); the **ЗЕУ e-government baseline** (RegiX, МЕУ registration, единен модел, and likely **migration off Cloudflare to the State Hybrid Private Cloud (ДХЧО) under a `.government.bg` domain**); and **full publish-as-open-data duties** (ЗДОИ / HVD). **GDPR + *Sovim* remain P0** — now with **Art. 6(1)(e) public-task** available as an additional lawful basis alongside 6(1)(f). The PRIV-only conclusions noted below (e.g. EAA-instead-of-WAD, "ЗЕУ does not bind") do **not** apply to Sigma.

---

## TL;DR

Ranked by priority for Sigma. "Applies?" answers are stated for the two operator scenarios where they diverge (PUB = public-sector body / body governed by public law; PRIV = private/NGO transparency operator).

| # | Regime | EU instrument | BG transposition | Applies to Sigma? | Priority |
|---|--------|---------------|------------------|-------------------|----------|
| 1 | **Data protection (personal names of beneficial owners)** | Regulation (EU) 2016/679 (GDPR) | Закон за защита на личните данни (ЗЗЛД), ДВ бр. 17/26.02.2019, in force 02.03.2019; КЗЛД/CPDP | **YES — both PUB and PRIV** | **P0 — critical** |
| 2 | **Sovim / Luxembourg Business Registers** (proportionality of public UBO access) | CJEU joined C-37/20 & C-601/20, 22 Nov 2022 (Charter Arts 7 & 8) | Direct EU effect; no transposition. Felt via ЗМИП register-access | **YES — both** (legal-risk authority for #1) | **P0 — critical** |
| 3 | **Web accessibility** | Directive (EU) 2016/2102 | ЗЕУ чл. 58в–58г (ДВ бр. 94/29.11.2019) + Наредба за общите изисквания… чл. 39, 39а (изм. ДВ бр. 4/14.01.2020) | **PUB: YES. PRIV: NO** (unless "body governed by public law" / essential public service) | **P0 (if PUB) / P1 build-to-standard (if PRIV)** |
| 4 | **Technical accessibility standard** | EN 301 549 v3.2.1 (harmonised via Impl. Dec. (EU) 2021/1339) | Via ЗЕУ чл. 58в + Наредба | **Build target either way** (WCAG 2.1 AA baseline) | **P1** |
| 5 | **ePrivacy / cookie consent** | Directive 2002/58/EC, art. 5(3) (as amended by 2009/136/EC) | чл. 4а Закон за електронната търговия (ЗЕТ); ЗЕС | **Only if Sigma sets non-essential cookies / analytics** | **P1** |
| 6 | **E-commerce imprint (импресум)** | Directive 2000/31/EC, art. 5 | ЗЕТ чл. 4 (ДВ бр. 51/2006) | **Likely (PRIV), conditional on "economic activity"**; PUB covers it via ЗЕУ | **P2 — cheap to satisfy** |
| 7 | **Cybersecurity (NIS2)** | Directive (EU) 2022/2555 | Закон за киберсигурност, am. by ЗИД adopted 05.02.2026, ДВ бр. 17/13.02.2026; + Наредба за минималните изисквания… (ПМС №186, ДВ бр. 59/2019) | **PUB (admin body): YES, "essential entity". PRIV: only if covered sector + size threshold** | **P1 (if PUB) / P3 best-practice (if PRIV)** |
| 8 | **European Accessibility Act** | Directive (EU) 2019/882 | Закон за изискванията за достъпност на продукти и услуги (ДВ 11.04.2025, in force 28.06.2025) | **Almost certainly NO** (procurement info portal is not an enumerated consumer service) | P3 |
| 9 | **Open Data / PSI re-use** | Directive (EU) 2019/1024 + HVD Reg. (EU) 2023/138 | ЗДОИ re-use chapter (Глава трета "а", чл. 41а+, am. ДВ бр. 82/2023) + Наредба за стандартните условия… | **PRIV: inherits licence/attribution conditions only. PUB: full publish-as-open-data duty** | P2 |
| 10 | **AMLD5 (source of UBO data)** | Directive (EU) 2018/843 | Закон за мерките срещу изпирането на пари (ЗМИП) | **Provenance only** — does NOT authorise re-publication | P2 (context for #1/#2) |
| 11 | **2024 AML package** (legitimate-interest access) | Reg. (EU) 2024/1624 + Dir. (EU) 2024/1640 | AMLR direct; AMLD6 by 10 Jul 2027 | **Not yet — design benchmark** | P3 (forward-looking) |
| 12 | **eIDAS / eIDAS 2.0** | Reg. (EU) 910/2014; Reg. (EU) 2024/1183 | ЗЕДЕУУ; КРС/CRC supervises | **NO for read-only no-login Sigma** | P3 |
| 13 | **Single Digital Gateway** | Regulation (EU) 2018/1724 | ЗЕУ / national portal | **NO** (binds Member States/competent authorities) | P4 |
| 14 | **eForms / ЗОП procurement publication** | Impl. Reg. (EU) 2019/1780; Dirs 2014/24–25–23/EU | ЗОП + ЦАИС ЕОП | **NO** — binds contracting authorities; defines Sigma's input schema | P4 (structural) |
| 15 | **Cyber Resilience Act** | Regulation (EU) 2024/2847 | Direct; market-surveillance designation only | **NO** — Sigma is an operated service, not a product placed on the market | P5 |
| 16 | **ЗЕУ e-gov baseline / ДХЧО / .government.bg** | n/a (domestic) | ЗЕУ (ДВ бр. 46/2007) + наредби | **PUB: YES. PRIV: NO** | P2 (if PUB) |

---

## The scoping question that changes everything

**Almost every borderline answer above forks on one fact: is Sigma operated by a Bulgarian public-sector body, or by a private operator / NGO?** This is not a formality — it determines whether four separate regimes bind Sigma *directly* or merely supply best-practice baselines.

The legal hinge is the definition of who is caught. Three categories recur in Bulgarian law (and track the EU "body governed by public law" concept):

- **административни органи** (administrative bodies — ministries, agencies like АОП, municipalities);
- **лица, осъществяващи публични функции** (persons exercising public functions — e.g. notaries, ЧСИ);
- **организации, предоставящи обществени услуги** (organisations providing essential public services — education, health, water, energy, telecom, banking).

A private NGO that merely republishes third-party АОП / Търговски регистър / OCDS data matches **none** of these, *unless* it is publicly funded enough to be a "body governed by public law" or is contractually operating a service *on behalf of* a public body. The fact-check refined one point here: the Web Accessibility Directive does **not** "exclude the private sector" wholesale — a private body **can** be caught if it qualifies as a body governed by public law or provides an essential public service. So the question for Sigma is precise: *is the procurement-transparency portal an essential public service, or is the operator a publicly-funded body governed by public law?* If yes on either, the PUB branch applies.

**Branch A — Sigma is a public-sector body / body governed by public law.** This pulls in, directly and with legal teeth:
- **Web Accessibility Directive 2016/2102 → ЗЕУ чл. 58в–58г** (EN 301 549 / WCAG 2.1 AA, published accessibility declaration, feedback mechanism, monitoring by МЕУ).
- **NIS2 → Закон за киберсигурност** — as a Bulgarian *административен орган*, Sigma is an **"essential entity"** (Bulgaria designated all administrative bodies, including municipalities, as essential — going beyond the NIS2 floor). Full ISMS + registration with МЕУ + 24h/72h/1-month incident reporting + management-body accountability/training.
- **ЗЕУ e-government baseline** — RegiX integration, registration in МЕУ registers, единен модел for e-services, and the expectation to host on the **State Hybrid Private Cloud (ДХЧО)** under a **.government.bg** domain (which would force migration off Cloudflare Workers).
- **Open Data Directive / HVD / ЗДОИ** publish-as-open-data duties, and the **Single Digital Gateway** quality + accessibility cross-reference if Sigma is an official government service.

**Branch B — Sigma is a private/NGO transparency operator.** Then:
- **GDPR + ЗЗЛД bind regardless** (Branch B does not escape data protection — see below).
- **The Sovim ruling's proportionality logic still constrains** republishing owner names (via GDPR, not via the directive directly).
- **European Accessibility Act 2019/882** would in principle be the private-sector accessibility regime — but it covers a *closed list* of consumer products/services (e-commerce, banking, e-books, transport, 112) and a procurement-information portal is **not** on it. So EAA almost certainly does **not** mandate Sigma's accessibility.
- **The ЗЕТ imprint duty (чл. 4)** plausibly reaches a private operator — conditional on the "economic activity" element (see #6).
- **ePrivacy cookie rules** bite only if Sigma sets non-essential cookies.
- **The public-sector-only regimes (2016/2102, NIS2-as-essential-entity, ЗЕУ baseline, SDG) do NOT bind** — though WCAG 2.1 AA and the security baseline remain the right engineering targets, and funding/procurement clauses can contractually pull them back in.

**Crucially, the data-protection analysis (regimes #1 and #2) is identical in both branches.** Only the *legitimate-interest balancing* shifts (a public body may additionally invoke Art. 6(1)(e) public-task; a private operator leans on Art. 6(1)(f)).

---

## Regime-by-regime

### 1. GDPR + ЗЗЛД — the controlling regime for owner names *(P0, applies to both branches)*

- **What it requires.** A documented **lawful basis** for every processing operation. For republishing natural-person beneficial-owner names, the realistic basis is **Art. 6(1)(f) legitimate interest**, which requires a documented **balancing test / LIA** (consent and legal-obligation are weak fits for a transparency republisher; a public-body operator may also rely on Art. 6(1)(e) public task). Plus: a transparent **privacy notice** (Arts 13–14, including the source of registry-sourced data — Art. 14); facilitation of **data-subject rights** (access, rectification, erasure, **Art. 21 objection** — especially relevant to owner-name publication, restriction); **data-protection by design/default** (Art. 25); a **DPIA** (Art. 35); records of processing (Art. 30); likely a **DPO** given large-scale systematic monitoring; and **data-minimisation + accuracy** bearing directly on storing/exposing names and any НАП/registry identifiers.
- **A DPIA is effectively mandatory.** Large-scale, systematic republication of personal data of natural persons sourced from public registers, combined with profiling/"risk-score" features, hits multiple Art. 35 triggers.
- **Dates.** GDPR applicable since 25 May 2018. ЗЗЛД GDPR-aligning amendments promulgated **ДВ бр. 17/26.02.2019, in force 2 March 2019** (confirmed).
- **BG instrument / authority.** Закон за защита на личните данни (ЗЗЛД); supervisory authority **Комисия за защита на личните данни (КЗЛД / CPDP)**. (Note: for courts/prosecution acting judicially the supervisor is the Inspectorate to the Supreme Judicial Council — not relevant to Sigma.)
- **Standard to build to.** EDPB guidelines (incl. Guidelines 5/2020 on consent); ISO/IEC 27001/27701 commonly used to evidence Art. 32 security (not legally mandated).
- **Penalties.** Up to **EUR 20 million or 4% of worldwide annual turnover** (GDPR Art. 83), enforced by КЗЛД.
- **What Sigma must do.** (a) Run and document a **DPIA** covering UBO-name republication and the risk-score feature. (b) Write and document an **Art. 6(1)(f) LIA** (or Art. 6(1)(e) if PUB). (c) Publish an Arts 13–14 **privacy notice** naming the registry sources. (d) Build a working **Art. 21 objection / erasure** workflow for named individuals. (e) Apply **minimisation** — question whether full owner names need to be on the open web at all (see §4).

Sources: https://www.cpdp.bg/en/legislation/personal-data-protection-act/ · https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=135056 · https://www.dlapiperdataprotection.com/index.html?t=law&c=BG · https://gdprhub.eu/Data_Protection_in_Bulgaria

### 2. Sovim / Luxembourg Business Registers — no unrestricted public access to UBO data *(P0, applies to both branches)*

- **What it holds.** On **22 November 2022** the CJEU Grand Chamber (joined **C-37/20** *WM* & **C-601/20** *Sovim SA* v Luxembourg Business Registers) declared **Article 1(15)(c) of Directive (EU) 2018/843 invalid** in so far as it made beneficial-ownership information "accessible in all cases to any member of the general public." Indiscriminate public access is a disproportionate, not-strictly-necessary interference with **Charter Arts 7 (private life) & 8 (personal data)**.
- **What survives.** Access by competent authorities, obliged entities, and **persons demonstrating a legitimate interest** is not struck down — only the *general-public mandate*. The register itself remains.
- **Mechanism for Sigma.** The fact-check is emphatic: Sovim does **not** regulate Sigma directly. The operative constraint on Sigma runs through **GDPR/ЗЗЛД**, with Sovim as the **controlling EU-law authority** on *why* blanket public exposure of owner identities is disproportionate. Sigma cannot cite AMLD5 "public access" as a free pass — that limb is invalid. Republishing the same data to an unlimited public audience reproduces the interference the Court condemned and **weakens any Art. 6(1)(f) balancing**.
- **What Sigma must do.** Build the §1 LIA *around Sovim*: demonstrate necessity and proportionality; consider **legitimate-interest gating / access controls** rather than open mass publication of names; document the necessity/balancing assessment explicitly against the Charter Arts 7 & 8 analysis.

Sources: https://curia.europa.eu/site/upload/docs/application/pdf/2022-11/cp220188en.pdf · https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62020CA0037 · https://eur-lex.europa.eu/legal-content/EN/SUM/?uri=CELEX:62020CJ0037

### 3. Web Accessibility Directive 2016/2102 → ЗЕУ чл. 58в–58г *(P0 if PUB; build-to-standard if PRIV)*

- **Applies if** Sigma is operated by a public-sector body **or** a body governed by public law / one exercising public functions or providing an **essential public service**. The directive's actual exclusion is narrow: public-service broadcasters and NGOs "that do not provide services essential to the public" or specifically for persons with disabilities. So "private = exempt" is **not** automatic — borderline cases turn on the essential-public-service / body-governed-by-public-law test.
- **What it requires.** Web content + mobile apps must be **perceivable, operable, understandable, robust**, conforming to **EN 301 549 (≈ WCAG 2.1 AA)**. Plus a published, detailed **accessibility statement (декларация за достъпност)** stating compliance level, listing non-accessible content and accessible alternatives; a **feedback mechanism**; a link to the enforcement/complaint procedure (ЗЕУ чл. 58г); and periodic **monitoring** (methodology in Impl. Dec. (EU) 2018/1524; model statement in 2018/1523).
- **Dates (confirmed).** Transposition deadline 23 Sept 2018. Compliance: new public-sector sites **23 Sept 2019**; all existing sites **23 Sept 2020**; mobile apps **23 June 2021**. EN 301 549 v3.2.1 harmonised **18 Aug 2021** via Impl. Dec. (EU) 2021/1339.
- **BG instrument / authority.** ЗЕУ **чл. 58в–58г** (introduced by ДВ бр. 94/29.11.2019) + **Наредба за общите изисквания… чл. 39, 39а** (изм. ДВ бр. 4/14.01.2020). Monitoring/enforcement was the Chairperson of ДАЕУ; **functions transferred to the Minister of Electronic Governance (МЕУ)** when ДАЕУ was abolished (ЗИД на ЗЕУ, ДВ бр. 15/22.02.2022) (confirmed).
- **Penalties.** МЕУ issues binding instructions with deadlines; backed by ЗЕУ administrative-penalty provisions. Exact fine amounts not confirmed in sources.
- **What Sigma must do (if PUB, and recommended regardless).** Remediate the flagged WCAG issues to **WCAG 2.1 AA / EN 301 549**; **publish a декларация за достъпност**; add a feedback mechanism and complaint link.

Sources: https://eur-lex.europa.eu/eli/dir/2016/2102/oj/eng · https://egov.government.bg/wps/portal/ministry-meu/home/web-accessibility · https://e-gov.bg/wps/portal/agency-en/home/accessibility-websites-mobile-applications · https://digital-strategy.ec.europa.eu/en/policies/web-accessibility-directive-standards-and-harmonisation

### 4. EN 301 549 v3.2.1 — the technical yardstick *(P1, build target either branch)*

- Web-content clause 9 maps to **WCAG 2.1 levels A + AA**; additional clauses cover non-web documents and software. **Caveat:** meeting WCAG 2.1 AA alone does **not** fully guarantee EN 301 549 conformance (the EN adds non-WCAG requirements). This is the measurable standard whenever an accessibility obligation bites — and the standard a remediation effort for the flagged UI issues should target.
- v3.2.1 published 2021-03; harmonised for 2016/2102 since 18 Aug 2021. Not a penalty-bearing instrument on its own.

Sources: https://www.etsi.org/deliver/etsi_en/301500_301599/301549/03.02.01_60/en_301549v030201p.pdf · https://digital-strategy.ec.europa.eu/en/policies/web-accessibility-directive-standards-and-harmonisation

### 5. ePrivacy / cookie consent *(P1, conditional on cookie footprint)*

- **What it requires.** For any cookie / local-storage **not strictly necessary** to deliver the requested service (analytics, marketing, personalisation), obtain **prior, informed, freely-given, unambiguous opt-in consent** — no pre-ticked boxes, a genuine refuse option, a cookie policy + consent banner. Strictly-necessary cookies need information but not consent.
- **BG transposition nuance.** Transposed via **чл. 4а Закон за електронната търговия** (confidentiality parts in ЗЕС). The ЗЕТ wording is framed **opt-out** and is widely assessed as an *under-transposition*. But read with the GDPR definition of consent + EDPB Guidelines 5/2020 + КЗЛД sector guidance, the **effective standard is opt-in**.
- **Applies if** Sigma sets any non-essential cookie or runs analytics/third-party tags. A pure static/SSR site with only strictly-necessary cookies escapes the consent duty (information duty may remain). The ePrivacy *Regulation* that would replace the directive is **not yet adopted**.
- **Penalties.** Breaches involving personal data enforced by КЗЛД under GDPR Art. 83; ЗЕТ/ЗЕС add their own administrative sanctions.
- **What Sigma must do.** Audit the cookie/analytics footprint. If only strictly-necessary cookies, document that and skip the banner. If any analytics, deploy a **GDPR-grade opt-in consent banner** (no pre-tick, real reject).

Sources: https://gglaw.bg/biskvitki-bulgaria-eu/ · https://cpdp.bg/ · https://eur-lex.europa.eu/legal-content/BG/TXT/?uri=celex:32002L0058

### 6. E-commerce imprint (импресум) — ЗЕТ чл. 4 / Dir 2000/31/EC art. 5 *(P2, likely-PRIV, cheap)*

- **What it requires.** A provider of *услуги на информационното общество* must give permanent, direct, easy access to: name/business name, seat/management address, business address if different, **contact incl. phone and e-mail**, registration data, supervisory authority and VAT where applicable.
- **Correction (fact-check).** It is **not** "the one cross-cutting obligation" and **not** unconditional. *Услуга на информационното общество* is defined (ЗЕТ чл. 1, ал. 3, mirroring Dir 2000/31/EC art. 2(a) + recital 18) as a service **"обикновено възмездна"** — normally provided for remuneration. Per *Papasavvas* (C-291/13), free-to-user services are covered only insofar as they are an **economic activity** (e.g. ad/sponsorship-funded). A genuinely non-economic, ad-free public-interest transparency site may fall **outside** the definition — so applicability to Sigma is *plausible but not automatic*, turning on whether Sigma's operation is an economic activity. And it is not the *sole* cross-cutting duty (GDPR/ЗЗЛД also reach a private operator).
- **Penalties.** ЗЕТ чл. 23: roughly 200–1,000 BGN (individuals) / 500–2,500 BGN (legal entities) first breach (secondary figures — verify against current text).
- **What Sigma must do.** Publish an **impressum** (operator identity + contact e-mail/address). Trivial; worth doing whether or not strictly required.

Sources: https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX%3A32000L0031 · https://kik-info.com/normativna-baza/zakoni/0X2135530547/ · https://exlege.bg/normi/zet · https://ipcuria.eu/case?reference=C-291/13

### 7. NIS2 → Закон за киберсигурност *(P1 if PUB-as-essential-entity; best-practice if PRIV)*

- **What it requires.** Risk-management measures (ISO/IEC 27001-style ISMS: access control, incident handling, business continuity/backup, supply-chain security, vulnerability handling, encryption, MFA); **registration** in the national register of essential/important entities (kept confidentially by **МЕУ**); a mandatory **incident-reporting cascade** for significant incidents — **early warning ≤24h, full notification ≤72h, final report ≤1 month** — to the sectoral/national CSIRT (**CERT Bulgaria / govcert.bg**, confirmed as national CSIRT); **management-body accountability** (members personally liable, cybersecurity training). For a web app: secure SDLC, hardening, logging/monitoring, vuln management, breach detection.
- **Applies if.** **PUB:** a Bulgarian *административен орган* is an **"essential entity"** — Bulgaria classified **all administrative bodies, including municipalities, as essential**, going beyond the NIS2 floor. (Correction to the research: NIS2's own baseline mandates **central AND regional** public administration and leaves only **local** to Member-State discretion (Art. 2(2)(f), Art. 2(5)(a)) — not "central only." Bulgaria exceeded the floor by designating local/municipal bodies too.) **PRIV:** in scope only if it both falls in a covered Annex I/II sector **and** meets the size threshold (generally ≥50 staff or >EUR 10M turnover). A pure transparency website is not obviously a covered sector — likely out of scope unless it qualifies as a "digital service" / managed ICT provider or runs under contract for a public body.
- **Dates (confirmed).** NIS2 deadline 17 Oct 2024. Bulgaria's transposing **ЗИД adopted 5 Feb 2026, promulgated ДВ бр. 17/13.02.2026** (~16 months late; Commission reasoned opinion 7 May 2025); **in force 17 Feb 2026**, with a transitional **50% sanction reduction until 1 June 2026**. The implementing **Наредба за минималните изисквания…** (ПМС №186, ДВ бр. 59/2019) is to be updated (~Oct 2026 per secondary guidance — verify).
- **Competent authority.** **МЕУ** for administrative bodies (confirmed); CERT Bulgaria is the national CSIRT (confirmed).
- **Penalties.** Essential entities up to **EUR 10M or 2%** of global turnover; important entities up to **EUR 7M or 1.4%**; management-body members up to **EUR 5,000**.
- **What Sigma must do (if PUB; recommended baseline if PRIV).** Stand up an ISO 27001-aligned ISMS, register with МЕУ, implement the 24/72h/1-month incident workflow, and assign management-body accountability.

Sources: https://eur-lex.europa.eu/eli/dir/2022/2555/oj/eng · https://digital-strategy.ec.europa.eu/en/policies/nis2-directive-bulgaria · https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=241234 · https://www.govcert.bg/en/ · https://www.namrb.org/bg/za-obshtinite/konsultativni-materiali/novi-iziskvaniya-kam-obshtinite-po-zakona-za-kibersigurnost-direktiva-nis2-obhvat-merki-kontrol-i-sanktsii-19433

### 8. European Accessibility Act 2019/882 *(P3 — almost certainly NOT applicable)*

- Covers a **closed list** of consumer products/services: telephony, AV media access, transport (web/mobile/e-ticketing), consumer banking, e-books, e-commerce, emergency 112, plus listed hardware. A **public-procurement information portal is not on the list**. Applies from **28 June 2025** (transposition deadline was 28 June 2022; legacy services may continue to 28 June 2030 where a Member State grants the optional transition). Microenterprises providing services (<10 staff AND ≤EUR 2M) are exempt for services.
- **BG transposition (corrected).** Not in ЗЕУ — a **separate statute, "Закон за изискванията за достъпност на продукти и услуги" (ДВ 11.04.2025, in force 28.06.2025)**.
- **Bottom line for Sigma.** Does **not** itself mandate Sigma's accessibility — unless Sigma runs a genuinely in-scope commercial service (e.g. paid subscriptions / e-commerce). If Sigma is PUB, the 2016/2102 regime (not the EAA) is the operative obligation.

Sources: https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng · https://eur-lex.europa.eu/EN/legal-content/summary/accessibility-of-products-and-services.html

### 9. Open Data Directive / High-Value Datasets / ЗДОИ *(P2 — Sigma inherits conditions; full duty only if PUB)*

- **Who is bound.** Publication obligations land on **upstream public-sector holders** (АОП, Registry Agency, ministries, data.egov.bg) — **not on a downstream private/NGO re-user**. As a re-user, Sigma **inherits the licence/attribution conditions** on ingested data, not the publication duties. Only if Sigma is itself a public-sector body does the publish-as-open-data duty attach.
- **PSI re-use is subordinate to data protection.** Dir. 2019/1024 Art. 1(4) ("without prejudice to … Regulation (EU) 2016/679"), recital 52, and the Art. 1(2)(g) scope exclusion mean re-use rights **do not authorise re-publishing personal data**. The fact-check stresses the corollary: by publishing owner names, **Sigma becomes an independent controller directly bound by GDPR/ЗЗЛД** — the open-data instruments cut toward *more* obligation on Sigma, not a safe harbour.
- **High-Value Datasets** (Impl. Reg. (EU) 2023/138, **applies from 9 June 2024**): "**Companies and company ownership**" is one of the six mandated categories, so the registry data Sigma re-uses must already be free, machine-readable, API + bulk-download. **Licence correction:** the mandated open licence is **CC0 *or* CC BY 4.0 (or equivalent/less restrictive)** under Art. 4(3) — **not** "CC BY 4.0 only." Sigma must honour whichever licence/attribution terms attach to each ingested dataset (data.egov.bg is predominantly CC-BY → attribution).
- **BG transposition (corrected).** Re-use chapter of **ЗДОИ (Глава трета "а", чл. 41а+)**, the operative transposition being the amendment **ДВ бр. 82/2023, in force 29.09.2023**, plus the **Наредба за стандартните условия за повторно използване…** (the 2016 Наредба is the implementing reg, not itself the 2019-directive transposition). Bulgaria transposed late (CJEU referral 15 Feb 2023, IP/23/706).
- **Penalties.** No EU fines on re-users; enforcement runs against Member States / public holders.
- **What Sigma must do.** Honour each upstream **licence + attribution** condition; keep an attribution/source registry; and treat any personal data in those datasets as a **separate GDPR question**, not licensed by the open-data terms.

Sources: https://eur-lex.europa.eu/eli/dir/2019/1024/oj/eng · https://eur-lex.europa.eu/eli/reg_impl/2023/138/oj/eng · https://lex.bg/laws/ldoc/2134929408 · https://data.egov.bg/document · https://ec.europa.eu/commission/presscorner/detail/en/ip_23_706

### 10. AMLD5 / ЗМИП — source of the owner data *(P2, context for #1/#2)*

- **Provenance only.** ЗМИП created the регистър на действителните собственици; entities declare UBOs into the Търговски регистър / register of non-profit legal entities / БУЛСТАТ. For Sigma (a re-user, not an obliged entity), AMLD5/ЗМИП is the **origin** of owner names — it grants **no independent right to republish** them. Post-Sovim, the AMLD5 "public access" limb is invalid, so Sigma cannot cite it as a lawful basis; republication still needs a standalone GDPR basis + proportionality analysis. Whether Sigma is itself an "obliged entity" is unlikely but should be confirmed against its actual activities.

Sources: https://lex.bg/en/laws/ldoc/2137182924 · https://www.openownership.org/en/map/country/bulgaria/

### 11. 2024 AML package — legitimate-interest access *(P3, forward-looking design benchmark)*

- **Reg. (EU) 2024/1624 (AMLR) + Dir. (EU) 2024/1640 (AMLD6)** re-base register access on a **demonstrable legitimate-interest** test (aligning with Sovim), not blanket public access. **Applies from 10 July 2027** (AMLD6 transposition deadline 10 July 2027, expected via further ЗМИП amendments). Not yet binding on Sigma, but it defines the **proportionality benchmark** against which Sigma's re-use of owner data will be judged. **Design now to the "legitimate interest" standard.**

Sources: https://eur-lex.europa.eu/eli/reg/2024/1624/oj/eng · https://www.hoganlovells.com/en/publications/changes-in-beneficial-ownership-rules-under-the-new-eu-antimoney-laundering-regulation-eu-20241624

### 12–16. Not applicable / structural (summary)

- **eIDAS / eIDAS 2.0 (Reg. 910/2014; Reg. (EU) 2024/1183).** Bite **only** if Sigma performs electronic identification/authentication or provides/relies on trust services. A **read-only, no-login** Sigma triggers neither. Relying-party registration under Art. 5b is **opt-in** (only if Sigma chooses to accept the EUDI Wallet). *Correction:* under Art. 5f, wallet acceptance is **mandatory** for public-sector bodies that require eID for an online public service — so if a PUB Sigma ever adds a login-gated service, acceptance + registration could become an obligation. BG instrument: **ЗЕДЕУУ**; supervisor **КРС/CRC**. The wallet-availability deadline (~end-2026) runs from the implementing acts' entry into force (24.12.2024 → ~24.12.2026), not from the regulation's 20.05.2024 entry into force.
- **Single Digital Gateway (Reg. (EU) 2018/1724).** Binds Member States / competent authorities. A private transparency portal is **out of scope** unless it is an official government service (then it also pulls in the 2016/2102 accessibility cross-reference).
- **eForms (Impl. Reg. (EU) 2019/1780) + ЗОП.** Bind **contracting authorities** and the АОП/ЦАИС ЕОП publication chain — **not** a re-user. Relevance is **structural**: eForms (mandatory on TED from 25 Oct 2023; БГ e-образци mandatory-only from 1 Mar 2025) define the schema of the procurement data Sigma ingests, complementary to **OCDS**.
- **Cyber Resilience Act (Reg. (EU) 2024/2847).** Targets *products with digital elements* placed on the market. Sigma is a **hosted/bespoke operated service**, not a product — **not directly applicable** (would only matter if Sigma distributed standalone software).
- **ЗЕУ e-gov baseline / ДХЧО / .government.bg.** Bind only **административни органи / лица с публични функции / организации, предоставящи обществени услуги**. A private NGO republisher is **outside** ЗЕУ. If Sigma is adopted as an official state system, expect RegiX integration, МЕУ registration, the единен модел, and likely **migration off Cloudflare onto the ДХЧО under a .government.bg domain**.

---

## Direct ties to the code review

### (a) The WCAG-relevant UI issues now have a legal hook

The code review flagged accessibility defects — **keyboard focus, touch-target sizes, mobile overflow**. These are precisely the kind of failures that breach **WCAG 2.1 AA / EN 301 549** (e.g. focus visibility → SC 2.4.7; keyboard operability → SC 2.1.1; target size → 2.5.x; reflow / mobile overflow → SC 1.4.10). The legal consequence depends on the operator:

- **If Sigma is PUB:** these are a **direct compliance gap** under **2016/2102 / ЗЕУ чл. 58в–58г**. Sigma must remediate to EN 301 549 **and** publish a **декларация за достъпност** with a feedback mechanism — neither of which can exist honestly while the flagged defects remain. МЕУ can issue binding remediation instructions.
- **If Sigma is PRIV (and the portal is not an essential public service):** neither 2016/2102 nor the EAA mandates accessibility today — but **WCAG 2.1 AA is the de-facto baseline either way**, and funding/procurement clauses or any move toward public-body status flips on the legal teeth. Fix the defects regardless; they are the correct engineering target and the cheapest path to being audit-ready.

### (b) Beneficial-owner PERSONAL-NAME exposure — the load-bearing risk

The schema stores and may publicly expose **действителни собственици** names. This is the single highest-priority legal exposure, and it is **independent of the PUB/PRIV fork** — GDPR/ЗЗЛД bind Sigma either way.

- **Sovim is the controlling authority.** The CJEU held that **unrestricted public access** to UBO data is a disproportionate breach of **Charter Arts 7 & 8**. Mirroring those same names to the **open web with no access control or proportionality assessment** reproduces exactly the interference the Court condemned. The mechanism that bites Sigma is **GDPR Art. 6(1)(f)** — Sovim makes the legitimate-interest balancing **much harder to win** for blanket publication.
- **AMLD5 "public access" is not cover.** That limb was struck down; Sigma cannot lean on "the register is public" as its lawful basis. PSI/open-data re-use rights are **expressly subordinate to data-protection law** and do **not** authorise republishing personal names.
- **Lawful-basis / minimisation questions to resolve:**
  1. **Is there a documented Art. 6(1)(f) LIA** (or Art. 6(1)(e) if PUB) specifically for publishing *names*, weighed against Arts 7 & 8 per Sovim?
  2. **Is full-name publication necessary**, or can Sigma minimise — e.g. publish the *legal entity* and ownership structure while **gating, partially masking, or omitting natural-person names**, or showing names only behind a **legitimate-interest gate**? (This is also the direction the 2024 AML package codifies for 2027.)
  3. **Is there a working Art. 21 objection / erasure path** for an owner who objects?
  4. **Has accuracy/recency been addressed** (republishing stale registry names)?
- **Resolution path:** run the **DPIA** (it is effectively mandatory here), and let it decide between (i) gating owner names behind a legitimate-interest mechanism, (ii) minimising/masking, or (iii) — if neither, and the LIA cannot be won — **not republishing the names at all**. Until that DPIA exists, open publication of owner names is the project's largest unmitigated legal risk.

---

## Compliance checklist / next actions

**P0 — data protection (do first; applies in every scenario)**
- [ ] **Run and document a DPIA** (GDPR Art. 35) covering UBO-name republication + the risk-score/profiling feature.
- [ ] **Resolve the owner-name publication decision** out of the DPIA: gate behind legitimate interest / minimise-mask / or omit — designed to the Sovim proportionality standard and the 2027 AML "legitimate interest" benchmark.
- [ ] **Write the Art. 6(1)(f) LIA** (or Art. 6(1)(e) public-task if PUB), explicitly weighed against Charter Arts 7 & 8.
- [ ] **Publish an Arts 13–14 privacy notice** naming the registry sources (Art. 14 source disclosure).
- [ ] **Build data-subject-rights workflows** — especially **Art. 21 objection** and erasure for named individuals.
- [ ] **Confirm DPO need** (likely, given large-scale systematic processing) and create Art. 30 records of processing.

**P0/P1 — accessibility**
- [ ] **Remediate the flagged WCAG defects** (keyboard focus, touch targets, mobile overflow) to **WCAG 2.1 AA / EN 301 549 v3.2.1**.
- [ ] **Publish an accessibility statement (декларация за достъпност)** + feedback mechanism + complaint link — **mandatory if PUB**; recommended regardless.

**P1 — security & cookies**
- [ ] **Audit the cookie/analytics footprint**; if any non-essential cookies, deploy a **GDPR-grade opt-in consent banner** (no pre-tick, real reject) + cookie policy.
- [ ] **Stand up a security baseline** (ISO/IEC 27001-aligned: access control, logging, backups, vuln management, MFA, incident response) — **mandatory + registration with МЕУ + 24h/72h/1-month incident reporting if PUB (NIS2 essential entity)**; best practice if PRIV.

**P2 — disclosures, licensing, scoping**
- [ ] **Determine Sigma's operator status** (public-sector body / body governed by public law / essential public service vs private/NGO) — this resolves regimes #3, #7, #9, #16. Record the determination.
- [ ] **Publish an impressum (ЗЕТ чл. 4)** — operator identity + contact e-mail/address.
- [ ] **Map and honour upstream open-data licence/attribution conditions** (CC-BY etc.); maintain a source/attribution registry; treat personal data as a separate GDPR question, not licensed by open-data terms.
- [ ] **Confirm Sigma is not itself an AML "obliged entity"** under ЗМИП.

**P3 — forward-looking / conditional**
- [ ] **Design UBO-data re-use to the 2024 AML "legitimate interest" model** (AMLR/AMLD6, from 10 Jul 2027).
- [ ] **If a login/authenticated feature is ever added:** reassess eIDAS / eIDAS 2.0 (relying-party registration; mandatory EUDI-Wallet acceptance if PUB).
- [ ] **If Sigma is adopted as an official state system:** plan for ЗЕУ baseline (RegiX, МЕУ registration, единен модел) and likely **migration onto the ДХЧО under .government.bg**.

**Honest uncertainties:** (1) Sigma's operator status is the master variable and is not settled in the inputs — several "applies?" answers flip on it. (2) Exact BG fine amounts under ЗЕУ accessibility provisions and the EAA transposition were not confirmed in sources. (3) The updated NIS2 Наредба timing (~Oct 2026) and several NIS2 figures come from secondary guidance — verify against the consolidated ДВ бр. 17/2026 text. (4) Whether the ЗЕТ imprint duty legally binds Sigma depends on the "economic activity" test — publish the impressum anyway (cheap).
