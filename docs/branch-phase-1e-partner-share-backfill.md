# Phase 1E — Partner Share Backfill

**Branch:** GLEEM  
**EffectiveFrom:** `2026-06-01` (matches `PARTNERS_REPORT_MIN_*`)

| PartnerCode | PartnerName | SharePercent |
|---|---|---:|
| ZIYAD | زياد | 36.666667 |
| MHAMDY | محمد حمدي | 31.666667 |
| ALIZAINY | علي الزيني | 31.666666 |

Sum = 100.000000 (DECIMAL).

Source: previous hardcoded `PARTNERS` in `monthly-report.ts` (now deprecated; not used in production report paths).

**Employee overrides JSON** remains filesystem-backed and is applied **only for GLEEM**. Moving overrides to SQL is deferred.
