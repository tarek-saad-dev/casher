# Phase 1E — Partner Share Schema

**Migration:** `db/migrations/add-branch-partner-shares.sql`  
**Table:** `dbo.TblBranchPartnerShare`

## Columns

BranchPartnerShareID (PK), BranchID (FK), PartnerUserID (nullable, no FK), PartnerCode, PartnerName, SharePercent DECIMAL(9,6), EffectiveFrom, EffectiveTo, IsActive, audit columns, Notes.

## Constraints

* SharePercent ∈ (0, 100]
* EffectiveTo ≥ EffectiveFrom when set
* Unique (BranchID, PartnerCode, EffectiveFrom)
* Index on (BranchID, IsActive, EffectiveFrom, EffectiveTo)

Overlap and 100% sum enforced in `partnerShares` service + verifier (SQL cannot express all interval rules).

## Service

`getEffectiveBranchPartnerShares`, `validateBranchPartnerShares`, create/update/end period helpers. Missing config → `PartnerShareConfigError` (no production hardcoded fallback).
