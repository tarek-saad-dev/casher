/** POS-consumable server boundary for Clinic encounter billing.
 * Caller must supply the session's tenant and active branch; no browser IDs are trusted. */
export { linkClinicSaleWithinTransaction } from '../internal/clinicBillingRepository';
export { ClinicBillingConflict, parseClinicEncounterId } from '../application/clinicBillingPolicy';
export type { ClinicBillingItem } from '../application/clinicBillingPolicy';
