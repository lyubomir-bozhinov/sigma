# Architecture Decision Records — Свързани лица (related-persons / conflict-of-interest)

ADRs capture the *why* behind non-obvious, hard-to-reverse decisions for the свързани-лица data
foundation. One decision per file, Nygard format (Context → Decision → Consequences). Superseding
happens by writing a new ADR that references the old one; old ADRs stay for the audit trail.

Numbering is sequential. Add a new ADR the moment a decision is made — not retroactively.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-scope-and-certainty-bar.md) | Scope & certainty bar (public data, deterministic auto-publish) | Accepted |
| [0002](0002-deterministic-name-to-eik-resolution.md) | Deterministic name→ЕИК via own bidder data + conservative normalizer | Accepted |
| [0003](0003-name-uniqueness-guard-and-publish-tiers.md) | Name-uniqueness is not absolute → single-ЕИК guard + publish tiers | Accepted |
| [0004](0004-pii-posture.md) | PII posture (raw in scratch only; third-party/family internal; EGN stripped) | Accepted |
| [0005](0005-host-scoped-tls-pinning.md) | Host-scoped TLS SPKI pinning for register.cacbg.bg | Accepted |
| [0006](0006-crawler-and-persistence-architecture.md) | Crawler + persistence (raw cache → extract; R2 + D1; cron refresh) | Accepted |
| [0007](0007-two-declaration-templates.md) | Two declaration templates — shares + participation + management + related persons | Accepted |
| [0008](0008-match-output-layers-and-interpretation.md) | Match output layers (own vs control, temporal, own-institution) + interpretation caveats | Accepted |
| [0009](0009-tr-name-uniqueness-census.md) | TR name-uniqueness census — promotes globally-unique tier-C matches | Accepted |
| [0010](0010-free-text-entity-resolution.md) | Free-text entity resolution — declared ЕИК + prose company extraction | Accepted |
| [0011](0011-name-collision-tier-gate.md) | Name-collision tier gate — a non-unique name can't be name-distinctive, even with a certain ЕИК | Accepted |
| [0012](0012-folder-discovery-and-republication-dedup.md) | Discover declaration-set folders from the register index; dedup republications by ControlHash | Accepted |
| [0013](0013-private-interest-vs-ex-officio-classification.md) | Separate private financial interest from ex-officio public-board roles (multi-declarant tell) | Accepted |
| [0014](0014-conflict-explorer-surface-posture.md) | Conflict-explorer surface — interest_links-only read model, noindex-until-gated, provenance on every row | Accepted |
| [0015](0015-methodology-page-and-temporal-freshness.md) | Public methodology/corrections page (E10) + temporal dating & divestment expiry (E11) | Accepted |
| [0016](0016-public-surface-private-ownership-only.md) | Public surface shows ONLY declared private ownership (removes the ex-officio list; term „длъжностно лице") | Accepted |

Related design docs: [spec/related-persons-foundation.md](../spec/related-persons-foundation.md),
[implementation-plans/phase0-related-persons-feasibility.md](../implementation-plans/phase0-related-persons-feasibility.md).
