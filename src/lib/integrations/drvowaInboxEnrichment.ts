import 'server-only';

import { getPool, sql } from '@/lib/db';
import type { DrvowaInboxListItem } from '@/lib/integrations/drvowaClient';

function digits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

function phoneKey(value: string | null | undefined): string {
  const d = digits(value);
  return d.length > 10 ? d.slice(-10) : d;
}

export type EnrichedDrvowaInboxItem = DrvowaInboxListItem & {
  erpClientId: number | null;
  erpCustomerName: string | null;
  erpPhone: string | null;
};

export async function enrichDrvowaInboxContacts(
  items: DrvowaInboxListItem[],
): Promise<EnrichedDrvowaInboxItem[]> {
  if (items.length === 0) return [];

  const keys = [...new Set(items.map((item) => phoneKey(item.phone)).filter(Boolean))];
  if (keys.length === 0) {
    return items.map((item) => ({
      ...item,
      erpClientId: null,
      erpCustomerName: null,
      erpPhone: null,
    }));
  }

  const request = (await getPool()).request();
  const placeholders = keys.map((key, index) => {
    request.input(`p${index}`, sql.NVarChar(16), key);
    return `@p${index}`;
  });

  const result = await request.query<{
    ClientID: number;
    Name: string | null;
    Mobile: string | null;
  }>(`
    SELECT TOP (2000)
      ClientID,
      [Name],
      Mobile
    FROM dbo.TblClient
    WHERE RIGHT(
      REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        ISNULL(Mobile, N''),
        N'+', N''
      ), N' ', N''), N'-', N''), N'(', N''), N')', N''),
      10
    ) IN (${placeholders.join(',')})
    ORDER BY ClientID DESC;
  `);

  const byPhone = new Map<string, { clientId: number; name: string | null; mobile: string | null }>();
  for (const row of result.recordset) {
    const key = phoneKey(row.Mobile);
    if (!key || byPhone.has(key)) continue;
    byPhone.set(key, {
      clientId: Number(row.ClientID),
      name: row.Name?.trim() || null,
      mobile: row.Mobile?.trim() || null,
    });
  }

  return items.map((item) => {
    const match = byPhone.get(phoneKey(item.phone));
    return {
      ...item,
      displayName: match?.name || item.displayName,
      erpClientId: match?.clientId ?? null,
      erpCustomerName: match?.name ?? null,
      erpPhone: match?.mobile ?? null,
    };
  });
}
