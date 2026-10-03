/* Карусель услуг: 3D-coverflow на CSS по docs/ui-carousel-modal.md
   (без WebGL и requestAnimationFrame: смена индекса + CSS-переходы).
   Отличие от дока: колесо мыши НЕ перехватываем — оно прокручивает страницу;
   лента крутится сама (автопрокрутка с паузами), стрелками и кликом.
   Плюс модалка с фиксированной геометрией и синхронным листанием. */
(function () {
  'use strict';

  const SERVICES = [
    {
      icon: '🚗', tag: 'Страхование', title: 'ОСАГО и КАСКО',
      meta: ['РЕСО · Ингосстрах', 'оформление 15–30 мин'],
      desc: 'Подберём и оформим полис на ваших условиях, напомним о продлении заранее и восстановим потерянный КБМ. Услуги агента для вас бесплатны — вы платите только страховой компании.',
      specs: { 'Срок оформления': '15–30 минут', 'Услуги агента': '0 ₽ — комиссию платит страховая', 'Нужные документы': 'паспорт, СТС, водительское удостоверение', 'Продление': 'напомним за месяц до окончания' },
    },
    {
      icon: '🚕', tag: 'Страхование', title: 'ОСГОП для такси',
      meta: ['перевозчикам', 'обязательный полис'],
      desc: 'Обязательное страхование ответственности перевозчика: оформим быстро, подскажем, какие документы подготовить, и поможем с пролонгацией для целого автопарка.',
      specs: { 'Для кого': 'такси-парки и самозанятые водители', 'Срок оформления': 'от 30 минут', 'Нужные документы': 'лицензия такси, СТС, паспорт', 'Дополнительно': 'оформление на несколько машин сразу' },
    },
    {
      icon: '🆘', tag: 'Экспертиза', title: 'Аварийный комиссар',
      meta: ['выезд на ДТП', 'документы под ключ'],
      desc: 'Приедем на место аварии: сфотографируем, оформим документы, подскажем, что говорить страховой, и проследим, чтобы ни один лист не потерялся.',
      specs: { 'Выезд': 'по Курску — в среднем 40–60 минут', 'Что делает': 'осмотр, фото, схема, документы для СК', 'Когда': 'круглосуточно по договорённости', 'Результат': 'готовый пакет для страховой' },
    },
    {
      icon: '🔧', tag: 'Техосмотр', title: 'Техосмотр без очередей',
      meta: ['своя станция', 'диагностическая карта'],
      desc: 'Своя станция технического осмотра: запишем на удобное время, проведём осмотр и выдадим диагностическую карту в тот же день.',
      specs: { 'Запись': 'на конкретное время, без очереди', 'Диагностическая карта': 'в день обращения', 'Адрес': 'ул. Студенческая, 20', 'Для кого': 'легковые авто и такси' },
    },
    {
      icon: '📋', tag: 'Оценка', title: 'Экспертиза после ДТП',
      meta: ['для суда и СК', 'по единой методике'],
      desc: 'Независимая оценка повреждений автомобиля по единой методике ЦБ: расчёт, который примут и страховая, и суд. Сопоставим сумму с предложенной выплатой.',
      specs: { 'Цена (демо)': 'от 2 500 ₽', 'Срок': '1–2 рабочих дня', 'Методика': 'единая методика ЦБ и справочники РСА', 'Выезд': 'по Курской области' },
    },
    {
      icon: '🏠', tag: 'Оценка', title: 'Залив и пожар',
      meta: ['квартиры и дома', 'акт + расчёт'],
      desc: 'Оценим ущерб от залива или пожара: зафиксируем повреждения, соберём акты, посчитаем восстановительную стоимость имущества — для переговоров с виновником или суда.',
      specs: { 'Цена (демо)': 'от 3 000 ₽', 'Срок': '2–3 рабочих дня', 'Что входит': 'осмотр, фотоотчёт, смета восстановления', 'Выезд': 'Курск и область — выезжаем' },
    },
    {
      icon: '🧾', tag: 'Оценка', title: 'Оценка недвижимости',
      meta: ['нотариус · банк · суд', 'по ФСО'],
      desc: 'Отчёт об оценке квартиры, дома или земли по ФЗ-135 и стандартам ФСО: для нотариуса, наследства, ипотеки, купли-продажи и судебных споров.',
      specs: { 'Цена (демо)': 'от 3 500 ₽', 'Срок': '1–3 рабочих дня', 'Стандарты': 'ФЗ-135, ФСО-1, ФСО-2, ФСО-3', 'Отчёт': 'бумажный сшитый + электронная версия' },
    },
    {
      icon: '⚖️', tag: 'Юрист', title: 'Автоюрист и взыскание',
      meta: ['споры со СК', 'до суда и в суде'],
      desc: 'Страховая занизила выплату или тянет с ответом? Составим претензию, посчитаем неустойку и доведём дело до выплаты — в большинстве случаев без вашего присутствия в суде.',
      specs: { 'Первичная консультация': 'по документам — бесплатно (демо)', 'Претензия в СК': 'подготовим и подадим', 'Суд': 'представительство под ключ', 'Оплата': 'фикс + процент от взысканного' },
    },
  ];

  const AUTOPLAY_MS = 4500;
  const WHEEL_COOLDOWN_MS = 380;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const carouselEl = document.getElementById('ov-carousel');
  const stageEl = document.getElementById('ov-stage');
  const stripEl = document.getElementById('ov-strip');
  const prevBtn = document.getElementById('ov-prev');
  const nextBtn = document.getElementById('ov-next');
  const modalEl = document.getElementById('ov-modal');
  const modalVisual = document.getElementById('ov-modal-visual');
  const modalTag = document.getElementById('ov-modal-tag');
  const modalTitle = document.getElementById('ov-modal-title');
  const modalDesc = document.getElementById('ov-modal-desc');
  const modalSpecs = document.getElementById('ov-modal-specs');

  const n = SERVICES.length;
  let current = 0;
  const pausedBy = new Set(); // hover | modal | hidden | offscreen

  function offsetOf(i) {
    let d = (i - current) % n;
    if (d < -n / 2) d += n;
    if (d > n / 2) d -= n;
    return d;
  }

  // ---- лента ---------------------------------------------------------------

  function render() {
    SERVICES.forEach((s, i) => {
      const card = stageEl.children[i];
      card.classList.toggle('ov-card--active', i === current);
      if (reducedMotion) return; // плоская лента: геометрию держит CSS

      const d = offsetOf(i);
      const abs = Math.abs(d);
      let style;
      if (d === 0) {
        style = 'translateX(0) translateZ(110px) scale(1.05)';
      } else if (abs === 1) {
        style = `translateX(${d > 0 ? 330 : -330}px) rotateY(${d > 0 ? -42 : 42}deg) scale(0.86)`;
      } else if (abs === 2) {
        style = `translateX(${d > 0 ? 540 : -540}px) rotateY(${d > 0 ? -26 : 26}deg) scale(0.72)`;
      } else if (abs === 3) {
        style = `translateX(${d > 0 ? 655 : -655}px) rotateY(${d > 0 ? -15 : 15}deg) scale(0.6)`;
      } else {
        style = 'translateX(0) scale(0.5)';
      }
      card.style.transform = style;
      card.style.opacity = abs === 0 ? '1' : abs === 1 ? '0.85' : abs === 2 ? '0.5' : abs === 3 ? '0.2' : '0';
      card.style.zIndex = String(10 - abs);
    });
  }

  function buildCards() {
    SERVICES.forEach((s, i) => {
      const card = document.createElement('article');
      card.className = 'ov-card';
      card.innerHTML = `
        <span class="ov-card__icon">${s.icon}</span>
        <span class="ov-card__tag">${s.tag}</span>
        <h3>${s.title}</h3>
        <div class="ov-card__meta">${s.meta.map((m) => `<span>${m}</span>`).join('')}</div>`;
      card.addEventListener('click', () => {
        const clickable = reducedMotion || Math.abs(offsetOf(i)) <= 1;
        if (!clickable) return;
        if (i !== current) {
          current = i;
          render();
        }
        openModal();
      });
      stageEl.appendChild(card);
    });
  }

  function step(dir) {
    current = (current + dir + n) % n;
    render();
  }

  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));

  // Колесо листает карусель только когда курсор в полосе-«отблеске» (ov-strip):
  // в ней preventDefault, вне полосы обработчик молчит — страница скроллится как обычно.
  let wheelAt = 0;
  let wheelIdle = null;
  function cursorInStrip(e) {
    const r = stripEl.getBoundingClientRect();
    return e.clientY >= r.top && e.clientY <= r.bottom;
  }
  carouselEl.addEventListener('wheel', (e) => {
    if (reducedMotion || !cursorInStrip(e)) return;
    e.preventDefault();
    const now = Date.now();
    if (now - wheelAt < WHEEL_COOLDOWN_MS) return;
    wheelAt = now;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) < 12) return;
    // человек рулит: автопрокрутка стоит, пока пауза между вращениями колеса
    pause('strip');
    step(delta > 0 ? 1 : -1);
    if (wheelIdle) clearTimeout(wheelIdle);
    wheelIdle = setTimeout(() => resume('strip'), AUTOPLAY_MS);
  }, { passive: false });

  // стрелки клавиатуры, когда фокус на ленте
  carouselEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });

  // ---- автопрокрутка с паузами ----------------------------------------------
  // Только рекурсивный setTimeout: один шаг — и по таймеру запланировали следующий.
  // Никаких setInterval: пауза — это clearTimeout, возобновление — новая постановка.

  let timer = null;
  function canAutoPlay() {
    return !reducedMotion && pausedBy.size === 0;
  }
  function schedule() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!canAutoPlay()) return;
    timer = setTimeout(() => {
      timer = null;
      step(1);
      schedule();
    }, AUTOPLAY_MS);
  }
  // ре-планируем только при реальном изменении состояния, а не на каждый mousemove
  function pause(reason) {
    if (pausedBy.has(reason)) return;
    pausedBy.add(reason);
    schedule();
  }
  function resume(reason) {
    if (!pausedBy.has(reason)) return;
    pausedBy.delete(reason);
    schedule();
  }

  document.addEventListener('visibilitychange', () =>
    document.hidden ? pause('hidden') : resume('hidden')
  );
  // вне экрана — не крутим (IntersectionObserver: дёшево и без 60fps-цикла)
  new IntersectionObserver((entries) => {
    entries.forEach((entry) => (entry.isIntersecting ? resume('offscreen') : pause('offscreen')));
  }).observe(carouselEl);

  // ---- модалка ---------------------------------------------------------------

  function fillModal() {
    const s = SERVICES[current];
    modalVisual.textContent = s.icon;
    modalTag.textContent = s.tag;
    modalTitle.textContent = s.title;
    modalDesc.textContent = s.desc;
    modalSpecs.innerHTML = Object.entries(s.specs)
      .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
      .join('');
  }

  function openModal() {
    fillModal();
    modalEl.hidden = false;
    document.body.style.overflow = 'hidden';
    pause('modal');
  }

  function closeModal() {
    modalEl.hidden = true;
    document.body.style.overflow = '';
    resume('modal');
  }

  modalEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModal();
  });
  document.getElementById('ov-modal-prev').addEventListener('click', () => step(-1));
  document.getElementById('ov-modal-next').addEventListener('click', () => step(1));
  document.addEventListener('keydown', (e) => {
    if (modalEl.hidden) return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  // листание внутри модалки обновляет содержимое: карусель синхронно центрирует
  // (класс active меняется на дочерних карточках — subtree обязателен)
  const syncFromCarousel = () => { if (!modalEl.hidden) fillModal(); };
  new MutationObserver(syncFromCarousel).observe(stageEl, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });

  // ---- остальное --------------------------------------------------------------

  document.getElementById('ov-form').addEventListener('submit', function (e) {
    e.preventDefault();
    document.getElementById('ov-form-note').hidden = false;
    this.reset();
  });

  const burger = document.getElementById('ov-burger');
  const nav = document.getElementById('ov-nav');
  burger.addEventListener('click', () => nav.classList.toggle('ov-nav--open'));
  nav.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') nav.classList.remove('ov-nav--open');
  });

  buildCards();
  render();
  schedule();
})();
