/* ============================================================================
   Polly Wiki — аудиоплеер в шапке
   ----------------------------------------------------------------------------
   • Кнопка play/pause + кнопка следующего трека.
   • Треки берутся из window.POLLY_TRACKS (файл audio/tracks.js) или из
     DEFAULT_TRACKS ниже.
   • Воспроизведение в случайном порядке, автопереход по окончании.
   ============================================================================ */

(function () {
    'use strict';

    // ─── Список треков по умолчанию ───────────────────────────────────────
    var DEFAULT_TRACKS = [
        'assets/blue_umbrella.mp3'
    ];

    var tracks = (Array.isArray(window.POLLY_TRACKS) && window.POLLY_TRACKS.length)
        ? window.POLLY_TRACKS.filter(function (s) { return typeof s === 'string' && s; })
        : DEFAULT_TRACKS.slice();

    // ─── DOM ──────────────────────────────────────────────────────────────
    var toggleBtn = document.getElementById('audio-toggle');
    var nextBtn = document.getElementById('audio-next');
    var trackNameEl = document.getElementById('audio-track-name');
    var audio = document.getElementById('audio-element');
    var iconPlay = document.getElementById('audio-icon-play');
    var iconPause = document.getElementById('audio-icon-pause');

    // ─── Синхронизация с полноэкранным видео ──────────────────────────────
    // video-matrix.js шлёт события при открытии/закрытии видео из правой
    // матрицы. Слушатели регистрируем ДО проверки разметки: даже если плеера
    // в шапке на странице нет, звук встроенных <audio> всё равно должен
    // замолкать. Запоминаем именно те элементы, что играли в момент открытия,
    // — чтобы вернуть звук только им (и только если он был).
    var audioPausedByVideo = [];

    document.addEventListener('polly:video-open', function () {
        audioPausedByVideo = [];
        document.querySelectorAll('audio').forEach(function (el) {
            if (el.paused) return;
            audioPausedByVideo.push(el);
            el.pause();
        });
    });

    document.addEventListener('polly:video-close', function () {
        var toResume = audioPausedByVideo;
        audioPausedByVideo = [];
        toResume.forEach(function (el) {
            var p = el.play();
            if (p && p.catch) p.catch(function () {});
        });
    });

    if (!toggleBtn || !audio) return;

    var currentIndex = -1;
    var isPlaying = false;

    // ─── Утилиты ──────────────────────────────────────────────────────────
    function formatName(src) {
        var base = src.split('/').pop() || src;
        return base.replace(/\.[^.]+$/, '');
    }

    function pickRandomIndex(exclude) {
        if (tracks.length <= 1) return 0;
        var idx, guard = 0;
        do {
            idx = Math.floor(Math.random() * tracks.length);
            guard++;
        } while (idx === exclude && guard < 50);
        return idx;
    }

    function updateButton() {
        if (!iconPlay || !iconPause) return;
        if (isPlaying) {
            iconPlay.style.display = 'none';
            iconPause.style.display = '';
            toggleBtn.classList.add('playing');
        } else {
            iconPlay.style.display = '';
            iconPause.style.display = 'none';
            toggleBtn.classList.remove('playing');
        }
    }

    function loadTrack(index, autoplay) {
        if (index < 0 || index >= tracks.length) return;
        currentIndex = index;
        audio.src = tracks[index];
        if (trackNameEl) trackNameEl.textContent = formatName(tracks[index]);
        if (autoplay) {
            var p = audio.play();
            if (p && p.catch) p.catch(function () {});
        }
    }

    function playRandom(exclude) {
        if (!tracks.length) return;
        loadTrack(pickRandomIndex(exclude), true);
    }

    // ─── Обработчики ──────────────────────────────────────────────────────
    toggleBtn.addEventListener('click', function () {
        if (isPlaying) {
            audio.pause();
        } else if (currentIndex < 0) {
            playRandom(-1);
        } else {
            var p = audio.play();
            if (p && p.catch) p.catch(function () {});
        }
    });

    if (nextBtn) {
        nextBtn.addEventListener('click', function () {
            playRandom(currentIndex);
        });
    }

    audio.addEventListener('play', function () {
        isPlaying = true;
        updateButton();
    });

    audio.addEventListener('pause', function () {
        isPlaying = false;
        updateButton();
    });

    audio.addEventListener('ended', function () {
        playRandom(currentIndex);
    });

    audio.addEventListener('error', function () {
        if (tracks.length > 1) {
            playRandom(currentIndex);
        } else {
            isPlaying = false;
            updateButton();
        }
    });

    updateButton();
})();
