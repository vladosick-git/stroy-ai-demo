// node tools/shot.js  ->  screens/*.png 1920x1280 для Кворка (1440x960 css @4/3) + мобильные 1170x2532
const puppeteer = require('C:/Users/1/Documents/drop-miniapp/tools/node_modules/puppeteer-core');
const path = require('path'), fs = require('fs');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = path.resolve(__dirname, '..');
const url = (q, h) => 'file:///' + path.join(ROOT, 'index.html').split(path.sep).join('/') + q + (h || '');
const desk = [
  ['01 - Сервис и AI-конвейер', '?shot=1', ''],
  ['02 - Смета с проверкой ИИ', '?shot=1&to=result&off=90', '#result'],
  ['03 - Промт и ответ модели', '?shot=1&step=review&tab=answer', '#trace'],
  ['04 - Админка, расход API', '?shot=1', '#admin'],
  ['05 - Промты и подключения', '?shot=1&to=ptabs&off=150', '#admin']
];
const mob = [
  ['m1 - главная', '?shot=1', ''],
  ['m2 - смета', '?shot=1&to=tbl&off=150', '#result'],
  ['m3 - как работает ИИ', '?shot=1&step=parse&tab=prompt', '#trace']
];
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--hide-scrollbars', '--allow-file-access-from-files'] });
  const page = await browser.newPage();
  const out = path.join(ROOT, 'screens'); fs.mkdirSync(out, { recursive: true });
  const shoot = async (name, q, h, vp) => {
    await page.setViewport(vp);
    await page.goto(url(q, h), { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({ path: path.join(out, name + '.png') });
    console.log('saved', name);
  };
  for (const [n, q, h] of desk) await shoot(n, q, h, { width: 1440, height: 960, deviceScaleFactor: 4 / 3 });
  for (const [n, q, h] of mob) await shoot(n, q, h, { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await browser.close();
})();
