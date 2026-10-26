/** Cross-application integration boundary: Clinics -> Shared POS billing.
 * Platform owns wiring only. Clinic owns medical metadata and its billing link;
 * POS owns invoice, transaction, payment and treasury state.
 */
export { linkClinicSaleWithinTransaction } from '@/apps/medical-records/public/billing';
export type { ClinicBillingItem } from '@/apps/medical-records/public/billing';
