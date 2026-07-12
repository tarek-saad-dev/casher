# DB Probe — Remaining Issues — 2026-07

Generated: 2026-07-12T01:50:27.267Z
Mode: READ-ONLY SELECT

## Flags
```
EMP_LEDGER_DUAL_WRITE_ENABLED=true
EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH=true
FINANCIAL_REPORT_CLASSIFICATION_ENABLED=true
```

## Ledger credits
- hourly_wage: count=66 total=14,707.93
- monthly_salary: count=2 total=9,000.00

## Ledger debits
- advance: count=102 total=31,854.00
- payout: count=1 total=200.00

## Monthly salary
```json
{
  "entryCount": 2,
  "totalAmount": 9000,
  "withCashMove": 0,
  "empCount": 2
}
```
Duplicates: 0
Missing eligible: 0
Inactive with credit: 0

## Advances / Payouts
```json
{
  "advances": {
    "advances": 102,
    "missingCashMove": 0,
    "total": 31854
  },
  "payouts": {
    "payouts": 1,
    "missingCashMove": 0,
    "total": 200
  }
}
```

## Employee DQ
```json
{
  "activeMissingEmploymentType": 0,
  "activeMissingPayrollMethod": 0,
  "monthlyNoBaseSalary": 0,
  "hourlyNoRate": 0,
  "dailyNoRate": 0,
  "freelanceMonthlyViolations": 0,
  "inactivePayrollEnabled": 5,
  "totalEmployees": 29
}
```

## Categories
```json
{
  "activeRevenueMaps": 20,
  "activeAdvanceMaps": 19,
  "activeMapsMissingTxnKind": 0,
  "payoutCategoryExists": 1,
  "fundingCategoryExists": 0
}
```

## Duplicate active refs
Count groups: 0

## Non-positive amounts
Count: 0
