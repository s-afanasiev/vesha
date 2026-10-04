/* Паттерны: Доверие + витрина — логика тестовой страницы (IIFE, vanilla).
   Пилюля режима: рекурсивный setTimeout раз в минуту. Count-up: значения
   в DOM сразу, анимация — усиление; без rAF-цикла при reduced-motion. */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- живая пилюля режима ---------- */

  // график точки: 0 = воскресенье; null — закрыто
  var SCHEDULE = [null, [9, 19], [9, 19], [9, 19], [9, 19], [9, 19], [10, 15]];
  var DAY_IN = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(mins) { return pad(Math.floor(mins / 60)) + ':' + pad(mins % 60); }

  function pillTick() {
    var now = new Date();
    var day = now.getDay();
    var nowMins = now.getHours() * 60 + now.getMinutes();
    var today = SCHEDULE[day];
    var text, mode;

    if (today && nowMins >= today[0] * 60 && nowMins < today[1] * 60) {
      var left = today[1] * 60 - nowMins;
      if (left <= 60) {
        text = 'Сейчас открыто · закрываемся в ' + hhmm(today[1] * 60) + ' — через ' + left + ' мин';
        mode = 'warn';
      } else {
        text = 'Сейчас открыто · до ' + hhmm(today[1] * 60);
        mode = 'open';
      }
    } else {
      mode = 'closed';
      // ищем ближайшее открытие: сегодня позже или следующий день
      if (today && nowMins < today[0] * 60) {
        text = 'Сейчас закрыто · откроемся сегодня в ' + hhmm(today[0] * 60);
      } else {
        for (var step = 1; step <= 7; step++) {
          var d = (day + step) % 7;
          if (SCHEDULE[d]) {
            text = 'Сейчас закрыто · откроемся ' + (step === 1 ? 'завтра' : DAY_IN[d]) +
              ' в ' + hhmm(SCHEDULE[d][0] * 60);
            break;
          }
        }
      }
    }

    var pill = $('#td-pill');
    pill.classList.remove('td-pill--open', 'td-pill--warn', 'td-pill--closed');
    pill.classList.add('td-pill--' + mode);
    $('#td-pill-text').textContent = text;

    setTimeout(pillTick, 60000); // рекурсивный setTimeout, не setInterval
  }
  pillTick();

  /* ---------- count-up цифр ---------- */

  function formatCount(el, value) {
    if (el.hasAttribute('data-format') && el.getAttribute('data-format') === 'space') {
      return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }
    return String(value);
  }

  function animateCount(el) {
    var target = parseInt(el.getAttribute('data-count'), 10);
    if (reducedMotion || !('IntersectionObserver' in window)) return; // число уже в DOM
    var started = null;
    function frame(ts) {
      if (started === null) started = ts;
      var k = Math.min((ts - started) / 900, 1);
      var eased = 1 - Math.pow(1 - k, 3);
      el.textContent = formatCount(el, Math.round(target * eased));
      if (k < 1) requestAnimationFrame(frame);
    }
    el.textContent = formatCount(el, 0);
    requestAnimationFrame(frame);
  }

  var counters = document.querySelectorAll('[data-count]');
  if ('IntersectionObserver' in window) {
    var seen = new WeakSet();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !seen.has(en.target)) {
          seen.add(en.target);
          animateCount(en.target);
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { io.observe(el); });
  }

  /* ---------- слайдер до/после ---------- */

  var baRange = $('#td-ba-range');
  var baStage = $('#td-ba-stage');

  function setBaPos(v) {
    baStage.style.setProperty('--ba-pos', v + '%');
    $('#td-ba-after').style.setProperty('--ba-pos', v + '%');
  }
  baRange.addEventListener('input', function () { setBaPos(baRange.value); });
  setBaPos(baRange.value);

  /* ---------- spotlight-карточки ---------- */

  var finePointer = window.matchMedia('(pointer: fine)').matches;
  if (finePointer && !reducedMotion) {
    var grid = $('#td-grid');
    grid.addEventListener('pointermove', function (e) {
      var card = e.target.closest('.td-card');
      if (!card) return;
      var rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
      card.style.setProperty('--my', (e.clientY - rect.top) + 'px');
    });
  }

  /* ---------- lightbox документов ---------- */

  var lightbox = $('#td-lightbox');
  var lightboxDoc = $('#td-lightbox-doc');

  document.querySelectorAll('.td-doc').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $('#td-lightbox-h').textContent = btn.getAttribute('data-title') || 'Документ';
      lightboxDoc.innerHTML = '';
      lightboxDoc.appendChild(btn.querySelector('svg').cloneNode(true));
      lightbox.showModal();
    });
  });
  lightbox.addEventListener('click', function (e) {
    if (e.target === lightbox) lightbox.close();
  });
})();
