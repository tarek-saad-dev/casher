# Registration & onboarding V2 (#348)

## Implemented
- Five signup stages: industry, apps, business/contact details, account security, review. Desktop split layout and mobile stacked layout; labelled progress, keyboard focus, reduced-motion aware transitions.
- Normalizes Egyptian phone formatting in the browser, including Arabic digits; validates email and password confirmation, prevents duplicate client submissions. Password and confirmation stay in component memory; only the original password goes to the existing signup endpoint, and both clear after success.
- Onboarding shows compact mobile progress and next incomplete step, less clutter, copy-login action, explicit save-and-continue for the branch, retry for failed form loading. Actual setup writes and access controls remain unchanged.
- No claim of verified phone or isolated training data. Demo data still belongs to the new account. Existing trial and industry routing unchanged.
- Presentation regressions live in existing publicSignup.test.ts so both Smart CI and nightly CI continue to exercise them.

## Explicitly deferred
- Platform-owner OTP: CUT CLUB uses a dedicated tenant and provider purpose. Design a separate signup purpose and provider configuration, rate limits, expiry, one-time server-side verification proof consumed before provisioning, and guarded staging verification. Do not use CUT CLUB identity or its credentials for public signup.
- Persistent unsaved draft/autosave across reload: not implemented. Explicit authenticated saves are still persisted; do not persist password/confirmation locally.
- No browser smoke or production DB access performed. Test on staging with separate salon and supermarket accounts, mobile and desktop, failed and retried signup, incorrect password confirmation, branch save-and-next, service/team saves, skip and resume, and original CUT isolation before merge.
