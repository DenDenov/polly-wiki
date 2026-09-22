/* ============================================================================
   Polly Wiki — интерактивная «видео-матрица» в правой пустой области
   ----------------------------------------------------------------------------
   Изменения:
   • Карточки больше не имеют фиксированной высоты — она определяется
     пропорциями самого видео (нет чёрных полей и обрезки).
   • Источники берутся из глобального «мешка» (shuffle bag) — каждый ролик
     используется один раз, прежде чем повториться. Это исключает повторы
     видео в видимой области.
   • Полноэкранный просмотр растягивается на весь экран (object-fit: contain).
   • Звук страницы (плеер в шапке, встроенные <audio>) встаёт на паузу при
     открытии видео и возвращается при закрытии — через события
     polly:video-open / polly:video-close, их слушает audio-player.js.
   ============================================================================ */

(function () {
    'use strict';

    var videoContainer = document.getElementById('video-matrix-right');
    var overlay = document.getElementById('fullscreen-video-overlay');
    var mainVideo = document.getElementById('main-active-video');
    var bgVideo = document.getElementById('bg-blur-video');
    var closeBtn = document.getElementById('close-video-btn');

    if (!videoContainer || !overlay || !mainVideo || !bgVideo) return;

    // ─── Источники видео ────────────────────────────────────────────────────
    var VIDEO_DIR = 'video/';
    var VIDEO_BASE = 'video_2026-09-22_10-26-06';
    var VIDEO_INDEX_FROM = 2;
    var VIDEO_INDEX_TO = 69;

    var videoSources = [];
    for (var n = VIDEO_INDEX_FROM; n <= VIDEO_INDEX_TO; n++) {
        videoSources.push(encodeURI(VIDEO_DIR + VIDEO_BASE + ' (' + n + ').mp4'));
    }
    videoSources.unshift(encodeURI(VIDEO_DIR + VIDEO_BASE + '.mp4'));

    // ─── Shuffle bag: каждый источник используется один раз до повтора ─────
    var sourceBag = [];
    var sourceBagIndex = 0;
    var lastTaken = null;

    function shuffleInPlace(arr) {
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
        }
        return arr;
    }

    function refillBag() {
        sourceBag = shuffleInPlace(videoSources.slice());
        // Первый элемент мешка не должен совпадать с последним выданным
        if (lastTaken && sourceBag.length > 1 && sourceBag[0] === lastTaken) {
            var t = sourceBag[0]; sourceBag[0] = sourceBag[1]; sourceBag[1] = t;
        }
        sourceBagIndex = 0;
    }

    function takeNextSource() {
        if (!sourceBag.length || sourceBagIndex >= sourceBag.length) refillBag();
        var src = sourceBag[sourceBagIndex++];
        lastTaken = src;
        return src;
    }

    // ─── Геометрия потока ───────────────────────────────────────────────────
    var CARD_WIDTH = 180;
    // Самая высокая карточка при такой ширине: портретный ролик 9:16 (58 из 69).
    // От неё зависят и «разгон» над экраном, и плотность колонки.
    var CARD_MAX_HEIGHT = 320;
    var CARD_RUNWAY = CARD_MAX_HEIGHT + 5;   // = --card-runway в CSS (@keyframes cardFall)
    var GAP_TARGET = 12;       // желаемый зазор между карточками в колонке, px
    var COLUMN_GAP = 6;        // зазор между колонками, px
    var COLUMN_STEP = CARD_WIDTH + COLUMN_GAP;
    var EDGE_GUTTER = 20;      // отступ первой колонки от границы контента
    var EDGE_MARGIN = 4;       // чтобы последняя колонка не уезжала за правый край
    var MIN_SPEED_MS = 34;     // самая быстрая колонка, сек. на полный путь
    var SPEED_SPREAD = 38;     // разброс длительности анимации, сек.

    // Шаг между карточками в колонке. Задаём его сами (а не выводим из пути),
    // а «разгон» над экраном (--card-runway) подбираем так, чтобы шаг уложился
    // целое число раз: runway = perColumn * CARD_STEP_Y - vh. Тогда зазор
    // одинаково плотный при любой высоте окна, а не «гуляет» от 5 до 90 px.
    var CARD_STEP_Y = CARD_MAX_HEIGHT + GAP_TARGET;   // гарантированно > высоты карточки

    // Минимум 3 — иначе поток выглядит пустым. Ограничение runway >= CARD_MAX_HEIGHT
    // (карточка обязана полностью уйти за верхний край) даёт ровно ceil(...).
    function cardsPerColumn(vh) {
        return Math.max(3, Math.ceil((vh + CARD_MAX_HEIGHT) / CARD_STEP_Y));
    }

    function getContentHalf() {
        var raw = getComputedStyle(document.documentElement).getPropertyValue('--content-half');
        var val = parseFloat(raw);
        return isNaN(val) ? 410 : val;
    }

    // ─── Состояние ──────────────────────────────────────────────────────────
    var cards = [];
    var isPaused = false;
    var resumeTimer = null;

    // ─── Создание карточки ──────────────────────────────────────────────────
    function createCard(columnEl, duration, delay) {
        var src = takeNextSource();

        var card = document.createElement('div');
        card.className = 'matrix-video-card';
        card.style.animationDuration = duration + 's';
        card.style.animationDelay = delay + 's';

        var videoEl = document.createElement('video');
        videoEl.loop = true;
        videoEl.muted = true;
        videoEl.defaultMuted = true;
        videoEl.playsInline = true;
        videoEl.setAttribute('muted', '');
        videoEl.setAttribute('playsinline', '');
        videoEl.setAttribute('aria-hidden', 'true');
        videoEl.preload = 'auto';
        videoEl.src = src;

        card.appendChild(videoEl);

        var cardObj = {
            element: card,
            videoElement: videoEl,
            src: src,
            retried: false
        };

        // Файл не нашёлся / битый — один раз подменяем на другой из мешка
        videoEl.addEventListener('error', function () {
            if (cardObj.retried) return;
            cardObj.retried = true;
            cardObj.src = takeNextSource();
            videoEl.src = cardObj.src;
            if (!isPaused) {
                var p = videoEl.play();
                if (p && p.catch) p.catch(function () {});
            }
        });

        // Смена ролика на каждом новом витке падения — берём следующий из мешка
        card.addEventListener('animationiteration', function () {
            cardObj.src = takeNextSource();
            videoEl.src = cardObj.src;
            if (!isPaused) {
                var p = videoEl.play();
                if (p && p.catch) p.catch(function () {});
            }
        });

        if (!isPaused) {
            var playPromise = videoEl.play();
            if (playPromise && playPromise.catch) playPromise.catch(function () {});
        }

        card.addEventListener('click', function () {
            openFullscreen(cardObj.src);
        });

        columnEl.appendChild(card);
        cards.push(cardObj);
    }

    // ─── Построение потока ──────────────────────────────────────────────────
    function initVideoMatrix() {
        videoContainer.innerHTML = '';
        cards = [];
        sourceBag = [];
        sourceBagIndex = 0;
        lastTaken = null;

        if (window.innerWidth <= 1000) return;

        var vh = window.innerHeight;
        var perColumn = cardsPerColumn(vh);

        var startX = Math.ceil(window.innerWidth / 2 + getContentHalf() + EDGE_GUTTER);
        var currentX = startX;

        while (currentX + CARD_WIDTH <= window.innerWidth - EDGE_MARGIN) {
            var column = document.createElement('div');
            column.className = 'video-column';
            column.style.left = currentX + 'px';
            videoContainer.appendChild(column);

            // «Разгон» колонки подбираем под целое число шагов: тогда зазор между
            // карточками всегда CARD_STEP_Y минус высота карточки (для портретных
            // 9:16 это ровно GAP_TARGET) и не «плывёт» при разной высоте окна.
            var runway = perColumn * CARD_STEP_Y - vh;
            column.style.setProperty('--card-runway', runway + 'px');

            // Скорость падения одинаковая во всех колонках и на любом окне:
            // длительность анимации пропорциональна собственному пути колонки.
            var speed = (vh + CARD_MAX_HEIGHT) / (MIN_SPEED_MS + Math.random() * SPEED_SPREAD);
            var duration = (runway + vh) / speed;
            var phase = Math.random() * duration;

            for (var i = 0; i < perColumn; i++) {
                var delay = -(i * duration / perColumn + phase);
                createCard(column, duration, delay);
            }

            currentX += COLUMN_STEP;
        }
    }

    // ─── Полноэкранный просмотр ─────────────────────────────────────────────
    function pauseCardVideos() {
        cards.forEach(function (cardObj) {
            cardObj.wasPlaying = !cardObj.videoElement.paused;
            if (cardObj.wasPlaying) cardObj.videoElement.pause();
        });
    }

    function resumeCardVideos() {
        cards.forEach(function (cardObj) {
            if (!cardObj.wasPlaying) return;
            var p = cardObj.videoElement.play();
            if (p && p.catch) p.catch(function () {});
        });
    }

    function pauseFlow() {
        videoContainer.classList.add('is-paused');
        pauseCardVideos();
    }

    function resumeFlow() {
        videoContainer.classList.remove('is-paused');
        resumeCardVideos();
    }

    function openFullscreen(src) {
        clearTimeout(resumeTimer);
        isPaused = true;
        pauseFlow();

        // гасим звук страницы (плеер в шапке, встроенные <audio>) на время
        // просмотра — слушает audio-player.js
        document.dispatchEvent(new CustomEvent('polly:video-open'));

        mainVideo.src = src;
        bgVideo.src = src;

        overlay.classList.add('active');

        mainVideo.muted = false;
        mainVideo.volume = 1;

        var mainPlay = mainVideo.play();
        if (mainPlay && mainPlay.catch) {
            mainPlay.catch(function () {
                mainVideo.muted = true;
                var retry = mainVideo.play();
                if (retry && retry.catch) retry.catch(function () {});
            });
        }

        var bgPlay = bgVideo.play();
        if (bgPlay && bgPlay.catch) bgPlay.catch(function () {});
    }

    function closeFullscreen() {
        if (!overlay.classList.contains('active')) return;

        overlay.classList.remove('active');
        mainVideo.pause();
        bgVideo.pause();
        resumeFlow();

        // возвращаем звук, который играл до открытия видео
        document.dispatchEvent(new CustomEvent('polly:video-close'));

        clearTimeout(resumeTimer);
        resumeTimer = setTimeout(function () {
            isPaused = false;
        }, 400);
    }

    // ─── События ────────────────────────────────────────────────────────────
    mainVideo.addEventListener('ended', closeFullscreen);

    if (closeBtn) closeBtn.addEventListener('click', closeFullscreen);

    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeFullscreen();
    });

    document.addEventListener('keydown', function (e) {
        if ((e.key === 'Escape' || e.key === 'Esc') && overlay.classList.contains('active')) {
            closeFullscreen();
        }
    });

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            pauseFlow();
        } else if (!overlay.classList.contains('active')) {
            resumeFlow();
        }
    });

    var resizeTimer = null;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(initVideoMatrix, 200);
    });

    initVideoMatrix();
})();
