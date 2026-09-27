/* Проверяет, что матрицы работают на всех пяти языковых страницах
   и на трёх ширинах, при реальной настройке Windows (reduce).
   Это дополнение к verify-matrices.js, который гоняет только index.html. */
const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
};
const PAGES = ['index.html', 'index-en.html', 'index-zh.html',
               'index-kr.html', 'index-jp.html'];
const WIDTHS = [360, 768, 1500];

const srv = http.createServer((q, s) => {
    const f = path.join(__dirname, q.url === '/' ? 'index.html' : q.url.split('?')[0]);
    fs.readFile(f, (e, d) => {
        if (e) { s.writeHead(404); s.end(); return; }
        s.writeHead(200, {
            'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
        });
        s.end(d);
    });
});

(async () => {
    await new Promise(r => srv.listen(8879, '127.0.0.1', r));
    const b = await puppeteer.launch({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: 'new',
        args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    });
    let bad = 0;
    for (const pg of PAGES) {
        for (const w of WIDTHS) {
            const p = await b.newPage();
            const errs = [];
            p.on('pageerror', e => errs.push(e.message));
            await p.setViewport({ width: w, height: 900 });
            await p.emulateMediaFeatures([
                { name: 'prefers-reduced-motion', value: 'reduce' },
            ]);
            await p.goto('http://127.0.0.1:8879/' + pg, { waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 2000));
            const s = await p.evaluate(() => {
                const cv = document.getElementById('matrix-bg');
                const vm = document.getElementById('video-matrix-right');
                return {
                    cd: getComputedStyle(cv).display,
                    vd: getComputedStyle(vm).display,
                    cards: document.querySelectorAll('.matrix-video-card').length,
                    gap: Math.round(parseFloat(getComputedStyle(document.documentElement)
                        .getPropertyValue('--side-gap')) || 0),
                };
            });
            const ok = s.cd !== 'none' && s.vd !== 'none' && s.cards > 0
                && s.gap >= 8 && errs.length === 0;
            if (!ok) bad++;
            console.log(
                (ok ? 'OK  ' : 'FAIL') + '  ' + pg.padEnd(15)
                + String(w).padStart(5) + 'px  поле=' + String(s.gap).padStart(4)
                + '  canvas=' + s.cd.padEnd(6) + ' поток=' + s.vd.padEnd(6)
                + ' карточек=' + String(s.cards).padStart(2)
                + (errs.length ? '  ОШИБКА: ' + errs[0] : ''));
            await p.close();
        }
    }
    await b.close();
    srv.close();
    console.log('\nпроблем: ' + bad);
    process.exit(bad ? 1 : 0);
})();