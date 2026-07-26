# Phase 1N — Camp Caesar Operational Audit

Database: `cloud / last132` · BranchID=3 · `CAMP_CAESAR` · Lifecycle after 1N-B: `SETUP`

| Domain | Current CC config | Smoke req | Internal live | Public live | Blocker/warning | Tech defect? | Business missing? | Fix applied | Final |
|---|---|---|---|---|---|---|---|---|---|
| Identity | Name/code/tz set | yes | yes | yes | pass | no | EN name not a column | Store AR in BranchName | PASS |
| Address/phone | null | no | yes | yes | biz.address blocker | no | YES | none invented | OPEN |
| Access | actor UserID=10 | yes | manager+cashier | yes | smoke.operator | no | real roles | grantActorAccess | smoke PASS |
| Employees | smoke only then deactivated | smoke assign | real staff | yes | biz.real_employees | no | YES | [SMOKE CC] emps | smoke PASS |
| Payroll plans | smoke hourly/monthly | yes | yes | yes | proof + biz | no | real amounts | seeded for smoke | smoke PASS |
| Targets | smoke plan 10% | positive | yes | yes | proof | no | real tiers | insertPlanWithTiers | smoke PASS |
| Services/prices | [SMOKE CC] Haircut 150 | yes | yes | yes | smoke.service_* | no | real prices OPEN | created | smoke PASS |
| Payment methods | global PM 1/2 | yes | policy | yes | smoke.payment_method | no | branch PM policy OPEN | reuse global | smoke PASS |
| Treasury | CashMove BranchID | yes | opening cash | yes | biz.opening_cash | prior CashMove substitute | YES | real invoice+trigger | smoke PASS |
| Inventory | TblBranchInventory | adj+consume | opening qty | yes | biz.opening_inventory | adj TypeError / ProType | YES qty | tx+tracked pro | smoke PASS |
| Booking/queue | disabled container | yes | ops | public off until PUBLIC_LIVE | smoke.queue | no | hours OPEN | BookingEnabled=0 | PASS |
| Printing | none | policy | policy | yes | biz.printer_policy | no | YES | disabled policy OPEN | OPEN |
| WhatsApp | forced off | off | policy | identity | biz.whatsapp_policy | no | YES | env false | sends=0 |
| Partner shares | none | warn | policy | yes | biz.partner_shares | no | YES | none | OPEN |
| Public frontend | not deployed | n/a | n/a | blocker | public.frontend_multi_branch | no | deploy | blocker status | NO-GO public |
| Smoke framework | allowlist CC+PH1GTEST | yes | passed run | — | proofs | PH1GTEST-only | — | generalized | PASS |
| GLEEM isolation | PUBLIC_LIVE | baseline | proven | — | gleem.isolation | — | — | fingerprints | PASS |

Root inventory failure (1M): wrong product / ProType length / pool mismatch. Fixed by stock-tracked Pro + `getPool` transaction + `ProType=NULL` on detail (nvarchar(2)).
