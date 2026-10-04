/* Паттерны: Конверсия — логика тестовой страницы (IIFE, vanilla).
   Таймеры — одиночный setTimeout для тостов; никаких setInterval. */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var widgetOpen = false;

  /* ---------- тосты ---------- */

  function toast(text, kind, actionLabel, onAction) {
    var box = $('#cv-toasts');
    var el = document.createElement('div');
    el.className = 'cv-toast' + (kind ? ' cv-toast--' + kind : '');
    var span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    if (actionLabel) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = actionLabel;
      btn.addEventListener('click', function () { onAction(); el.remove(); });
      el.appendChild(btn);
    }
    box.appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }

  /* ---------- мок-виджет ассистента ---------- */

  function widgetPush(html, cls) {
    var log = $('#cv-widget-log');
    var el = document.createElement('div');
    el.className = 'cv-msg' + (cls ? ' cv-msg--' + cls : '');
    el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function openWidget(visitorText, stamp) {
    var w = $('#cv-widget');
    if (w.hidden) { w.hidden = false; widgetOpen = true; }
    if (visitorText) {
      widgetPush(escapeHtml(visitorText), 'visitor');
    }
    if (stamp) {
      var st = widgetPush('', 'visitor');
      st.innerHTML = '<span class="cv-msg__stamp">' + escapeHtml(stamp) + '</span>';
    }
    // черновик ассистента — мок: менеджер утверждает или отклоняет
    var draft = widgetPush(
      'Здравствуйте! Записал вас на диагностику — она бесплатная. ' +
      'Удобно сегодня после 16:00? Механик посмотрит и назовёт точную смету.',
      'draft'
    );
    var stampEl = document.createElement('span');
    stampEl.className = 'cv-msg__stamp';
    stampEl.textContent = 'черновик ассистента · ждёт менеджера';
    draft.appendChild(stampEl);

    var actions = document.createElement('div');
    actions.className = 'cv-widget__approve';
    var ok = document.createElement('button');
    ok.type = 'button'; ok.textContent = 'Одобрить';
    var no = document.createElement('button');
    no.type = 'button'; no.textContent = 'Отклонить';
    ok.addEventListener('click', function () {
      stampEl.textContent = 'одобрено и отправлено → событие двигает карточку в «В работе»';
      stampEl.classList.add('cv-msg__stamp--ok');
      actions.remove();
      toast('Ответ ушёл бы клиенту, карточка двинулась по воронке (демо)', 'ok');
    });
    no.addEventListener('click', function () {
      stampEl.textContent = 'отклонён — менеджер напишет вручную';
      actions.remove();
    });
    actions.appendChild(ok); actions.appendChild(no);
    draft.appendChild(actions);

    updateSticky();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  $('#cv-widget-close').addEventListener('click', function () {
    $('#cv-widget').hidden = true;
    widgetOpen = false;
    updateSticky();
  });

  /* ---------- квиз ---------- */

  var quiz = $('#cv-quiz');
  var steps = quiz.querySelectorAll('.cv-qstep');
  var current = 0;
  var calcHint = '';

  function stepInputs(i) { return steps[i].querySelectorAll('input[type="radio"]'); }

  function showStep(i) {
    steps[current].hidden = true;
    steps[current].classList.remove('is-active');
    current = i;
    steps[current].hidden = false;
    steps[current].classList.add('is-active');
    $('#cv-quiz-bar').style.width = ((current + 1) / steps.length * 100) + '%';
    $('#cv-quiz-step').textContent = 'Шаг ' + (current + 1) + ' из ' + steps.length;
    $('#cv-quiz-back').hidden = current === 0;
    var next = $('#cv-quiz-next');
    next.hidden = current === steps.length - 1;
    next.disabled = !canAdvance(current);
    if (current === steps.length - 1) buildSummary();
    var legend = steps[current].querySelector('legend, input, button');
    if (legend) legend.focus({ preventScroll: false });
  }

  function canAdvance(i) {
    if (i === 2) return true; // автомобиль — необязательный
    return Array.prototype.some.call(stepInputs(i), function (r) { return r.checked; });
  }

  function buildSummary() {
    var lines = [];
    ['job', 'when', 'car', 'tried'].forEach(function (name) {
      var v = quiz.querySelector('[name="' + name + '"]:checked');
      if (v) lines.push('<li>' + escapeHtml(v.value) + '</li>');
      else if (name === 'car') {
        var t = $('#cv-car').value.trim();
        if (t) lines.push('<li>' + escapeHtml(t) + '</li>');
      }
    });
    if (calcHint) lines.push('<li><strong>' + escapeHtml(calcHint) + '</strong></li>');
    $('#cv-summary').innerHTML = '<strong>Итог:</strong><ul>' + lines.join('') + '</ul>';
  }

  steps.forEach(function (fs, i) {
    stepInputs(i).forEach(function (r) {
      r.addEventListener('change', function () {
        $('#cv-quiz-next').disabled = false;
      });
    });
  });

  $('#cv-quiz-next').addEventListener('click', function () {
    if (current < steps.length - 1) showStep(current + 1);
  });
  $('#cv-quiz-back').addEventListener('click', function () {
    if (current > 0) showStep(current - 1);
  });

  quiz.addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#cv-name').value.trim();
    var phone = $('#cv-phone').value.trim();
    var err = $('#cv-quiz-error');
    if (name.length < 2 || phone.replace(/\D/g, '').length < 6) {
      err.hidden = false;
      return;
    }
    err.hidden = true;
    toast('Заявка принята (демо): карточка появилась бы в колонке «Новая» с ответами квиза', 'ok');
    var box = document.createElement('div');
    box.className = 'cv-summary';
    box.innerHTML = '<strong>Готово, ' + escapeHtml(name) + '!</strong> В живой версии заявка ушла бы в воронку ' +
      'и менеджер перезвонил бы на ' + escapeHtml(phone) + '. Это демо — отправки нет.';
    var fs = steps[steps.length - 1];
    fs.querySelector('.cv-fields').hidden = true;
    fs.querySelector('.cv-actions').hidden = true;
    err.after(box);
  });

  $('#cv-quiz-chat').addEventListener('click', function () {
    var parts = [];
    ['job', 'when', 'tried'].forEach(function (n) {
      var v = quiz.querySelector('[name="' + n + '"]:checked');
      if (v) parts.push(v.value.toLowerCase());
    });
    var car = $('#cv-car').value.trim();
    if (car) parts.push('машина: ' + car);
    var text = 'Здравствуйте! ' + (parts.length ? 'Нужно: ' + parts.join(', ') + '.' : 'Подскажите по моей ситуации.');
    openWidget(text, 'сообщение собрано из ответов квиза');
  });

  showStep(0);

  /* ---------- калькулятор ---------- */

  var RATE_MIN = 1600, RATE_MAX = 2200;

  function fmt(n) { return Math.round(n / 100) * 100; }
  function money(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  function recalc() {
    var h = parseFloat($('#cv-hours').value);
    var min = h * RATE_MIN, max = h * RATE_MAX;
    if ($('#cv-opt-tow').checked) { min += 2500; max += 2500; }
    $('#cv-hours-out').textContent = String(h).replace('.', ',');
    $('#cv-calc-price').textContent = '≈ ' + money(fmt(min)) + ' – ' + money(fmt(max)) + ' ₽' +
      ($('#cv-opt-parts').checked ? ' + запчасти по складу' : '');
  }
  $('#cv-hours').addEventListener('input', recalc);
  $('#cv-opt-tow').addEventListener('change', recalc);
  $('#cv-opt-parts').addEventListener('change', recalc);
  recalc();

  $('#cv-calc-toquiz').addEventListener('click', function () {
    calcHint = 'Прикидка из калькулятора: ' + $('#cv-calc-price').textContent;
    toast('Расчёт прикреплён к квизу — увидите в итоге (демо)', 'ok');
    document.getElementById('quiz').scrollIntoView({ behavior: 'smooth' });
    if (current === steps.length - 1) buildSummary(); else showStep(0);
  });
  $('#cv-calc-chat').addEventListener('click', function () {
    openWidget('Здравствуйте! Прикидываю по калькулятору: ' + $('#cv-calc-price').textContent +
      '. Это похоже на правду?', 'сообщение из калькулятора прикидки');
  });

  /* ---------- bottom sheet / модалка ---------- */

  var dialog = $('#cv-dialog');
  $('#cv-open-sheet').addEventListener('click', function () { dialog.showModal(); });
  $('#cv-dialog-cta').addEventListener('click', function () {
    dialog.close();
    document.getElementById('zayavka').scrollIntoView({ behavior: 'smooth' });
  });
  $('#cv-dialog-chat').addEventListener('click', function () {
    dialog.close();
    openWidget('Здравствуйте! Сколько стоит замена передних колодок и есть ли окно сегодня?',
      'вопрос из карточки услуги');
  });
  // клик по подложке закрывает (esc закрывает сам)
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) dialog.close();
  });

  /* ---------- sticky CTA-бар ---------- */

  var sticky = $('#cv-sticky');
  var leadVisible = false;
  var demoSticky = false;
  var mobile = window.matchMedia('(max-width: 640px)');

  function updateSticky() {
    var show = (mobile.matches || demoSticky) && !leadVisible && !widgetOpen;
    sticky.hidden = !show;
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      leadVisible = entries[0].isIntersecting;
      updateSticky();
    }, { threshold: 0.4 }).observe($('#zayavka'));
  } else { leadVisible = false; }
  mobile.addEventListener('change', updateSticky);
  $('#cv-sticky-demo').addEventListener('change', function (e) {
    demoSticky = e.target.checked;
    updateSticky();
  });
  updateSticky();

  /* ---------- простая форма заявки ---------- */

  $('#cv-lead-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('#cv-lead-name').value.trim();
    var phone = $('#cv-lead-phone').value.trim();
    var err = $('#cv-lead-error');
    if (name.length < 2 || phone.replace(/\D/g, '').length < 6) {
      err.hidden = false;
      return;
    }
    err.hidden = true;
    e.target.reset();
    toast('Принято, ' + name + ' (демо). Перезвонили бы на ' + phone + ' в течение 10 минут', 'ok');
  });

  $('#cv-sticky-chat').addEventListener('click', function () {
    openWidget('Здравствуйте! Есть свободное окно на диагностику?', '');
  });
})();
