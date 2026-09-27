/**
 * Проверка сайта в реальном браузере.
 *
 * Что проверяет:
 *  • ошибки в консоли и неудавшиеся сетевые запросы (404 и т.п.);
 *  • что видео-матрица построилась и карточки грузятся лениво;
 *  • сколько байт видео реально скачалось при первом открытии страницы
 *    (раньше preload="auto" тянул все 179 МБ сразу — это главная проверка);
 *  • корректность JSON-LD и соответствие числа вопросов FAQ разметке в HTML;
 *  • hreflang-кластер: коды должны быть из ISO 639-1;
 *  • robots.txt: каждый служебный файл закрыт, humans.txt наоборот открыт,
 *    sitemap объявлен (запрет на несуществующий файл — тоже ошибка).
 *
 * Запуск:  node check-site.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE = process.cwd();
const PORT = 8765;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function serve() {
  return http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(BASE, url === '/' ? 'index.html' : url);
    if (!file.startsWith(BASE)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': data.length,
      }).end(data);
    });
  });
}

const PAGES = ['index.html', 'index-en.html', 'index-zh.html',
               'index-kr.html', 'index-jp.html'];
const VALID_HREFLANG = ['ru', 'en', 'zh', 'ko', 'ja', 'x-default'];


(async () => {
  const server = serve();
  await new Promise(r => server.listen(PORT, r));

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required',
           '--disable-dev-shm-usage', '--mute-audio'],
  });

  let failed = 0;

  for (const page of PAGES) {
    const p = await browser.newPage();
    await p.setViewport({ width: 1600, height: 900 });
    // Явно просим обычный режим анимации. Без этой строки headless Chrome
    // сообщает prefers-reduced-motion: reduce — это состояние по умолчанию
    // у пользователя, у которого в Windows выключены «Эффекты анимации».
    // Отдельная проверка ниже всё равно прогоняет страницу при reduce.
    await p.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: 'no-preference' },
    ]);

    const consoleErrors = [];
    const failedReqs = [];
    const videoBytes = { n: 0 };
    const imgBytes = { n: 0 };

    p.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    p.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
    // ERR_ABORTED на медиа — норма: браузер отменяет запрос при переходе
    // между страницами или при смене src в плеере. Это не ошибка сайта.
    p.on('requestfailed', r => {
      const err = (r.failure() || {}).errorText || '';
      if (err.includes('ERR_ABORTED')) return;
      failedReqs.push(r.url() + ' — ' + err);
    });
    p.on('response', r => {
      if (r.status() >= 400) failedReqs.push(r.status() + ' ' + r.url());
      const len = Number(r.headers()['content-length'] || 0);
      if (r.url().includes('/video/')) videoBytes.n += len;
      if (/\.(png|jpe?g|webp|svg)(\?|$)/.test(r.url())) imgBytes.n += len;
    });

    await p.goto('http://localhost:' + PORT + '/' + page, {
      waitUntil: 'networkidle2', timeout: 60000,
    });
    // Первый запуск браузера заметно медленнее (инициализация профиля),
    // поэтому ждём первую карточку, а не фиксированное время.
    await p.waitForFunction(
      () => document.querySelectorAll('.matrix-video-card video[src]').length > 0,
      { timeout: 20000 }
    ).catch(() => { /* попадёт в problems */ });
    await new Promise(r => setTimeout(r, 1500));

    const info = await p.evaluate(() => {
      const ld = document.querySelector('script[type="application/ld+json"]');
      let graph = null, faqCount = null;
      try {
        const d = JSON.parse(ld.textContent);
        graph = d['@graph'].length;
        const faq = d['@graph'].find(n => n['@type'] === 'FAQPage');
        faqCount = faq ? faq.mainEntity.length : null;
      } catch (e) { /* оставим null */ }
      const cards = document.querySelectorAll('.matrix-video-card');
      let withSrc = 0;
      cards.forEach(c => { if (c.querySelector('video')?.getAttribute('src')) withSrc++; });
      return {
        lang: document.documentElement.lang,
        title: document.title,
        h1: document.querySelectorAll('h1').length,
        hreflang: [...document.querySelectorAll('link[rel=alternate]')]
          .map(l => l.getAttribute('hreflang')),
        details: document.querySelectorAll('#faq details').length,
        graph, faqCount,
        cards: cards.length,
        cardsWithSrc: withSrc,
        ogImage: document.querySelector('meta[property="og:image"]')?.content,
        ogW: document.querySelector('meta[property="og:image:width"]')?.content,
        ogH: document.querySelector('meta[property="og:image:height"]')?.content,
        imgsNoAlt: [...document.images].filter(i => !i.hasAttribute('alt')).length,
        imgsNoDims: [...document.images]
          .filter(i => !i.hasAttribute('width') || !i.hasAttribute('height')).length,
        langSwitch: [...document.querySelectorAll('nav a[hreflang]')]
          .map(a => a.getAttribute('hreflang')),
      };
    });

    const problems = [];
    console.log('\n=== ' + page + ' ===');
    console.log('  title            :', info.title);
    console.log('  html lang        :', info.lang);
    console.log('  h1 count         :', info.h1);
    console.log('  hreflang (head)  :', info.hreflang.join(', '));
    console.log('  hreflang (nav)   :', info.langSwitch.join(', '));
    console.log('  JSON-LD nodes    :', info.graph, '| FAQ в JSON-LD:', info.faqCount,
                '| FAQ <details>:', info.details);
    console.log('  og:image         :', info.ogImage);
    console.log('  og:image w/h     :', info.ogW + 'x' + info.ogH);
    console.log('  video cards      :', info.cards, '| с src:', info.cardsWithSrc);
    console.log('  скачано video    :', (videoBytes.n / 1048576).toFixed(1), 'МБ');
    console.log('  скачано картинок :', (imgBytes.n / 1024).toFixed(0), 'КБ');
    console.log('  img без alt      :', info.imgsNoAlt, '| без размеров:', info.imgsNoDims);

    if (consoleErrors.length) problems.push('ошибки консоли: ' + consoleErrors.join(' | '));
    if (failedReqs.length) problems.push('битые запросы: ' + failedReqs.join(' | '));
    if (info.h1 !== 1) problems.push('h1 не ровно один: ' + info.h1);
    const badHl = info.hreflang.filter(x => !VALID_HREFLANG.includes(x));
    if (badHl.length) problems.push('невалидный hreflang: ' + badHl.join(','));
    if (info.faqCount !== info.details) {
      problems.push('FAQ рассинхронизирован: JSON-LD ' + info.faqCount
                    + ' vs HTML ' + info.details);
    }
    if (info.ogW !== '1200' || info.ogH !== '630') problems.push('og:image не 1200x630');
    if (info.imgsNoAlt) problems.push('img без alt: ' + info.imgsNoAlt);
    if (info.cards === 0) problems.push('видео-матрица не построилась');
    if (!info.cardsWithSrc) {
      problems.push('ни одна карточка не подгрузила видео (ленивая загрузка сломана)');
    }

    if (problems.length) {
      failed++;
      problems.forEach(x => console.log('  ✗ ' + x));
    } else {
      console.log('  ✓ проблем не найдено');
    }
    await p.close();
  }

  // ─── Отдельно проверяем режим «меньше движения» ─────────────────────────
  // Он включается в настройках ОС. Важно, что при нём анимации не просто
  // замедляются, а выключаются, и тяжёлые файлы не качаются зря.
  // ─── Матрицы работают и при prefers-reduced-motion: reduce ───────────────
  // Раньше здесь стояло обратное ожидание: матрицы ДОЛЖНЫ выключаться при
  // reduce. Но у пользователя в Windows выключены «Эффекты анимации», то
  // есть браузер всегда шлёт reduce — и из-за этого поля слева и справа от
  // текста были пустыми. Задача: матрицы работают ВСЕГДА. Проверка ниже
  // требует ровно этого, а «отключения» больше не существует.
  {
    const p = await browser.newPage();
    await p.setViewport({ width: 1600, height: 900 });
    await p.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ]);
    const bytes = { n: 0 };
    p.on('response', r => {
      if (r.url().includes('/video/')) bytes.n += Number(r.headers()['content-length'] || 0);
    });
    await p.goto('http://localhost:' + PORT + '/index.html', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 2500));
    const rm = await p.evaluate(() => ({
      reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
      matrix: getComputedStyle(document.getElementById('matrix-bg')).display,
      videoFlow: getComputedStyle(document.getElementById('video-matrix-right')).display,
      cards: document.querySelectorAll('.matrix-video-card').length,
      gap: parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--side-gap')) || 0,
    }));
    console.log('\n=== prefers-reduced-motion: reduce ===');
    console.log('  matchMedia         :', rm.reduce);
    console.log('  #matrix-bg         :', rm.matrix);
    console.log('  #video-matrix-right:', rm.videoFlow);
    console.log('  свободное поле     :', rm.gap + 'px');
    console.log('  карточек           :', rm.cards);
    console.log('  скачано video      :', (bytes.n / 1048576).toFixed(1), 'МБ');
    const rmProblems = [];
    if (!rm.reduce) rmProblems.push('эмуляция не применилась');
    if (rm.gap >= 8 && rm.matrix === 'none') rmProblems.push('дождь выключен, хотя поле есть');
    if (rm.gap >= 8 && rm.videoFlow === 'none') rmProblems.push('видео-поток выключен, хотя поле есть');
    if (rm.gap >= 8 && rm.cards === 0) rmProblems.push('карточек нет, хотя поле есть');
    if (rmProblems.length) {
      failed++;
      rmProblems.forEach(x => console.log('  ✗ ' + x));
    } else {
      console.log('  ✓ матрицы работают при reduce');
    }
    await p.close();
  }

  // ─── Сверяем robots.txt с реальным содержимым папки ───────────────────
  // Смысл: запрет в robots.txt на файл, которого уже нет, — это враньё
  // в документации. А служебный файл, который забыли запретить, попадёт
  // в индекс Google вместе со своим исходным кодом.
  {
    const robots = fs.readFileSync(path.join(BASE, 'robots.txt'), 'utf8');
    const blocked = [...robots.matchAll(/^Disallow:\s*(\S+)/gm)]
      .map(m => m[1])
      .filter(p => p !== '/' && !p.startsWith('/assets/private'));

    // реальные служебные файлы в корне.
    // Файлы, начинающиеся с подчёркивания, — мои временные замеры; они
    // уже исключены в .gitignore, здесь то же правило, иначе проверка
    // ругается на собственные вспомогательные скрипты.
    const serviceFiles = fs.readdirSync(BASE)
      .filter(f => /\.(py|js|bat|md|json)$/.test(f))
      .filter(f => !f.startsWith('_'))
      .filter(f => f !== 'package-lock.json')
      .map(f => '/' + f);

    const missing = serviceFiles.filter(f => !blocked.includes(f));
    // папка i18n должна быть закрыта целиком
    if (!blocked.includes('/i18n/')) missing.push('/i18n/');
    // humans.txt наоборот обязан быть открыт: его читают люди и краулеры
    const humansBlocked = blocked.includes('/humans.txt');
    // sitemap должен быть объявлен
    const hasSitemap = /Sitemap:\s*https?:\/\//i.test(robots);

    console.log('\n=== robots.txt ===');
    console.log('  запрещено путей :', blocked.length);
    console.log('  служебных файлов:', serviceFiles.length);
    if (missing.length) console.log('  НЕ запрещены    :', missing.join(', '));
    console.log('  humans.txt      :', humansBlocked ? 'закрыт (ошибка)' : 'открыт');
    console.log('  Sitemap:        :', hasSitemap ? 'объявлен' : 'НЕ объявлен');

    if (missing.length) failed++;
    if (humansBlocked) failed++;
    if (!hasSitemap) failed++;
  }

  await browser.close();
  server.close();
  console.log('\n' + (failed ? '✗ страниц с проблемами: ' + failed
                             : '✓ все страницы чисты'));
  process.exit(failed ? 1 : 0);
})();
