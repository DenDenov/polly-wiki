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
    // Порог полосы справа. Раньше стояло 120 px, и на окне 1024px (свободное
    // поле 102 px) поток не строился вовсе — правая полоса была пустой.
    // Задача: полоса нужна везде, где поле есть, а колонка может уходить за
    // край окна. Поэтому порог — 60 px, столько же, сколько требует
    // matrix-layout.js и matrix.js для дождя. Карточка шире поля — она
    // обрежется краем окна, и это нормально: контейнер подрезан по
    // clip-path, на центральный текст ничего не заезжает.
    var MIN_BAND_RIGHT = 60;
    // ─── Скорость падения ───────────────────────────────────────────────────
    // Левая матрица (matrix.js) падает со скоростью 0.3..0.8 клетки/кадр при
    // TARGET_FPS = 30, CELL_SIZE = 14 → 126..336 px/сек. Раньше правая шла
    // в 6-10 раз медленнее (33..57 px/сек), и полосы явно читались как
    // разные по скорости потоки. Здесь задаём скорость напрямую в px/сек,
    // чтобы обе стороны совпадали, и добавляем небольшой разброс.
    var FALL_MIN_PX = 126;   // совпадает с минимальной скоростью левой полосы
    var FALL_MAX_PX = 336;   // и с максимальной

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
    // ─── Подгрузка по мере появления в кадре ─────────────────────────────────
    // Наблюдатель один на все карточки. rootMargin — карточка начинает
    // подгружаться, когда до её верхнего края остаётся 1.5 высоты окна:
    // пользователь успевает дождаться готового кадра, а ролики за экраном
    // не качаются.
    var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
            var obj = e.target.__pollyCard;
            if (!obj) return;
            obj.visible = e.isIntersecting;
            if (e.isIntersecting) {
                obj.load();
                if (!isPaused) obj.play();
            } else {
                obj.pause();
            }
        });
    }, { rootMargin: '150% 0px 150% 0px', threshold: 0 }) : null;

    function watchCard(obj) {
        obj.element.__pollyCard = obj;
        if (io) {
            io.observe(obj.element);
        } else {
            // Фолбэк для старых браузеров: грузим сразу, но playback
            // всё равно ограничен паузой при скрытой вкладке.
            obj.visible = true;
            obj.load();
        }
    }


    // ─── Создание карточки ──────────────────────────────────────────────────
    //
    // Ключевой момент для скорости: src НЕ присваивается сразу.
    // Раньше стоял preload="auto" и src сразу — браузер начинал тянуть
    // все ~70 роликов (тогда это было 179 МБ) уже во время первой загрузки
    // страницы, не дожидаясь прокрутки. Теперь файл подставляется только
    // когда карточка реально близко к области просмотра, а playback
    // запускается отдельно — когда она в неё входит.
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
        videoEl.preload = 'none';
        // Глитч превью (CSS cardGlitch). Сдвигаем фазу и период случайно,
        // иначе все карточки «сбоили» синхронно и это читалось как пульсация,
        // а не как случайные сбои. Период отличается у соседних карточек.
        videoEl.style.animationDelay = (-Math.random() * 9) + 's';
        videoEl.style.animationDuration = (5 + Math.random() * 7) + 's';
        // Пока файл не подставлен, карточка — тёмный прямоугольник.
        card.style.background = '#000';

        card.appendChild(videoEl);

        var cardObj = {
            element: card,
            videoElement: videoEl,
            src: src,
            loaded: false,
            visible: false,
            retried: false
        };

        function load() {
            if (cardObj.loaded) return;
            cardObj.loaded = true;
            videoEl.src = src;
            videoEl.load();
        }

        function play() {
            if (!cardObj.visible || isPaused) return;
            if (!cardObj.loaded) load();
            var p = videoEl.play();
            if (p && p.catch) p.catch(function () {});
        }

        function pause() {
            if (!videoEl.paused) videoEl.pause();
        }

        cardObj.load = load;
        cardObj.play = play;
        cardObj.pause = pause;

        // Файл не нашёлся / битый — один раз подменяем на другой из мешка
        videoEl.addEventListener('error', function () {
            if (cardObj.retried) return;
            cardObj.retried = true;
            cardObj.loaded = false;
            src = takeNextSource();
            cardObj.src = src;
            videoEl.src = src;
            if (cardObj.visible && !isPaused) play();
        });

        // Смена ролика на каждом новом витке падения — берём следующий из мешка
        card.addEventListener('animationiteration', function () {
            src = takeNextSource();
            cardObj.src = src;
            cardObj.loaded = true;
            videoEl.src = src;
            if (cardObj.visible && !isPaused) play();
        });

        card.addEventListener('click', function () {
            openFullscreen(cardObj.src);
        });

        columnEl.appendChild(card);
        cards.push(cardObj);
        watchCard(cardObj);
    }

    // ─── Построение потока ──────────────────────────────────────────────────
    function initVideoMatrix() {
        // Старые карточки снимаем с наблюдения: иначе при каждом ресайзе
        // IntersectionObserver держит ссылки на удалённые из DOM элементы
        // вместе с их <video>, и память течёт, а файлы продолжают качаться.
        if (io) {
            cards.forEach(function (cardObj) { io.unobserve(cardObj.element); });
        }
        cards.forEach(function (cardObj) { cardObj.pause(); });

        videoContainer.innerHTML = '';
        cards = [];
        sourceBag = [];
        sourceBagIndex = 0;
        lastTaken = null;

        // ─── Заполнение правой полосы ───────────────────────────────────────
        // Главное — полоса справа от центрального текста заполнена целиком.
        // Обрезанная у края окна колонка не страшна, пустой чёрный край —
        // страшен. Поэтому берём НИЖНУЮ границу числа колонок: сколько нужно,
        // чтобы закрыть полосу, и одна лишняя, уходящая за край.
        var bandStart = window.innerWidth / 2 + getContentHalf() + EDGE_GUTTER;
        var band      = window.innerWidth - bandStart;
        if (band < MIN_BAND_RIGHT) return;   // места нет — поток не строим

        // Число карточек в колонке и «разгон» считаем ОДИН раз на поток,
        // а не внутри цикла по колонкам: от высоты окна зависят оба, и
        // колонки обязаны иметь одинаковую плотность.
        var vh = window.innerHeight;
        var perColumn = cardsPerColumn(vh);

        var count = Math.ceil(band / COLUMN_STEP);

        for (var c = 0; c < count; c++) {
            var currentX = Math.round(bandStart + c * COLUMN_STEP);
            var column = document.createElement('div');
            column.className = 'video-column';
            column.style.left = currentX + 'px';
            videoContainer.appendChild(column);

            // «Разгон» колонки подбираем под целое число шагов: тогда зазор между
            // карточками всегда CARD_STEP_Y минус высота карточки (для портретных
            // 9:16 это ровно GAP_TARGET) и не «плывёт» при разной высоте окна.
            var runway = perColumn * CARD_STEP_Y - vh;
            column.style.setProperty('--card-runway', runway + 'px');

            // Скорость падения в px/сек, случайная внутри полосы — так же, как
            // у левой матрицы. Длительность выводится из СОБСТВЕННОГО пути
            // колонки, поэтому на любой высоте окна скорость в пикселях одна
            // и та же, а колонки с разным числом карточек не «разъезжаются».
            var speed = FALL_MIN_PX + Math.random() * (FALL_MAX_PX - FALL_MIN_PX);
            var duration = (runway + vh) / speed;
            var phase = Math.random() * duration;

            for (var i = 0; i < perColumn; i++) {
                var delay = -(i * duration / perColumn + phase);
                createCard(column, duration, delay);
            }
        }
    }

    // ─── Полноэкранный просмотр ─────────────────────────────────────────────
    // Пауза/возобновление идёт через cardObj.pause()/play(), а не напрямую
    // через videoElement: play() сам учитывает isPaused и cardObj.visible,
    // поэтому карточки за пределами экрана не стартуют playback'ом заново
    // (и не качают файлы, которых не видно).
    function pauseCardVideos() {
        cards.forEach(function (cardObj) { cardObj.pause(); });
    }

    function resumeCardVideos() {
        cards.forEach(function (cardObj) { cardObj.play(); });
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

    // Построение потока отложено до простоя. При высоте окна 900 px
    // initVideoMatrix() создаёт около 30 колонок с карточками, и на каждую
    // вешается IntersectionObserver. Синхронно это занимало 100-180 мс
    // монолитным куском и попадало в первые секунды загрузки — браузер
    // считал это «долгой задачей» и показывал полосу загрузки поверх
    // уже отрисованного текста.
    //
    // Кликнуть по карточке до её построения нельзя: поток пуст, колонок
    // нет. Поэтому на время ожидания вешаем класс is-loading, который
    // прячет матрицу — чтобы не мигало пустое место справа от текста.
    var idle = window.requestIdleCallback || function (fn) {
        return setTimeout(fn, 1);
    };
    videoContainer.classList.add('is-loading');
    idle(function () {
        initVideoMatrix();
        videoContainer.classList.remove('is-loading');
    }, { timeout: 2000 });
})();
