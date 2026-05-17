import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function escapeXml(text: string): string {
  return text
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const text: string = body.text ?? '';
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'النص مطلوب' }, { status: 400 });
    }
    if (text.length > 300) {
      return NextResponse.json({ error: 'النص طويل جداً (الحد 300 حرف)' }, { status: 400 });
    }

    const key    = process.env.AZURE_SPEECH_KEY;
    const region = process.env.AZURE_SPEECH_REGION;
    if (!key || key === 'PUT_THE_AZURE_KEY_HERE') {
      console.error('[queue voice] AZURE_SPEECH_KEY not configured');
      return NextResponse.json({ error: 'مفتاح Azure Speech غير مُعيَّن في الخادم' }, { status: 503 });
    }
    if (!region) {
      console.error('[queue voice] AZURE_SPEECH_REGION not configured');
      return NextResponse.json({ error: 'منطقة Azure Speech غير مُعيَّنة في الخادم' }, { status: 503 });
    }

    const voiceName = body.voiceName ?? process.env.QUEUE_VOICE_NAME   ?? 'ar-EG-SalmaNeural';
    const locale    = body.locale    ?? process.env.QUEUE_VOICE_LOCALE  ?? 'ar-EG';
    const rate      = body.rate      ?? process.env.QUEUE_VOICE_RATE    ?? '-5%';
    const pitch     = body.pitch     ?? process.env.QUEUE_VOICE_PITCH   ?? '0%';

    console.log('[queue voice] request received');
    console.log('[queue voice] text length:', text.length);
    console.log('[queue voice] region:', region);
    console.log('[queue voice] voiceName:', voiceName);

    const ssml = `<speak version="1.0" xml:lang="${locale}"><voice name="${voiceName}"><prosody rate="${rate}" pitch="${pitch}">${escapeXml(text)}</prosody></voice></speak>`;

    const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

    const azureRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type':              'application/ssml+xml',
        'X-Microsoft-OutputFormat':  'audio-16khz-32kbitrate-mono-mp3',
        'User-Agent':                'CutSalonPOS',
      },
      body: ssml,
    });

    console.log('[queue voice] Azure status:', azureRes.status);

    if (!azureRes.ok) {
      const errText = await azureRes.text().catch(() => '');
      console.error('[queue voice] Azure error body:', errText);
      return NextResponse.json(
        { error: 'تعذر تشغيل النداء الصوتي الاحترافي' },
        { status: azureRes.status >= 500 ? 502 : azureRes.status },
      );
    }

    const audioBuffer = await azureRes.arrayBuffer();

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type':  'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[queue voice] unexpected error:', err);
    return NextResponse.json({ error: 'خطأ داخلي في الخادم' }, { status: 500 });
  }
}
