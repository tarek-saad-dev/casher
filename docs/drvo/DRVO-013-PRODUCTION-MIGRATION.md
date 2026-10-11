# DRVO-013 production migration control

This PR exists only to run the guarded production migration workflow for the already-merged
additive migration `public-self-service-signup`.

- Migration id: 13
- Migration key: `public-self-service-signup`
- Risk: LOW
- Change: additive `dbo.PublicSignupRegistration` control-plane table and indexes
- No CUT business data is modified
- Application deploy remains blocked until the migration ledger is current

Close this PR after the migration control APPLY succeeds and production deploy/verify passes.
