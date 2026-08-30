async function dump(url) {
  const res = await fetch(url);
  const text = await res.text();
  const links = [...text.matchAll(/<a[^>]+href="([^"]+)"[^>]*>[\s\S]{0,200}/gi)]
    .map((m) => ({ href: m[1], ctx: m[0].replace(/\s+/g, ' ').slice(0, 280) }))
    .filter((x) => /maps|share\.google|instagram|facebook|tiktok|wa\.me/i.test(x.href + x.ctx));
  console.log('LINKS', url, JSON.stringify(links, null, 2));

  const prices = [...text.matchAll(/(\d[\d,]*)\s*ج\.?م/g)].map((m) => m[0]);
  console.log('PRICES', [...new Set(prices)]);

  for (const label of ['GROOM ESSENTIAL', 'GROOM SIGNATURE', 'GROOM COMPLETE', 'Hair Detail', 'Relax', 'Pedicure', 'Protein', '1,500', '1,750', '2,000', '1–10', '1-10', 'دقيقة']) {
    const i = text.indexOf(label);
    if (i >= 0) console.log(label, text.slice(i, i + 220).replace(/\s+/g, ' '));
  }

  const phones = [...text.matchAll(/0[0-9][\d\s]{7,}/g)].map((m) => m[0].trim());
  console.log('PHONES', [...new Set(phones)].slice(0, 10));
}

dump('https://cutsaloon.com/').then(() => dump('https://cutsaloon.com/prices'));
