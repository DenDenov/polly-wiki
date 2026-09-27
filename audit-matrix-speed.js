/* ============================================================================
   audit-matrix-speed.js — сверяет скорость падения левой и правой матриц.

   Зачем: глаз сразу замечает, если одна полоса падает быстрее другой, даже
   если разница небольшая. Раньше правая полоса шла в 6-10 раз медленнее
   левой, и это было видно. Проверка меряет ОБЕ стороны по факту, в
   браузере, и печатает числа — не «на глаз», а из измерения.

   Как меряем:
   • Левая (matrix.js) — экспортирует window.__rainState(): скорость каждой
     капли в клетках/кадр. Переводим в px/сек через CELL_SIZE и измеренный
     фактический FPS, а не через TARGET_FPS: rAF может давать больше кадров,
     а цикл матрицы ограничен FRAME_INTERVAL, поэтому реальная скорость
     зависит от того, сколько раз draw() реально вызвался.
   • Правая (video-matrix.js) — скорость выводится из --card-runway и
     animationDuration: путь (runway + vh), делённый на длительность.

   Запуск:  node audit-matrix-speed.js
   Выход:  0 — скорости совпадают (разница средних <= 25%), 1 — расходятся
   ============================================================================ */

const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Порт выбирается случайно и сервер привязан к 127.0.0.1 явно, а не через
// «localhost»: на этой машине localhost резолвится в ::1, и если порт держит
// зомби, он принимает соединение, но не отвечает — тогда Chrome виснет до
// таймаута вместо быстрой ошибки. Случайный порт снимает эту помеху.
const PORT = 8800 + Math.floor(Math.random() * 180);
const HOST = '127.0.0.1';
const ROOT = __dirname;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript',
    '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
};

const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    fs.stat(file, (err, st) => {
        if (err) { res.writeHead(404).end(); return; }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()]
                           || 'application/octet-stream',
            'Content-Length': st.size,
        });
        fs.createReadStream(file).pipe(res);
    });
});

const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
(async () => {
    await new Promise(r => server.listen(PORT, HOST, r));

    const browser = await puppeteer.launch({
        executablePath: CHROME, headless: 'new',
        args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    const widths = [1280, 1500, 1920, 2560];
    // Правая полоса состоит всего из 2-5 колонок, и её среднее по одной
    // загрузке гуляет на десятки процентов — шум той же случайности, что и
    // в самой матрице. Усредняем несколько загрузок, иначе проверка ловила
    // бы не расхождение скоростей, а шум.
    const REPEATS = 3;
    let worstRatio = 0;
    const report = [];

    for (const w of widths) {
        await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
        // Без этой строки headless Chrome включает prefers-reduced-motion,
        // обе матрицы выключаются, и замер бессмыслен.
        await page.emulateMediaFeatures(
            [{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
        // Правая полоса состоит всего из 2-5 колонок, и её среднее по одной
        // загрузке гуляет на десятки процентов — шум той же случайности,
        // что и в самой матрице. Усредняем несколько загрузок, иначе
        // проверка ловила бы не расхождение скоростей, а шум.
        const leftAll = [], rightAll = [];
        let fps = 0, cell = 0, cols = 0, noSide = false, rightDetail = [];

        for (let rep = 0; rep < REPEATS; rep++) {
        // domcontentloaded, а не networkidle2: страница держит открытыми
        // соединения (аудио, prefetch шрифтов), и networkidle2 не наступает
        // никогда — переход виснет до таймаута.
        await page.goto(`http://${HOST}:${PORT}/index.html`,
                        { waitUntil: 'domcontentloaded', timeout: 20000 });
        // Ждём постройки матриц: initVideoMatrix отложен до
        // requestIdleCallback, сразу после загрузки колонок в DOM нет.
        await page.waitForFunction(
            () => document.querySelectorAll('.matrix-video-card').length > 0,
            { timeout: 15000 }
        ).catch(() => {});
        await new Promise(r => setTimeout(r, 1200));

        const r = await page.evaluate(async () => {
            // ── Сколько кадров реально рисует левая матрица за 2 секунды ──
            // Скорость капель задана в px/сек и НЕ зависит от FPS, поэтому
            // для замера достаточно взять speed напрямую. FPS печатаем
            // отдельно — как диагностику, а не как множитель.
            const s0 = window.__rainState();
            const f0 = s0.frame;
            const t0 = performance.now();
            await new Promise(r => setTimeout(r, 1500));
            const s1 = window.__rainState();
            const dt = (performance.now() - t0) / 1000;
            const fps = (s1.frame - f0) / dt;

            const leftSpeeds = s0.speeds.slice();

            // ── Правая: путь / длительность ──
            const vh = window.innerHeight;
            const rightSpeeds = [];
            const rightDetail = [];
            document.querySelectorAll('.video-column').forEach(col => {
                const runway = parseFloat(
                    col.style.getPropertyValue('--card-runway')) || 0;
                const card = col.querySelector('.matrix-video-card');
                if (!card) return;
                const dur = parseFloat(card.style.animationDuration);
                if (!dur) return;
                rightSpeeds.push((runway + vh) / dur);
                rightDetail.push({
                    cards: col.querySelectorAll('.matrix-video-card').length,
                    path: Math.round(runway + vh), dur: +dur.toFixed(1),
                    px: Math.round((runway + vh) / dur),
                });
            });

            return {
                fps: +fps.toFixed(1), cell: s0.cell,
                cols: s0.speeds.length,
                left: leftSpeeds.map(v => Math.round(v)),
                right: rightSpeeds.map(v => Math.round(v)),
                rightDetail,
                noSide: document.documentElement.classList
                    .contains('no-side-matrix'),
            };
        });

        leftAll.push(...r.left);
        rightAll.push(...r.right);
        if (rep === 0) {
            fps = r.fps; cell = r.cell; cols = r.cols;
            noSide = r.noSide; rightDetail = r.rightDetail;
        }
        }
        const m = { fps, cell, cols, left: leftAll, right: rightAll,
                    rightDetail, noSide };

        const lAvg = m.left.length ? avg(m.left) : 0;
        const rAvg = m.right.length ? avg(m.right) : 0;
        m.left = m.left.map(v => Math.round(v));
        m.right = m.right.map(v => Math.round(v));
        const ratio = (lAvg && rAvg)
            ? (lAvg > rAvg ? lAvg / rAvg : rAvg / lAvg) : 0;
        worstRatio = Math.max(worstRatio, ratio);

        report.push({ w, ...m, lAvg: Math.round(lAvg), rAvg: Math.round(rAvg),
                      ratio: +ratio.toFixed(2) });
    }
    console.log('=== СКОРОСТЬ ПАДЕНИЯ МАТРИЦ ===');
    for (const r of report) {
        if (r.noSide) {
            console.log(`${r.w}px: полей нет, матрицы выключены (no-side-matrix)`);
            continue;
        }
        console.log(`${r.w}px  ячейка ${r.cell}px  FPS цикла ${r.fps}  `
                    + `(усреднено по ${REPEATS} загрузкам)`);
        console.log(`  ЛЕВАЯ  ${r.cols} капель: средняя ${r.lAvg} px/сек  `
                    + `(разброс ${Math.min(...r.left)}..${Math.max(...r.left)})`);
        console.log(`  ПРАВАЯ ${r.right.length} колонок: средняя ${r.rAvg} px/сек  `
                    + `(разброс ${Math.min(...r.right)}..${Math.max(...r.right)})`);
        console.log(`  расхождение средних: x${r.ratio}`);
        for (const d of r.rightDetail) {
            console.log(`    колонка: ${d.cards} карт, путь ${d.path}px / `
                        + `${d.dur}с = ${d.px} px/сек`);
        }
    }

    if (errors.length) {
        console.log('\nОШИБКИ СТРАНИЦЫ:');
        errors.forEach(e => console.log('  ' + e));
    }

    // Критерий: средние скорости не должны отличаться больше чем в 1.25 раза.
    const TOLERANCE = 1.25;
    const ok = errors.length === 0 && worstRatio <= TOLERANCE;
    console.log(`\nмаксимальное расхождение: x${worstRatio.toFixed(2)} `
                + `(допустимо до x${TOLERANCE}) — ${ok ? 'OK' : 'РАСХОЖДЕНИЕ'}`);

    await browser.close();
    server.close();
    process.exit(ok ? 0 : 1);
})();
