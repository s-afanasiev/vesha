/* Паттерны: Кабинет — логика тестовой страницы (IIFE, vanilla).
   Один путь переноса статуса — moveCardTo(): drag&drop и кнопки ←/→
   вызывают его, он же пишет журнал и тост (демо-аналог двери Funnel).
   Таймеры — одиночный setTimeout на тосты. Данные вымышленные.
   Тосты — общий toast@1 из /c/ui.js (docs/ui-components.md §3). */
(function () {
  'use strict';

  // локальная сигнатура (text, kind, action) → контракт VeshaUI.toast(text, {kind, action})
  var toast = function (text, kind, action) { window.VeshaUI.toast(text, { kind: kind, action: action }); };

  var COLUMNS = [
    { id: 'new', title: 'Новая', limit: 5 },
    { id: 'work', title: 'В работе', limit: 2 },
    { id: 'offer', title: 'Предложение', limit: 3 },
    { id: 'approve', title: 'Согласование', limit: 3 },
    { id: 'done', title: 'Успех', limit: 8 }
  ];

  var CARDS = [
    { id: 'c1', col: 'new', name: 'Ольга Смирнова', time: '09:12', gist: 'Нужна оценка ущерба после ДТП' },
    { id: 'c2', col: 'new', name: 'Игорь Пётрович', time: '10:03', gist: 'Диагностика: стук спереди справа' },
    { id: 'c3', col: 'new', name: 'Гость сайта', time: '11:47', gist: 'Чат: сколько стоит ТО на Rio?' },
    { id: 'c4', col: 'work', name: 'Марина К.', time: 'вчера', gist: 'Кузовной ремонт левого крыла' },
    { id: 'c5', col: 'work', name: 'Дмитрий Т.', time: '08:55', gist: 'Колодки + диски, ждём запчасти со склада' },
    { id: 'c6', col: 'work', name: 'Семён А.', time: '12:20', gist: 'Не заводится, эвакуатор уже приехал' },
    { id: 'c7', col: 'work', name: 'Виктория', time: '13:05', gist: 'Подбор запчастей по складу' },
    { id: 'c8', col: 'offer', name: 'Пётр З.', time: 'вчера', gist: 'Смета на подвеску — 18 400 ₽' },
    { id: 'c9', col: 'offer', name: 'Карина', time: '09:40', gist: 'Покраска бампера — 6 900 ₽' },
    { id: 'c10', col: 'done', name: 'Алексей Д.', time: 'пн', gist: 'ТО-4, всё по плану' },
    { id: 'c11', col: 'done', name: 'Надежда В.', time: 'пн', gist: 'Замена сцепления' },
    { id: 'c12', col: 'done', name: 'Сергей У.', time: 'вс', gist: 'Ремонт ГРМ' },
    { id: 'c13', col: 'done', name: 'Татьяна М.', time: 'вс', gist: 'Сезонная смена шин' }
  ];

  var board = document.getElementById('cb-board');

  /* ---------- рендер ---------- */

  function colById(id) { return COLUMNS.find(function (c) { return c.id === id; }); }
  function cardsIn(colId) { return CARDS.filter(function (c) { return c.col === colId; }); }

  function render() {
    board.innerHTML = '';
    COLUMNS.forEach(function (col) {
      var cards = cardsIn(col.id);
      var over = cards.length > col.limit;

      var el = document.createElement('article');
      el.className = 'cb-col' + (over ? ' cb-col--warn' : '');
      el.dataset.col = col.id;

      var head = document.createElement('div');
      head.className = 'cb-col__head';
      head.innerHTML =
        '<div class="cb-col__title-row">' +
        '<span class="cb-col__title">' + col.title + '</span>' +
        '<span class="cb-col__count">' + cards.length + '</span>' +
        '</div>' +
        '<div class="cb-wip">' +
        '<span class="cb-wip__well"><i class="cb-wip__fill" style="width:' +
        Math.min(cards.length / col.limit * 100, 100) + '%"></i></span>' +
        '<span class="cb-wip__label">' + cards.length + '/' + col.limit + '</span>' +
        '<span class="cb-wip__flag"' + (over ? '' : ' hidden') + '>перегруз</span>' +
        '</div>';
      el.appendChild(head);

      var body = document.createElement('div');
      body.className = 'cb-col__body';
      if (cards.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'cb-empty';
        empty.textContent = 'Пока пусто — новые карточки появятся здесь';
        body.appendChild(empty);
      }
      cards.forEach(function (card) { body.appendChild(cardEl(card, col)); });
      el.appendChild(body);
      board.appendChild(el);
    });
    updateKpi();
  }

  function cardEl(card, col) {
    var idx = COLUMNS.indexOf(col);
    var el = document.createElement('div');
    el.className = 'cb-card';
    el.draggable = true;
    el.dataset.id = card.id;
    el.innerHTML =
      '<div class="cb-card__top"><span class="cb-card__name">' + card.name + '</span>' +
      '<span class="cb-card__time">' + card.time + '</span></div>' +
      '<div class="cb-card__gist">' + card.gist + '</div>';
    var nav = document.createElement('div');
    nav.className = 'cb-card__nav';
    if (idx > 0) {
      var left = document.createElement('button');
      left.type = 'button'; left.className = 'cb-btn'; left.textContent = '←';
      left.setAttribute('aria-label', 'Перенести назад: ' + card.name);
      left.addEventListener('click', function () {
        moveCardTo(card.id, COLUMNS[idx - 1].id);
      });
      nav.appendChild(left);
    }
    if (idx < COLUMNS.length - 1) {
      var right = document.createElement('button');
      right.type = 'button'; right.className = 'cb-btn'; right.textContent = '→';
      right.setAttribute('aria-label', 'Перенести вперёд: ' + card.name);
      right.addEventListener('click', function () {
        moveCardTo(card.id, COLUMNS[idx + 1].id);
      });
      nav.appendChild(right);
    }
    el.appendChild(nav);
    return el;
  }

  function updateKpi() {
    var work = cardsIn('work').length;
    var limit = colById('work').limit;
    document.getElementById('cb-kpi-wip').textContent = String(work);
    document.getElementById('cb-kpi-wip-note').textContent =
      work > limit ? 'выше лимита — сигнал, не блокировка' : 'в пределах лимита';
  }

  /* ---------- единственный путь переноса статуса ---------- */

  function moveCardTo(cardId, targetCol) {
    var card = CARDS.find(function (c) { return c.id === cardId; });
    if (!card || card.col === targetCol) return;
    var from = colById(card.col).title;
    var to = colById(targetCol).title;

    if (document.getElementById('cb-fail-toggle').checked) {
      toast('Не сохранилось: нет сети. «' + card.name + '» осталась в «' + from + '»', 'err', {
        label: 'Повторить',
        fn: function () { moveCardTo(cardId, targetCol); }
      });
      return;
    }

    card.col = targetCol;
    logEvent(card.name + ': ' + from + ' → ' + to);
    toast('Карточка перенесена: ' + from + ' → ' + to, 'ok');
    render();
  }

  /* ---------- drag & drop ---------- */

  board.addEventListener('dragstart', function (e) {
    var card = e.target.closest('.cb-card');
    if (!card) return;
    card.classList.add('is-dragging');
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  board.addEventListener('dragend', function (e) {
    var card = e.target.closest('.cb-card');
    if (card) card.classList.remove('is-dragging');
    board.querySelectorAll('.cb-col.is-over').forEach(function (c) { c.classList.remove('is-over'); });
  });
  board.addEventListener('dragover', function (e) {
    var col = e.target.closest('.cb-col');
    if (!col) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    col.classList.add('is-over');
  });
  board.addEventListener('dragleave', function (e) {
    var col = e.target.closest('.cb-col');
    if (col) col.classList.remove('is-over');
  });
  board.addEventListener('drop', function (e) {
    var col = e.target.closest('.cb-col');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('is-over');
    var id = e.dataTransfer.getData('text/plain');
    if (id) moveCardTo(id, col.dataset.col);
  });

  /* ---------- журнал ---------- */

  function logEvent(text) {
    var log = document.getElementById('cb-log');
    var empty = log.querySelector('.cb-log__empty');
    if (empty) empty.remove();
    var li = document.createElement('li');
    var now = new Date();
    var hh = (now.getHours() < 10 ? '0' : '') + now.getHours();
    var mm = (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();
    li.innerHTML = '<time>' + hh + ':' + mm + '</time>' + text;
    log.prepend(li);
  }
  document.getElementById('cb-log').innerHTML = '<li class="cb-log__empty">Журнал пуст — переносы карточек появятся здесь</li>';

  /* ---------- sparklines (демо-данные, SVG polyline) ---------- */

  function spark(id, data, color) {
    var svg = document.getElementById(id);
    if (!svg) return;
    var min = Math.min.apply(null, data);
    var max = Math.max.apply(null, data);
    var span = (max - min) || 1;
    var pts = data.map(function (v, i) {
      var x = 2 + i * (96 / (data.length - 1));
      var y = 27 - (v - min) / span * 24;
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var last = pts[pts.length - 1].split(',');
    var ns = 'http://www.w3.org/2000/svg';
    var line = document.createElementNS(ns, 'polyline');
    line.setAttribute('points', pts.join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
    var dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', last[0]);
    dot.setAttribute('cy', last[1]);
    dot.setAttribute('r', '2.6');
    dot.setAttribute('fill', color);
    svg.appendChild(dot);
  }

  spark('cb-spark-leads', [1, 2, 1, 3, 2, 3, 2, 4, 3, 3, 4, 3, 4, 3], '#4d8dff');
  spark('cb-spark-conv', [30, 35, 33, 38, 40, 37, 42, 39, 44, 41, 43, 45, 42, 42], '#55b06e');
  spark('cb-spark-reply', [12, 11, 9, 10, 8, 9, 7, 8, 6, 7, 6, 5, 6, 6], '#e0a03c');

  render();
})();
