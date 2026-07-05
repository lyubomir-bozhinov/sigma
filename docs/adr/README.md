# Architecture Decision Records

Short, immutable records of decisions with lasting architectural or correctness impact — the *why*, not the *how* (the how lives in `docs/spec/` and the code).

## Convention

- One file per decision: `NNNN-kebab-title.md`, zero-padded sequential number.
- Status: `Proposed` → `Accepted` → (`Superseded by NNNN` | `Deprecated`). Never edit an accepted decision's substance; supersede it with a new ADR and link both ways.
- Keep it tight: Context (the forces), Decision (what we chose), Consequences (what follows, good and bad). Link the spec/code it governs.

## Index

- [0001](0001-report-dedup-settled-periods-only.md) — Report dedup (Lane F) applies only to explicitly-resolved, settled periods.
