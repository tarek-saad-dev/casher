# Phase 1O — User Access

**Source:** GLEEM active access → Camp Caesar via `applyApprovedBranchConfigurationTemplate` domain `user_branch_access`.

## Apply result

| Metric | Value |
|---|---|
| Before (CC) | 1 |
| After (CC) | **9** |
| Created | **8** |
| Updated | **1** |

## Mapped users (active on CC)

| UserID | UserName | CanOperate | CanViewReports | CanSwitch |
|---|---|---|---|---|
| 10 | admin | yes | yes | yes |
| 13 | Tarek | yes | yes | yes |
| 15 | Hoda | yes | yes | yes |
| 16 | OMAR | yes | yes | yes |
| 17 | mr.ziad | yes | no | no |
| 18 | أ / علي الزيني | yes | no | no |
| 19 | أ / محمد حمدي | yes | no | no |
| 20 | mohamed | yes | no | no |
| 21 | mariam | yes | no | no |

## Switcher

Camp Caesar remains **SETUP** with **IsActive=0** → hidden from production branch switcher. Access rows exist for when INTERNAL_LIVE is approved; they do not expose the branch while inactive.

## Policy

User/permission mapping from GLEEM **RESOLVED**. Passwords and user identities were not invented or copied as new accounts — existing `TblUser` rows only.
