# DRVO Clinics — Encounter Workspace UX + Signed Prescription Print

## Goal
Turn the existing functional clinical workspace into the approved low-friction three-stage visit flow while preserving the **medical-records module** as the clinical source of truth and Shared Booking / Shared POS as owners of their own domains.

## Design implemented
- Patient header with clinician and clinical visit state; patient basics and prior encounter history stay in one contextual sidebar.
- Expanded patient medical profile collapses into an accessible `<details>` panel; hidden by default to reduce noise but still editable by the assigned clinician.
- Three in-page tabs: **01 الكشف**, **02 الروشتة**, **03 المتابعة**. Switching tabs preserves local unsaved field input because all tabs share existing React form state.
- Vitals, clinical exam, diagnosis, follow-up all use their existing API payloads. Sticky **حفظ المسودة** and staged **مراجعة وإنهاء → إكمال الزيارة** buttons.
- Summary on last tab reminds clinician to enter diagnosis and explains billing is through **Shared POS** (not done here).
- Prescription editor remains the existing create-draft API, add/remove medications, list and sign via existing human clinician-protected endpoint. Clinical notes are not implicitly saved by Rx creation.
- Signed-Rx-only printing: `print:hidden` on the operational screen and a separate `print:block` printable region listing **only signed prescriptions**, including patient, clinician, medicines, doses/duration/route/instructions, signed date. Unsigned draft prescriptions and all clinical history/notes are excluded. No new prescription data store or clinical backend.
- Avoid accidental data loss: block completion while a local (not submitted) medication name is still in the Rx editor; show message and return to Rx tab.
- Shows whether the clinical exam/profile/follow-up editor has locally changed since the last saved clinical state. No fake autosave or unsupported payment state.

## Scope boundaries
- No changes to Shared Booking/POS, no new schema, no new medical data APIs, no migration, no production deploy.
- Printing is **all signed prescriptions in that visit** via browser printing, not a PDF download or separate printer queue. Full print quality is a staging/browser QA item.
- UI uses existing doctor authorization and legacy signed-prescription flows. Do not weaken or bypass tenant/clinician protections while deferring the global fine-grained security project.
- Existing print button used to call `window.print()` for the whole clinical record. It now disables itself unless a signed Rx exists and the printable sheet excludes medical history and notes.

## Automated test changes
Existing `encounterWorkspace.test.tsx` updated for staged tabs and button labels and extended with:
- Follow-up local datetime → exact UTC instant on save.
- Cannot complete without diagnosis.
- Unsaved exam notes persist across Rx draft create/reload.
- Cannot complete with unsaved medication editor contents.
- No printing if Rx unsigned; signed print includes signed items only, excludes draft medicines and clinical notes.

## QA gate (not yet run)
```bash
npx vitest run src/apps/medical-records/__tests__/encounterWorkspace.test.tsx src/apps/medical-records/__tests__/encounterRoutes.test.ts src/apps/medical-records/__tests__/encounterPersistence.test.ts src/apps/medical-records/__tests__/clinicalSafety.test.ts
npm run build
```
Staging: Doctor begins Booking encounter → fills vitals/diagnosis → Rx draft → signs → verify print contains only signed meds → choose follow-up → complete. Repeat as unlinked or different clinician, completed encounter (read-only), no prescription, failed save and slow network. Check mobile 375px, desktop 1440px, and A4 print.
No agent merge into main, no production deployment, open as **Draft** stacked on Clinics MVP #90. Human QA/reviewer and parent PR clearance required.
