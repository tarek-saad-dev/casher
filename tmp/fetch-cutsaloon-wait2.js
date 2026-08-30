(async () => {
  const home = await (await fetch('https://cutsaloon.com/')).text();
  const needles = ['minute', 'wait', 'وصول', 'ميعاد', 'دقيقة', 'انتظار', 'بعد الوصول', '1-10', '1–10'];
  for (const n of needles) {
    const i = home.indexOf(n);
    console.log(n, i >= 0 ? home.slice(Math.max(0, i - 80), i + 120).replace(/\s+/g, ' ') : 'NO');
  }
  const prices = await (await fetch('https://cutsaloon.com/prices')).text();
  for (const n of ['ESSENTIAL', 'COMPLETE', 'Essential', '1,250', '2,100', 'GROOM']) {
    const i = prices.indexOf(n);
    console.log('p', n, i >= 0 ? prices.slice(i, i + 180).replace(/\s+/g, ' ') : 'NO');
  }
})();
