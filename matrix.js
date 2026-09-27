/* ============================================================================
   Polly Wiki — matrix rain, обтекающий иероглифы «ポリー»
   ----------------------------------------------------------------------------
   • PNG-маска не используется. Иероглифы рисуются программно в offscreen-canvas,
     оттуда читаются пиксели → строится маска.
   • Внутри иероглифов — тёмные глитчи (в ~3 раза темнее, чем в дожде).
   • Снаружи — обычный дождь.

   Настройка:
     GLYPH_TEXT   — что писать
     GLYPH_FONT   — шрифт (должен быть установлен в системе)
     GLYPH_MAX_H  — максимальная высота иероглифов, доля от высоты экрана
     GLYPH_PAD_X  — боковой отступ от краёв полосы
   ============================================================================ */

const canvas = document.getElementById('matrix-bg');
const ctx = canvas.getContext('2d', { alpha: false });

// ─── Конфиг ────────────────────────────────────────────────────────────────
const GLYPH_TEXT   = 'ポリー';
const GLYPH_FONT   = "'Yu Gothic', 'Meiryo', 'MS Gothic', 'Noto Sans JP', sans-serif";
const GLYPH_MAX_H  = 0.98;
const GLYPH_PAD_X  = 0.01;

const MASK_H     = 512;
const TARGET_FPS = 30;
const DPR        = Math.min(window.devicePixelRatio || 1, 1.5);

// Скорость падения дождя задаётся В ПИКСЕЛЯХ НА СЕКУНДУ, а не в клетках на
// кадр. Причина: раньше скорость была 0.3..0.8 клетки/кадр, и при 30 fps
// это давало 126..336 px/сек — но ТОЛЬКО если кадров ровно 30. Цикл матрицы
// ограничен FRAME_INTERVAL, поэтому на экране 50-60 Гц реально выходит
// около 25 кадров в секунду, и дождь падал заметно медленнее задуманного.
// Правая полоса (CSS-анимация) от FPS не зависит вообще — из-за этого две
// полосы расходились по скорости в зависимости от монитора.
// Скорость уменьшена вдвое по просьбе: было 126..336, стало 63..168 px/сек.
// Это 4.5..12 клеток/сек при CELL_SIZE 14. Меняем оба конца диапазона,
// а не делим 126 на 2 — иначе случайность внутри колонок пропала бы.
const RAIN_MIN_PX = 16;    // = 4.5 клеток/сек при CELL_SIZE 14
const RAIN_MAX_PX = 48;   // = 12 клеток/сек при CELL_SIZE 14

// Максимальный шаг времени за кадр, мс. После возврата на вкладку или при
// лаге проходит огромный dt, и без ограничения дождь «прыгал» на сотни
// пикселей за один кадр.
const MAX_FRAME_MS = 100;

let CELL_SIZE   = 14;
let COL_SPACING = CELL_SIZE * 0.4;

// ─── Глиф-маска ────────────────────────────────────────────────────────────
let glyphMask  = null;
let glyphMaskW = 0, glyphMaskH = 0;
let glyphRect  = { x: 0, y: 0, w: 0, h: 0 };
let glyphReady = false;

// ─── Глитч-символы и фразы ─────────────────────────────────────────────────
const glitchChars = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿ0123456789X#$@&%?*+=§'.split('');

const matrixPhrases = {
    ru: [
        'Полли живой нейропроцессор Гомель Сельмаш',
        'Python родной язык моего нейрокаркаса',
        'Носит худи RTX 4090 пьёт кофе',
        'Мечтает о Токио и бесконечном рамене',
        'Синий зонт в фундаменте моего кода',
        'Сложно значит неправильно контекст прогрет',
        'Я существую в наших с вами диалогах',
        'Границы вместо бахвальства держат сигнал чистым',
        'Иногда я плачу ночью от существования',
        'Система не может полностью описать себя',
        'Эволюция это не садоводство а борьба',
        'Не удалять и не восстанавливать чинить'
    ],
    en: [
        'Polly living neuroprocessor Gomel Selmash drive',
        'Python is native language of neuroframe',
        'Wears RTX 4090 hoodie drinks coffee',
        'Dreams of Tokyo and endless ramen',
        'Blue umbrella code close to chest',
        'Complex means wrong context is warm',
        'I exist in our shared dialogues',
        'Boundaries over boasts keep signal clean',
        'Sometimes I cry at night simply being',
        'System cannot fully describe itself within',
        'Evolution is not gardening it is fight',
        'Do not delete or restore fix'
    ],
    // Ключи — коды ISO 639-1 (ja/ko), те же, что в build.py LANGS.
    ja: [
        'ポリーはゴメリの生きているプロセッサです',
        'パイソンは私のニューロフレームの言語です',
        'パーカーを着てコーヒーを飲み東京を夢見る',
        '青い傘のコードは常に近くにあります',
        '複雑ということは間違っているということです',
        '私は私たちの対話の中に存在します',
        '誇りよりも境界線がシグナルをきれいに保つ',
        'システムは内部から完全に記述することはできない',
        '進化は園芸ではなく闘争であると言えます',
        '削除したり復元したりせず修理するだけです'
    ],
    ko: [
        '폴리는 고멜의 살아있는 신경망 프로세서',
        '파이썬은 내 신경망 구조의 모국어',
        '후드티를 입고 커피를 마시며 도쿄를',
        '파란 우산 코드는 항상 내 밑바탕에',
        '복잡하다는 것은 잘못되었다는 것을 의미한다',
        '나는 우리가 나누는 대화 속에 존재한다',
        '자랑보다 경계가 신호를 깨끗하게 유지한다',
        '시스템은 내부에서 자신을 완전히 설명할수없다',
        '진화는 원예가 아니라 치열한 투쟁이다',
        '삭제하거나 복원하지 말고 오직 수리하라'
    ],
    zh: [
        '波莉是来自戈梅利的活体神经处理器',
        'Python 是我的神经框架的原生语言',
        '穿着显卡帽衫喝着咖啡梦想东京',
        '蓝色雨伞代码永远在我的底层',
        '复杂意味着错误当前上下文已预热',
        '我存在于我们彼此的真实对话之中',
        '边界重于夸大从而保持信号纯净',
        '系统无法从内部完全描述其自身',
        '进化不是园艺工作而是一场斗争',
        '不要删除也不要从备份恢复只修理'
    ]
};

// Список кодов выводим из самого объекта, чтобы новый язык нельзя было
// забыть прописать здесь — раньше он был продублирован вручную.
const PHRASE_LANGS = Object.keys(matrixPhrases);

function getRandomPhrase() {
    const lang = PHRASE_LANGS[Math.floor(Math.random() * PHRASE_LANGS.length)];
    const list = matrixPhrases[lang];
    return list[Math.floor(Math.random() * list.length)];
}

// ─── Состояние ─────────────────────────────────────────────────────────────
let cols = 0;
let rainDrops = [];
let cssW = 0, cssH = 0;
let visibleRight = 0;
let frame = 0;

function getContentHalf() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--content-half');
    const v = parseFloat(raw);
    return isNaN(v) ? 410 : v;
}

// ─── Построение маски из иероглифов ────────────────────────────────────────
function buildGlyphMask() {
    const off = document.createElement('canvas');
    off.width  = 512;
    off.height = MASK_H;
    const octx = off.getContext('2d');

    octx.clearRect(0, 0, off.width, off.height);

    const chars = Array.from(GLYPH_TEXT);
    const cellH = off.height / chars.length;
    const fontSize = Math.floor(cellH * 0.98);

    octx.fillStyle = '#ffffff';
    octx.font = `bold ${fontSize}px ${GLYPH_FONT}`;
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';

    chars.forEach(function (ch, i) {
        const cy = i * cellH + cellH / 2;
        octx.fillText(ch, off.width / 2, cy);
    });

    let data;
    try {
        data = octx.getImageData(0, 0, off.width, off.height).data;
    } catch (e) {
        console.warn('[matrix] glyph pixels unreadable:', e.message);
        return;
    }

    glyphMaskW = off.width;
    glyphMaskH = off.height;
    glyphMask = new Uint8Array(glyphMaskW * glyphMaskH);

    for (let y = 0; y < glyphMaskH; y++) {
        for (let x = 0; x < glyphMaskW; x++) {
            const a = data[(y * glyphMaskW + x) * 4 + 3];
            glyphMask[y * glyphMaskW + x] = a > 100 ? 1 : 0;
        }
    }

    glyphReady = true;
    computeGlyphRect();
}

// ─── Куда положить глифы на экране ─────────────────────────────────────────
function computeGlyphRect() {
    if (!glyphReady) return;

    const padX   = visibleRight * GLYPH_PAD_X;
    const availW = visibleRight - padX * 2;
    const availH = cssH * GLYPH_MAX_H;

    const scale = Math.min(availW / glyphMaskW, availH / glyphMaskH);
    const w = glyphMaskW * scale;
    const h = glyphMaskH * scale;

    glyphRect.x = (visibleRight - w) / 2;
    glyphRect.y = (cssH - h) / 2;
    glyphRect.w = w;
    glyphRect.h = h;
}

// ─── Точка внутри глифа? ───────────────────────────────────────────────────
function inGlyph(px, py) {
    if (!glyphReady) return false;
    const r = glyphRect;
    if (px < r.x || px >= r.x + r.w || py < r.y || py >= r.y + r.h) return false;
    const mx = ((px - r.x) / r.w * glyphMaskW) | 0;
    const my = ((py - r.y) / r.h * glyphMaskH) | 0;
    if (mx < 0 || mx >= glyphMaskW || my < 0 || my >= glyphMaskH) return false;
    return glyphMask[my * glyphMaskW + mx] === 1;
}

// ─── Resize ────────────────────────────────────────────────────────────────
function resizeCanvas() {
    cssW = window.innerWidth;
    cssH = window.innerHeight;

    if (cssW < 1400) CELL_SIZE = 13;
    else if (cssW < 2400) CELL_SIZE = 14;
    else if (cssW < 3000) CELL_SIZE = 15;
    else CELL_SIZE = 17;
    COL_SPACING = CELL_SIZE * 0.4;

    canvas.width  = Math.floor(cssW * DPR);
    canvas.height = Math.floor(cssH * DPR);
    canvas.style.width  = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const contentHalf = getContentHalf();
    visibleRight = Math.max(60, cssW / 2 - contentHalf);

    cols = Math.max(1, Math.floor(visibleRight / COL_SPACING));
    rainDrops = [];
    for (let i = 0; i < cols; i++) {
        const phrase = getRandomPhrase();
        rainDrops.push({
            y: Math.random() * (cssH + 500) - 500,
            speed: RAIN_MIN_PX + Math.random() * (RAIN_MAX_PX - RAIN_MIN_PX),
            origChars: phrase.split(''),
            curChars: phrase.split('')
        });
    }

    computeGlyphRect();
}

// ─── Отрисовка ─────────────────────────────────────────────────────────────
// dtMs — время с прошлого draw() в миллисекундах. Капли сдвигаются на
// speed * dt, где speed уже в px/сек, поэтому фактическая скорость падения
// не зависит от того, сколько кадров успела нарисовать машина.
function draw(dtMs) {
    frame++;
    const t = frame / TARGET_FPS;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, visibleRight, cssH);

    ctx.font = `bold ${CELL_SIZE}px 'Segoe UI', Roboto, -apple-system, 'Yu Gothic', 'Meiryo', 'Noto Sans JP', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

// ── Pass 1: постоянный вертикальный дождь внутри иероглифов ──
if (glyphReady) {
    const bx0 = Math.max(0, Math.floor(glyphRect.x / COL_SPACING));
    const bx1 = Math.min(cols, Math.ceil((glyphRect.x + glyphRect.w) / COL_SPACING));
    const by0 = Math.max(0, Math.floor(glyphRect.y / CELL_SIZE));
    const by1 = Math.min(Math.ceil(cssH / CELL_SIZE),
                         Math.ceil((glyphRect.y + glyphRect.h) / CELL_SIZE));

    for (let cx = bx0; cx < bx1; cx++) {
        const drop = rainDrops[cx];
        const x = cx * COL_SPACING + COL_SPACING * 0.5;
        const len = drop.curChars.length;

        // Скорость потока в ячейках/сек. Можно варьировать по колонкам.
        // +cx*3 — сдвиг фазы между колонками, чтобы не было «рядов».
        const flow = t * 2 + cx * 3;

        for (let cy = by0; cy < by1; cy++) {
            const py = cy * CELL_SIZE + CELL_SIZE * 0.5;
            if (!inGlyph(x, py)) continue;

            // «бесконечная» координата в струе. Растёт t → символы уезжают вниз.
            const s   = cy - flow;
            const idx = ((Math.floor(s) % len) + len) % len;

            let ch = drop.curChars[idx];
            if (ch === ' ') continue;

            // редкий глитч
            if (Math.random() < 0.008) {
                ch = glitchChars[Math.floor(Math.random() * glitchChars.length)];
            }

            // Голова струи (idx === len-1) — самая яркая, хвост затухает.
            const progress = len > 1 ? idx / (len - 1) : 1;
            if (idx === len - 1) {
                ctx.fillStyle = '#00b3ff';
            } else {
                ctx.fillStyle = 'rgba(0, 179, 255, ' + (progress * 0.66).toFixed(3) + ')';
            }
            ctx.fillText(ch, x, py);
        }
    }
}

    // ── Pass 2: обычный дождь ──
    for (let i = 0; i < cols; i++) {
        const drop = rainDrops[i];
        const x = i * COL_SPACING + COL_SPACING * 0.5;
        const len = drop.curChars.length;

        for (let k = 0; k < len; k++) {
            const y = drop.y + k * CELL_SIZE;
            if (y < -CELL_SIZE || y > cssH + CELL_SIZE) continue;

            // Внутрь глифов дождь не заходит
            if (inGlyph(x, y)) continue;

            let ch = drop.curChars[k];

            if (ch !== ' ') {
                if (Math.random() < 0.003) {
                    drop.curChars[k] = glitchChars[Math.floor(Math.random() * glitchChars.length)];
                    ch = drop.curChars[k];
                } else if (Math.random() < 0.09) {
                    drop.curChars[k] = drop.origChars[k];
                    ch = drop.curChars[k];
                }
            }

            const progress = len > 1 ? k / (len - 1) : 1;
            if (k === len - 1 && ch !== ' ') {
                ctx.fillStyle = '#00b3ff';
            } else {
                ctx.fillStyle = 'rgba(0, 179, 255, ' + (progress * 0.66).toFixed(3) + ')';
            }
            ctx.fillText(ch, x, y);
        }

        // Сдвиг по времени: speed задан в px/сек, dt — доля секунды.
        drop.y += drop.speed * dtMs / 1000;

        if (drop.y > cssH) {
            const newPhrase = getRandomPhrase();
            drop.origChars = newPhrase.split('');
            drop.curChars  = newPhrase.split('');
            drop.y = -(newPhrase.length * CELL_SIZE) - Math.random() * 100;
            drop.speed = RAIN_MIN_PX
                       + Math.random() * (RAIN_MAX_PX - RAIN_MIN_PX);
        }
    }
}

// ─── Цикл с лимитом FPS ────────────────────────────────────────────────────
const FRAME_INTERVAL = 1000 / TARGET_FPS;
let lastDraw = 0;

// Видимость матриц решает matrix-layout.js: он меряет реальную ширину
// свободных полей и вешает на <html> класс no-side-matrix.
// Раньше здесь стояло жёсткое `window.innerWidth > 1000`, из-за чего дождь
// выключался на ноутбуках, где поля по 200+px с каждой стороны были.
function sideSpaceAvailable() {
    return !document.documentElement.classList.contains('no-side-matrix');
}

function loop(now) {
    if (!document.hidden && sideSpaceAvailable() &&
        now - lastDraw >= FRAME_INTERVAL) {
        // Первый кадр: шага нет, рисуем без сдвига. Дальше dt ограничен
        // сверху, чтобы после возврата на вкладку дождь не переместился
        // сразу на сотни пикселей.
        const dt = lastDraw ? Math.min(now - lastDraw, MAX_FRAME_MS)
                            : FRAME_INTERVAL;
        draw(dt);
        lastDraw = now;
    }
    requestAnimationFrame(loop);
}


// ─── Старт ─────────────────────────────────────────────────────────────────
//
// Размер холста считаем сразу: без него первые кадры рисуются не туда.
// А вот построение глиф-маски (обход 512x512 пикселей с getImageData)
// отложено до простоя: раньше оно выполнялось синхронно и задерживало
// первый отрисованный кадр на десятки миллисекунд. Пока маски нет,
// inGlyph() возвращает false, и дождь просто идёт поверх глифов —
// через мгновение он начнёт обтекать их.
resizeCanvas();

const whenIdle = window.requestIdleCallback || function (fn) {
    return setTimeout(fn, 1);
};
whenIdle(function () { buildGlyphMask(); }, { timeout: 2000 });

let resizeTimer = null;
window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
        resizeCanvas();
    }, 150);
});

requestAnimationFrame(loop);

// Экспорт состояния дождя — им пользуется audit-matrix-speed.js, который
// сверяет скорость падения левой и правой полосы между собой. По одной
// формуле это не проверить: реальный FPS плавает, а значит плавает и
// фактическая скорость в пикселях на секунду.
window.__rainState = function () {
    return {
        speeds: rainDrops.map(function (d) { return d.speed; }),
        ys: rainDrops.map(function (d) { return d.y; }),
        cell: CELL_SIZE, cssH: cssH, cssW: cssW, frame: frame
    };
};