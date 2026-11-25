import { NextResponse } from 'next/server';
import { enforceSignupOtpRate, sendSignupOtp, signupOtpRequired, SignupOtpError } from '@/platform/publicSignup/otp';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
export async function POST(req: Request) {
  if (!signupOtpRequired()) return NextResponse.json({ code: 'OTP_DISABLED' }, { status: 404, headers });
  if (req.headers.get('sec-fetch-site') === 'cross-site' || !req.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json({ code: 'BODY_INVALID' }, { status: 400, headers });
  try {
    enforceSignupOtpRate(req, 'send');
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => k !== 'phone'))
      return NextResponse.json({ code: 'BODY_INVALID' }, { status: 400, headers });
    return NextResponse.json({ ok: true, ...await sendSignupOtp(body.phone) }, { headers });
  } catch (err) {
    if (err instanceof SignupOtpError)
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.status, headers });
    return NextResponse.json({ code: 'OTP_UNAVAILABLE', error: 'تعذر إرسال رمز التحقق.' }, { status: 503, headers });
  }
}
