import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { enforceSignupOtpRate, sendSignupOtp, verifySignupOtp, SignupOtpError } from '@/platform/publicSignup/otp';
import { enforceOperatorOtpRate, operatorOtpConfig, operatorOtpStatus } from '@/platform/publicSignup/otpOperator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers });

export async function GET() {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;
  return reply({ status: operatorOtpStatus() });
}

export async function POST(req: Request) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;
  const fetchSite = req.headers.get('sec-fetch-site');
  if ((fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') || !req.headers.get('content-type')?.startsWith('application/json'))
    return reply({ error: 'طلب غير صالح.' }, 415);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        typeof body.phone !== 'string' || body.phone.length > 32 ||
        !['send', 'verify'].includes(body.action)) return reply({ error: 'بيانات الاختبار غير صالحة.' }, 400);
    const action: 'send' | 'verify' = body.action;
    if (Object.keys(body).some(k => !(action === 'send' ? ['action','phone'] : ['action','phone','ticket','code']).includes(k)))
      return reply({ error: 'بيانات الاختبار غير صالحة.' }, 400);
    enforceOperatorOtpRate(auth.userId, action);
    enforceSignupOtpRate(req, action);
    const config = operatorOtpConfig();
    if (action === 'send') return reply({ ok: true, ...await sendSignupOtp(body.phone, config) });
    await verifySignupOtp(body.phone, { ticket: body.ticket, code: body.code }, config);
    return reply({ ok: true, verified: true });
  } catch (err) {
    if (err instanceof SignupOtpError) return reply({ code: err.code, error: err.message }, err.status);
    return reply({ error: 'تعذر إجراء اختبار التحقق.' }, 503);
  }
}
