-- ============================================================
-- DEPRECATED — do not run ad-hoc.
-- Official schema path: DRVO migration `employee-late-deduction`
--   db/drvo-migrations/020-employee-late-deduction/schema.sql
--   scripts/drvo/migrations/020-employee-late-deduction.ts
-- Apply only via: npm run drvo:migrate (staging) or Production Migration Control.
-- ============================================================

RAISERROR(
  N'Deprecated: use DRVO migration employee-late-deduction (020). Do not run this file.',
  16,
  1
);
GO
