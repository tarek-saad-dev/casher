import { NextRequest, NextResponse } from 'next/server';
import { getAvailableBarbers } from '@/lib/barberAvailability';

export const runtime = 'nodejs';

/**
 * GET /api/barbers/available?date=YYYY-MM-DD&time=HH:mm
 * Returns all active barbers with their availability status at the requested datetime.
 * Falls back to current time if not supplied.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date');
    const timeParam = searchParams.get('time');

    let dt: Date;
    if (dateParam) {
      const timePart = timeParam ?? new Date().toTimeString().slice(0, 5);
      dt = new Date(`${dateParam}T${timePart}:00`);
    } else {
      dt = new Date();
    }

    if (isNaN(dt.getTime())) {
      return NextResponse.json({ error: 'تاريخ أو وقت غير صالح' }, { status: 400 });
    }

    const barbers = await getAvailableBarbers(dt);
    return NextResponse.json({ barbers });
  } catch (err) {
    console.error('[barbers/available]', err);
    return NextResponse.json({ error: 'فشل تحميل الحلاقين المتاحين' }, { status: 500 });
  }
}
