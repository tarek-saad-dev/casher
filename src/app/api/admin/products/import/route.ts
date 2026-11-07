import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, isAuthResult } from '@/lib/api-auth';
import {
  commitSupplierCatalogImport,
  previewSupplierCatalogImport,
  SUPPLIER_CATALOG_REFERENCE,
  type ImportPreviewRow,
} from '@/lib/inventory/productCatalog.service';
import { InventoryDomainError } from '@/lib/inventory/inventoryMutation.service';

export const runtime = 'nodejs';

/**
 * GET — returns the built-in 19-SKU supplier reference (no DB mutation).
 * POST body: { mode: 'preview'|'commit', rows?, useReference?, updateExisting? }
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  return NextResponse.json({
    reference: SUPPLIER_CATALOG_REFERENCE,
    note: 'لا يُنفَّذ الاستيراد تلقائياً ضد الإنتاج — يتطلب تأكيد مدير عبر mode=commit',
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await req.json();
    const mode = String(body.mode || 'preview');
    const useReference = Boolean(body.useReference);
    const updateExisting = Boolean(body.updateExisting);

    const rows = useReference
      ? SUPPLIER_CATALOG_REFERENCE.map((r) => ({
          code: r.code,
          nameAr: r.code,
          consumerPrice: r.consumerPrice,
          netSupplierCost: r.netSupplierCost,
          unit: r.unit,
        }))
      : (body.rows || []) as Array<{
          code: string;
          nameAr?: string;
          consumerPrice?: number;
          netSupplierCost?: number;
          unit?: string;
        }>;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'لا توجد صفوف للاستيراد' }, { status: 400 });
    }

    const preview = await previewSupplierCatalogImport({
      tenantId: auth.tenantId,
      rows,
    });

    if (mode !== 'commit') {
      return NextResponse.json({
        preview,
        summary: {
          new: preview.filter((r) => r.status === 'new').length,
          existing: preview.filter((r) => r.status === 'existing').length,
          invalid: preview.filter((r) => r.status === 'invalid').length,
          duplicate: preview.filter((r) => r.status === 'duplicate').length,
        },
      });
    }

    // Prefer client-confirmed preview rows when provided (after admin review).
    const confirmed = (body.confirmedRows as ImportPreviewRow[] | undefined) || preview;
    const result = await commitSupplierCatalogImport({
      tenantId: auth.tenantId,
      rows: confirmed,
      updateExisting,
    });

    return NextResponse.json({ ok: true, ...result, preview: confirmed });
  } catch (err: unknown) {
    if (err instanceof InventoryDomainError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
