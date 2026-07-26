# Phase 1L — Target Contract

**Date:** 2026-07-25

## Keys

* Plan: EmpID + BranchID + EffectiveFrom  
* Daily result: EmpID + BranchID + WorkDate  
* Recalc request: EmpID + BranchID + WorkDate  

## Rules

* Revenue from invoices where `TblinvServHead.BranchID = @branchId`  
* Missing plan → no entitlement for that branch  
* No GLEEM plan fallback  
* Admin CRUD uses session branch; body BranchID rejected  
* Recalc inherits invoice header BranchID  
* Target ledger BranchID = daily target BranchID  

## Status

| Piece | Status |
|---|---|
| Sales filter | Done |
| Generate / result / recalc BranchID | Done |
| Plan admin INSERT/list BranchID | Done |
| Nightly per-branch generate | Done |
