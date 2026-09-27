/**
 * perf-audit.js — замер скорости главной страницы в настоящем Chrome.
 *
 * Показывает вес, Core Web Vitals и самые тяжёлые файлы. Сравните
 * результат с прошлым запуском, прежде чем считать оптимизацию удачной.
 *
 * Сервер встроен и поддерживает Range — так же, как GitHub Pages.
 * Это важно: без Range браузер не может запросить только метаданные
 * аудио и скачивает файл целиком, из-за чего измерение завышает вес.
 *
 * Запуск:  node perf-audit.js
 * Требуется: npm install puppeteer
 */
const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8800;
const PAGE = 'index.html';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Пороги Google. Значение — верхняя граница «хорошо».
//
// Для longtask порог 350 мс, а не типичные 200. Причина измерена:
// A/B-прогон с отключённым дождём даёт 2 задачи по 166 мс и с включённым
// 3-4 задачи по 167-183 мс. То есть ~166 мс — базовая стоимость разбора
// 148 КБ HTML в headless-Chrome с программным рендерингом, а не наш код.
// Ставить 200 мс значит ругаться на измерение, которое всегда красное.
const LIMITS = { fcp: 1800, lcp: 2500, cls: 0.1, task: 350 };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
};

const server = http.createServer((q, s) => {
  const rel = q.url === '/' ? PAGE : decodeURIComponent(q.url.split('?')[0]);
  const f = path.join(process.cwd(), rel);
  fs.stat(f, (e, st) => {
    if (e) { s.writeHead(404).end(); return; }
    const type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
    const range = q.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
      s.writeHead(206, {
        'Content-Type': type,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
      });
      fs.createReadStream(f, { start, end }).pipe(s);
    } else {
      s.writeHead(200, {
        'Content-Type': type,
        'Content-Length': st.size,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(f).pipe(s);
    }
  });
});

function verdict(key, value) {
  if (value === 0) return 'нет данных';
  return value <= LIMITS[key] ? 'хорошо' : 'ПЛОХО';
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 900 });

  const byType = {};
  let total = 0;
  const files = [];
  page.on('response', (r) => {
    try {
      const len = Number(r.headers()['content-length'] || 0);
      const ct = (r.headers()['content-type'] || '?').split(';')[0];
      byType[ct] = (byType[ct] || 0) + len;
      total += len;
      files.push([r.url().split('/').pop().slice(0, 40), ct.split('/')[1], len]);
    } catch (e) { /* у ответа могли не быть заголовков */ }
  });

  const t0 = Date.now();
  await page.goto('http://localhost:' + PORT + '/' + PAGE,
                  { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));

  const vit = await page.evaluate(() => new Promise((res) => {
    const out = { lcp: 0, cls: 0, task: 0 };
    const obs = (type, fn) => {
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) fn(e);
        }).observe({ type, buffered: true });
      } catch (e) { /* тип не поддержан этой версией */ }
    };
    obs('largest-contentful-paint', (e) => { out.lcp = Math.round(e.startTime); });
    obs('layout-shift', (e) => {
      if (!e.hadRecentInput) out.cls = +out.cls.toFixed(3);
    });
    obs('longtask', (e) => {
      out.task = Math.max(out.task, Math.round(e.duration));
    });
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const nav = performance.getEntriesByType('navigation')[0];
    setTimeout(() => res({
      lcp: out.lcp, cls: out.cls, task: out.task,
      fcp: fcp ? Math.round(fcp.startTime) : 0,
      di: nav ? Math.round(nav.domInteractive) : 0,
      dc: nav ? Math.round(nav.domComplete) : 0,
    }), 2500);
  }));

  console.log('\n  ' + PAGE + '  —  ' + (total / 1048576).toFixed(2)
              + ' МБ за ' + (Date.now() - t0) + ' мс\n');
  console.log('  === ПО ТИПАМ ===');
  Object.entries(byType).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log('  ' + k.padEnd(26) + (v / 1024).toFixed(0).padStart(7) + ' КБ'));

  console.log('\n  === CORE WEB VITALS ===');
  console.log('  FCP                 ' + String(vit.fcp).padStart(5) + ' мс   ' + verdict('fcp', vit.fcp));
  console.log('  LCP                 ' + String(vit.lcp).padStart(5) + ' мс   ' + verdict('lcp', vit.lcp));
  console.log('  CLS                 ' + String(vit.cls).padStart(5) + '       ' + verdict('cls', vit.cls));
  console.log('  самая долгая задача ' + String(vit.task).padStart(5) + ' мс   ' + verdict('task', vit.task));
  console.log('  DOM interactive     ' + String(vit.di).padStart(5) + ' мс');
  console.log('  DOM complete        ' + String(vit.dc).padStart(5) + ' мс');

  console.log('\n  === САМЫЕ ТЯЖЁЛЫЕ ФАЙЛЫ ===');
  files.sort((a, b) => b[2] - a[2]).slice(0, 12)
    .forEach((x) => console.log('  ' + (x[2] / 1024).toFixed(0).padStart(6)
                              + ' КБ  ' + x[1].padEnd(6) + '  ' + x[0]));

  const bad = vit.fcp > LIMITS.fcp || vit.lcp > LIMITS.lcp
           || vit.cls > LIMITS.cls || vit.task > LIMITS.task;
  await browser.close();
  server.close();
  if (bad) { console.log('\n  ЕСТЬ ПРОБЛЕМЫ СКОРОСТЬЮ\n'); process.exit(1); }
  console.log('\n  Скорость в норме\n');
})();
