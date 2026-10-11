import { NextResponse } from 'next/server';
import { listPublicIndustryPacks } from '@/packs';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(
    {
      industries: listPublicIndustryPacks(),
      needs: [
        { code: 'booking', label: 'الحجوزات والمواعيد' },
        { code: 'pos', label: 'الكاشير والتحصيل' },
        { code: 'workforce', label: 'الفريق والحضور' },
        { code: 'payroll', label: 'المرتبات' },
        { code: 'treasury', label: 'الخزنة' },
        { code: 'reports', label: 'التقارير' },
        { code: 'inventory', label: 'المخزون والمشتريات' },
      ],
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      },
    },
  );
}
