import 'server-only';
import type { ConnectionPool } from 'mssql';
import { sql } from '@/lib/db';
import { ReferralCheckoutError } from './referralCheckoutPolicy';
import { roundMoney } from '@/lib/reportMonthUtils';

type CheckoutLine = { proId: number; sPrice: number; qty: number; bonus: number };
type CatalogRow = {
  ProID: number;
  SPrice1: number | null;
  Bonus: number | null;
  isDeleted: number | boolean | null;
};

/**
 * The existing POS accepts caller prices for manually adjusted items. Referral
 * money MUST NOT trust those prices: the offer is only available at the current
 * tenant catalog price (not package/retail overrides/custom quotations).
 *
 * This check is **before** the transaction; changes to catalog prices between
 * checking and invoice commit must be handled by the final atomic-sale rollout
 * staging gate. For now the checkout switch is OFF by default.
 */
export async function assertReferralCheckoutCatalogPrices(
  db: ConnectionPool,
  tenantId: string,
  lines: CheckoutLine[],
): Promise<void> {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100 ||
      lines.some((line) =>
        !Number.isSafeInteger(line.proId) || line.proId <= 0 || line.proId > 2_147_483_647 ||
        !Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 100 ||
        !Number.isFinite(line.sPrice) || line.sPrice <= 0 ||
        !Number.isFinite(line.bonus) || line.bonus < 0 ||
        roundMoney(line.sPrice) !== line.sPrice ||
        roundMoney(line.bonus) !== line.bonus
      )) {
    throw new ReferralCheckoutError('REFERRAL_INVALID_ITEMS', 'عرض الإحالة متاح للخدمات المسعّرة في الكتالوج فقط', 400);
  }
  const ids = [...new Set(lines.map((line) => line.proId))];
  const request = db.request().input('tenantId', sql.UniqueIdentifier, tenantId);
  const bind = ids.map((id, i) => {
    request.input('proId' + i, sql.Int, id);
    return '@proId' + i;
  });
  const found = await request.query(`
    SELECT ProID, SPrice1, Bonus, isDeleted
    FROM dbo.TblPro
    WHERE TenantId = @tenantId AND ProID IN (${bind.join(',')});
  `);
  const prices = new Map(
    (found.recordset as CatalogRow[]).map((r) => [Number(r.ProID), r]),
  );
  for (const line of lines) {
    const p = prices.get(line.proId);
    if (!p || Number(p.isDeleted) === 1 ||
        !Number.isFinite(Number(p.SPrice1)) || Number(p.SPrice1) <= 0 ||
        roundMoney(Number(p.SPrice1)) !== roundMoney(line.sPrice) ||
        roundMoney(Number(p.Bonus ?? 0)) !== roundMoney(line.bonus)) {
      throw new ReferralCheckoutError(
        'REFERRAL_DISCOUNT_CONFLICT',
        'سعر الخدمة اتغير أو الخدمة غير مؤهلة لخصم الإحالة؛ حدّث الفاتورة قبل الفحص',
        409,
      );
    }
  }
}
