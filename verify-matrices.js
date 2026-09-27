// Проверяет, что матрицы РАБОТАЮТ, а не просто присутствуют в DOM.
// Ключевое: браузер запускается БЕЗ emulateMediaFeatures, то есть с той
// настройкой, что реально стоит в Windows. Именно на этой машине
// «Эффекты анимации» выключены, и матрицы из-за этого не работали —
// любая проверка с эмуляцией no-preference давала бы ложный «зелёный».
const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8931;
const HOST = '127.0.0.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };

const srv = http.createServer((q, s) => {
  const f = path.join(__dirname, q.url === '/' ? 'index.html'
    : decodeURIComponent(q.url.split('?')[0]));
  fs.stat(f, (e, st) => {
    if (e) { s.writeHead(404).end(); return; }
    s.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()]
      || 'application/octet-stream', 'Content-Length': st.size });
    fs.createReadStream(f).pipe(s);
  });
});

(async () => {
  await new Promise(r => srv.listen(PORT, HOST, r));
  const b = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const errors = [];
  // Ширины от телефона до ультраширокой. 360 — самый узкий реальный случай.
  const WIDTHS = [360, 414, 600, 768, 900, 1024, 1280, 1500, 1920, 2560];
  let bad = 0;

  // Проверяем в обоих режимах. У пользователя в Windows выключены
  // «Эффекты анимации», то есть браузер шлёт prefers-reduced-motion: reduce.
  // Матрицы обязаны работать и при нём тоже, поэтому no-preference —
  // это дополнительный контрольный прогон, а не единственный.
  //
  // ВАЖНО: гоняем ВСЕ пять языковых страниц, а не только index.html.
  // Раньше проверка смотрела только на русскую, из-за чего поломка
  // в любой другой версии осталась незамеченной — а именно это и
  // произошло с английской и корейской.
  const PAGES = [
    ['ru', 'index.html'], ['en', 'index-en.html'], ['zh', 'index-zh.html'],
    ['ko', 'index-kr.html'], ['ja', 'index-jp.html'],
  ];

  for (const motion of ['no-preference', 'reduce']) {
  const p = await b.newPage();
  p.on('pageerror', e => errors.push(e.message));
  await p.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: motion },
  ]);
  console.log(`\n##### prefers-reduced-motion: ${motion} #####`);
  for (const [lang, file] of PAGES) {
  for (const w of WIDTHS) {
    await p.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
    await p.goto(`http://${HOST}:${PORT}/${file}`,
                 { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 1800));

    const s = await p.evaluate(async () => {
      const cv = document.getElementById('matrix-bg');
      const vm = document.getElementById('video-matrix-right');
      const ctx = cv.getContext('2d');

      // 1. Нарисованы ли пиксели дождя (слева)
      const d = ctx.getImageData(0, 0, Math.min(400, cv.width), cv.height).data;
      let painted = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] + d[i + 1] + d[i + 2] > 60) painted++;
      }

      // 2. Двигаются ли карточки (справа): снимаем Y через 1.2 с
      const posA = [...document.querySelectorAll('.matrix-video-card')]
        .map(c => Math.round(c.getBoundingClientRect().top));
      await new Promise(r => setTimeout(r, 1200));
      const posB = [...document.querySelectorAll('.matrix-video-card')]
        .map(c => Math.round(c.getBoundingClientRect().top));
      let moved = 0;
      for (let i = 0; i < Math.min(posA.length, posB.length); i++) {
        if (Math.abs(posA[i] - posB[i]) > 5) moved++;
      }

      // 3. Двигается ли дождь: счётчик кадров matrix.js
      const f1 = window.__rainState ? window.__rainState().frame : -1;
      await new Promise(r => setTimeout(r, 1000));
      const f2 = window.__rainState ? window.__rainState().frame : -1;

      return {
        reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
        canvasDisplay: getComputedStyle(cv).display,
        rightDisplay: getComputedStyle(vm).display,
        noSide: document.documentElement.classList
          .contains('no-side-matrix'),
        sideGapPx: parseFloat(getComputedStyle(document.documentElement)
          .getPropertyValue('--side-gap')) || 0,
        painted, cards: posA.length, moved, fps: f2 - f1,
      };
    });

    // Критерий: матрицы должны работать ВСЕГДА, где есть хоть какое-то поле.
    // ПорогInclusion повторяет решение matrix-layout.js: полосы включаются
    // от 8px свободного поля. Раньше здесь стояло 60px — после того, как
    // порог в самом layout.js опустили до 8px, проверка стала врождённой:
    // при поле в 50px матрицы работали, а тест говорил «сломано».
    const INCLUDE_ABOVE = 8;
    const hasRoom = s.sideGapPx >= INCLUDE_ABOVE;
    let ok;
    if (s.noSide) {
        // Поле есть, а полосы выключены — настоящая поломка.
        ok = !hasRoom;
    } else {
        ok = hasRoom && s.painted > 0 && s.cards > 0 && s.moved > 0
             && s.fps > 5 && s.canvasDisplay !== 'none'
             && s.rightDisplay !== 'none';
    }
    if (!ok) bad++;
    console.log(`${lang} ${w}px  reduce=${s.reduce}  gap=${s.sideGapPx}px  `
      + `canvas=${s.canvasDisplay} right=${s.rightDisplay}  `
      + `пикселей=${s.painted}  карточек=${s.cards} (движется ${s.moved})  `
      + `кадров/с=${s.fps}  ${ok ? 'OK' : 'НЕ РАБОТАЕТ'}`);
    if (s.noSide) {
      console.log(`        no-side-matrix: поля ${s.sideGapPx}px < 60px — `
                  + 'место для матриц действительно нет');
    }
    if (w === 1500 && (lang === 'en' || lang === 'ko')) {
      await p.screenshot({ path: `_v_${lang}_${motion.replace('-', '_')}.png` });
    }
  }
  console.log('');
  }
  await p.close();
  }

  if (errors.length) { console.log('\nОШИБКИ:'); errors.forEach(e => console.log('  ' + e)); }
  const total = WIDTHS.length * 2 * PAGES.length;
  console.log(`\nитог: ${total - bad} из ${total} работают`);
  await b.close();
  srv.close();
  process.exit(bad === 0 && errors.length === 0 ? 0 : 1);
})();
