/* ============================================================================
   matrix-layout.js — решает, есть ли место для боковых матриц.

   Зачем файл существует: matrix.js и CSS уже на него ссылаются
   (проверка html.no-side-matrix и переменная --side-gap), но самого
   файла не было — класс не выставлялся, и CSS-правило
   `html.no-side-matrix #matrix-bg { display: none }` никогда не
   срабатывало. На узком окне это значило, что карточки наезжали
   на центральный текст.

   Как решает: измеряет реальную ширину свободных полей (окно минус
   центральный блок) и сравнивает с шириной, нужной хотя бы для одной
   колонки. Если места хватает — класс снимается, матрицы рисуются.
   Если нет — класс ставится, полосы скрываются.

   Важно: порог по ширине ОКНА здесь не используется осознанно. Раньше
   стоял `@media (max-width: 1000px)`, и он выключал матрицы на ноутбуке
   1280x800, где поля по 220px с каждой стороны и дождь туда помещался.
   Решение принимается по геометрии, а не по размеру окна.
   ============================================================================ */

(function () {
    'use strict';

    // Ширина карточки + зазор до следующей колонки. Взято из
    // video-matrix.js (CARD_WIDTH + COLUMN_GAP), чтобы обе полосы
    // считали «одну колонку» одинаково.
    var MIN_COLUMN_PX = 186;
    // Порог включения/выключения. Разные значения нужны, чтобы при
    // медленной перетаске окна класс не мигал на границе.
    var HYSTERESIS = 12;

    var root = document.documentElement;

    function contentHalf() {
        var raw = getComputedStyle(root).getPropertyValue('--content-half');
        var v = parseFloat(raw);
        // Фолбэк совпадает с --content-half в CSS: на узком экране
        // центральный блок занимает всё поле.
        if (!v || isNaN(v)) {
            v = window.innerWidth < 1000
                ? window.innerWidth : window.innerWidth * 0.27;
        }
        return v;
    }

    function update() {
        var half = contentHalf();
        // Свободное поле с одной стороны.
        var gap = window.innerWidth / 2 - half;
        root.style.setProperty('--side-gap', Math.max(0, Math.round(gap)) + 'px');

        var hidden = root.classList.contains('no-side-matrix');
        if (gap >= MIN_COLUMN_PX + HYSTERESIS) {
            root.classList.remove('no-side-matrix');
        } else if (gap < MIN_COLUMN_PX - HYSTERESIS) {
            root.classList.add('no-side-matrix');
        }
        // В «серой зоне» оставляем как есть — иначе окно шириной ровно
        // в 186px дёргалось бы между состояниями на каждом пикселе.
        void hidden;
    }

    update();

    var timer = null;
    window.addEventListener('resize', function () {
        clearTimeout(timer);
        // Не на каждый пиксель: при перетаске окна события идут чаще,
        // чем нужно, а считать геометрию дорого.
        timer = setTimeout(update, 120);
    });

    // Ширина центрального блока меняется и без ресайза окна — например,
    // после смены шрифта или загрузки картинки в шапке. На это есть
    // ResizeObserver, но не во всех браузерах; страховка через
    // повторную проверку на загрузке.
    window.addEventListener('load', update);
    if (window.ResizeObserver) {
        var main = document.querySelector('main') || document.body;
        new ResizeObserver(update).observe(main);
    }
})();