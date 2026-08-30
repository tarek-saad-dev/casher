const urls = [
  'https://cutsaloon.com',
  'https://cutsaloon.com/',
  'https://cutsaloon.com/book',
  'https://booking.cutsaloon.com',
  'https://cutsaloon.com/pricing',
  'https://cutsaloon.com/groom-packages',
  'https://cutsaloon.com/locations',
  'https://cutsaloon.com/camp',
  'https://cutsaloon.com/gleem',
];

async function dump(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const text = await res.text();
    const hrefs = [...text.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
    const srcs = [...text.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) => m[0]);
    const interesting = [...new Set([...hrefs, ...srcs])].filter((u) =>
      /maps|instagram|facebook|tiktok|whatsapp|wa\.me|book|groom|offer|camp|gleem|50/i.test(u),
    );
    const has50 = /50\s*%|خصم|عرض|first visit|أول زيارة/i.test(text);
    const hasGroom = /1250|1650|2100|Essential|Signature|Complete|باقات العريس/i.test(text);
    console.log(JSON.stringify({ url, status: res.status, final: res.url, len: text.length, has50, hasGroom, interesting: interesting.slice(0, 40) }, null, 2));
  } catch (e) {
    console.log(JSON.stringify({ url, error: String(e) }));
  }
}

(async () => {
  for (const u of urls) await dump(u);
})();
