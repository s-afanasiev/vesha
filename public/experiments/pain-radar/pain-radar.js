(() => {
  'use strict';

  // Дашборд «Радар болей», v1 на демо-данных (состав экранов — docs/pain-radar/pain-radar-review.md, раздел Г).
  // Точка сборки: DEMO и DemoJobs стоят на месте будущего клиента /api/pain-radar/*.
  // Вьюхи получают данные и снимки джобы и не знают, откуда те пришли.
  function main() {
    const tabs = new Tabs(byId('pr-tabs'), 'map');
    const runs = new RunsHistory(byId('history-body'), DEMO.history, tabs);
    const painMap = new PainMapView(DEMO.map, tabs);
    const collect = new CollectView(new DemoJobs({ tickMs: 140 }), runs, painMap);
    const ideas = new IdeasView(DEMO.map, DEMO.ideas, painMap, runs);
    [tabs, runs, painMap, collect, ideas].forEach((part) => part.run());
    setupAdminConsole();
  }

  // ---------- Служебная часть: пульт сбора 2ГИС (видимость — experiment_tile_parts) ----------

  function setupAdminConsole() {
    fetch('/api/experiments')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || !data.admin) return;
        const tile = (data.tiles || []).find((t) => t.id === 'pain-radar');
        const part = tile && (tile.parts || []).find((p) => p.key === 'scrape');
        if (!part) return;
        const button = byId('tab-scrape');
        button.hidden = false;
        let loaded = false;
        const ensure = () => {
          if (loaded) return;
          loaded = true;
          const script = document.createElement('script');
          script.src = './scrape-console.js?v=' + Date.now(); // против устаревшего кэша при правках пульта
          script.onload = () => window.initScrapeConsole && window.initScrapeConsole();
          document.body.appendChild(script);
        };
        button.addEventListener('click', ensure);
        if (window.location.hash === '#scrape') ensure();
      })
      .catch(() => {});
  }

  // ---------- Демо-данные: срез «Автосервисы · Томск · 12 месяцев» ----------

  const DEMO = {
    map: {
      orgs: 42,
      orgsFailed: 1,
      reviews: 3180,
      negative: { strict: 371, withFourStars: 412 },
      pains: { strict: 557, withFourStars: 606 },
      scannedAt: '26.09.2026',
      freshness: '3 дня',
      taxonomy: 'v1',
      model: 'gemini-2.5-flash',
      minOrgs: 3,
      categories: [
        {
          id: 'booking',
          title: 'Запись и доступность',
          software: 'онлайн-запись, напоминания',
          soft: true,
          orgs: 22,
          orgsStrict: 21,
          complaints: 118,
          fromFourStars: 12,
          trend: 'up',
          churn: 14,
          quotes: [
            { text: 'Дозвониться невозможно, в итоге записался через знакомого. Больше не поеду.', org: 'Пит-Стоп', date: '12.09.2026', rating: 2, churn: true },
            { text: 'Записали на 10:00, приехал — бокс занят, мастер про запись не знал.', org: 'Гараж №1', date: '03.09.2026', rating: 1 },
            { text: 'Ремонт хороший, но записаться можно только по телефону, и он вечно занят.', org: 'Бокс 24', date: '28.08.2026', rating: 4 },
          ],
          leads: [
            { org: 'Пит-Стоп', complaints: 9, last: '12.09.2026', solution: 'нет записи', hasSolution: false, replies: false, score: 'hot' },
            { org: 'Гараж №1', complaints: 7, last: '03.09.2026', solution: 'нет записи', hasSolution: false, replies: true, score: 'hot' },
            { org: 'Бокс 24', complaints: 6, last: '28.08.2026', solution: 'нет записи', hasSolution: false, replies: true, score: 'hot' },
            { org: 'Мотор-Сервис', complaints: 6, last: '21.08.2026', solution: 'виджет записи', hasSolution: true, replies: true, score: 'warm' },
            { org: 'Колесо-Центр', complaints: 4, last: '30.06.2026', solution: 'нет записи', hasSolution: false, replies: false, score: 'warm' },
            { org: 'СТО Северная', complaints: 3, last: '17.05.2026', solution: 'нет записи', hasSolution: false, replies: false, score: 'warm' },
            { org: 'АвтоМастер', complaints: 3, last: '14.03.2026', solution: 'виджет записи', hasSolution: true, replies: false, score: 'cold' },
          ],
        },
        {
          id: 'price',
          title: 'Цена и обман',
          software: 'онлайн-прайс, калькулятор',
          soft: true,
          orgs: 19,
          orgsStrict: 19,
          complaints: 96,
          fromFourStars: 8,
          trend: 'flat',
          churn: 9,
          quotes: [
            { text: 'По телефону сказали 3 тысячи, в счёте оказалось 7. Про допработы не предупредили.', org: 'Колесо-Центр', date: '18.09.2026', rating: 1, churn: true },
            { text: 'Цены нигде нет, каждый раз называют разную сумму.', org: 'Мотор-Сервис', date: '29.08.2026', rating: 2 },
          ],
          leads: [
            { org: 'Колесо-Центр', complaints: 8, last: '18.09.2026', solution: 'нет прайса', hasSolution: false, replies: false, score: 'hot' },
            { org: 'Мотор-Сервис', complaints: 5, last: '29.08.2026', solution: 'нет прайса', hasSolution: false, replies: true, score: 'hot' },
            { org: 'Пит-Стоп', complaints: 4, last: '02.08.2026', solution: 'прайс на сайте', hasSolution: true, replies: false, score: 'warm' },
            { org: 'СТО Северная', complaints: 3, last: '12.06.2026', solution: 'нет прайса', hasSolution: false, replies: false, score: 'cold' },
          ],
        },
        {
          id: 'comm',
          title: 'Коммуникация',
          software: 'CRM, приём заявок',
          soft: true,
          orgs: 17,
          orgsStrict: 16,
          complaints: 84,
          fromFourStars: 7,
          trend: 'up',
          churn: 6,
          quotes: [
            { text: 'Обещали перезвонить, когда машина будет готова. Три дня тишины.', org: 'Гараж №1', date: '21.09.2026', rating: 2 },
            { text: 'В мессенджере прочитали и не ответили.', org: 'АвтоМастер', date: '10.09.2026', rating: 3 },
          ],
          leads: [
            { org: 'Гараж №1', complaints: 6, last: '21.09.2026', solution: 'нет чата', hasSolution: false, replies: true, score: 'hot' },
            { org: 'АвтоМастер', complaints: 5, last: '10.09.2026', solution: 'чат есть', hasSolution: true, replies: false, score: 'warm' },
            { org: 'Пит-Стоп', complaints: 3, last: '15.07.2026', solution: 'нет чата', hasSolution: false, replies: false, score: 'warm' },
          ],
        },
        {
          id: 'speed',
          title: 'Сроки ремонта',
          software: 'статус заказа, уведомления',
          soft: true,
          orgs: 14,
          orgsStrict: 12,
          complaints: 71,
          fromFourStars: 9,
          trend: 'down',
          churn: 5,
          quotes: [
            { text: 'Обещали за день, машина простояла неделю, и никто не предупредил.', org: 'Техцентр Южный', date: '15.09.2026', rating: 2, churn: true },
            { text: 'Всё сделали хорошо, но ждал четыре часа вместо двух.', org: 'Бокс 24', date: '02.09.2026', rating: 4 },
          ],
          leads: [
            { org: 'Техцентр Южный', complaints: 7, last: '15.09.2026', solution: 'нет статуса заказа', hasSolution: false, replies: true, score: 'hot' },
            { org: 'Бокс 24', complaints: 4, last: '02.09.2026', solution: 'нет статуса заказа', hasSolution: false, replies: true, score: 'warm' },
          ],
        },
        {
          id: 'stock',
          title: 'Наличие запчастей',
          software: 'складской учёт, остатки',
          soft: true,
          orgs: 9,
          orgsStrict: 9,
          complaints: 38,
          fromFourStars: 3,
          trend: 'flat',
          churn: 3,
          quotes: [
            { text: 'Сказали по телефону, что запчасть есть. Приехал — нет, заказывать неделю.', org: 'СТО Северная', date: '08.09.2026', rating: 2 },
          ],
          leads: [
            { org: 'СТО Северная', complaints: 4, last: '08.09.2026', solution: 'нет витрины остатков', hasSolution: false, replies: false, score: 'hot' },
            { org: 'Колесо-Центр', complaints: 2, last: '11.07.2026', solution: 'нет витрины остатков', hasSolution: false, replies: false, score: 'cold' },
          ],
        },
        {
          id: 'info',
          title: 'Нет информации',
          software: 'мини-сайт, карточка на картах',
          soft: true,
          orgs: 6,
          orgsStrict: 6,
          complaints: 21,
          fromFourStars: 2,
          trend: 'down',
          churn: 1,
          quotes: [
            { text: 'На карте старый адрес и неправильный режим работы, приехал к закрытым воротам.', org: 'Бокс 24', date: '27.08.2026', rating: 2 },
          ],
          leads: [
            { org: 'Бокс 24', complaints: 3, last: '27.08.2026', solution: 'нет сайта', hasSolution: false, replies: true, score: 'warm' },
            { org: 'Гараж №1', complaints: 1, last: '02.05.2026', solution: 'сайт есть', hasSolution: true, replies: true, score: 'cold' },
          ],
        },
        {
          id: 'quality',
          title: 'Качество работ',
          software: 'слабо мапится на софт',
          soft: false,
          orgs: 25,
          orgsStrict: 24,
          complaints: 131,
          fromFourStars: 6,
          trend: 'flat',
          churn: 17,
          quotes: [
            { text: 'После ремонта через два дня снова загорелся тот же датчик.', org: 'Мотор-Сервис', date: '19.09.2026', rating: 1, churn: true },
            { text: 'Поменяли не ту деталь, пришлось возвращаться.', org: 'Колесо-Центр', date: '05.09.2026', rating: 2 },
          ],
          leads: [],
        },
        {
          id: 'rude',
          title: 'Грубость персонала',
          software: 'слабо мапится на софт',
          soft: false,
          orgs: 11,
          orgsStrict: 11,
          complaints: 47,
          fromFourStars: 2,
          trend: 'flat',
          churn: 6,
          quotes: [
            { text: 'Мастер разговаривал через губу, на вопросы отвечал раздражённо.', org: 'Техцентр Южный', date: '11.09.2026', rating: 2 },
          ],
          leads: [],
        },
      ],
    },
    ideas: [
      {
        title: 'Онлайн-запись с напоминаниями для автосервисов',
        pains: ['booking', 'comm'],
        quoteFrom: 'booking',
        why: 'Продажи и 1С — сможете и продавать, и внедрять: у большинства носителей боли записи на карточке нет.',
        start: 'Старт: около 300 тыс ₽, 2–3 месяца до первых платящих.',
        clientsFrom: 'booking',
      },
      {
        title: 'Уведомления о статусе ремонта в мессенджере',
        pains: ['speed', 'comm'],
        quoteFrom: 'speed',
        why: 'Жалобы на сроки почти всегда про неизвестность: клиент не знает, что с машиной. Рассылка статусов снимает заметную часть негатива.',
        start: 'Старт: около 150 тыс ₽, пилот на 3–5 СТО.',
        clientsFrom: 'speed',
      },
      {
        title: 'Прозрачный калькулятор ремонта с фиксированной сметой',
        pains: ['price'],
        quoteFrom: 'price',
        why: 'Опыт ремонта поможет собрать честный прайс типовых работ, а жалобы на «цену по телефону» — готовый аргумент для владельца.',
        start: 'Старт: около 200 тыс ₽, 2 месяца на прайс и виджет.',
        clientsFrom: 'price',
      },
    ],
    history: [
      { date: '27.09.2026', kind: 'Идеи', query: 'продажи, 1С · Томск', result: '3 идеи', open: 'ideas' },
      { date: '26.09.2026', kind: 'Сбор', query: 'Автосервисы · Томск · 2ГИС', result: 'Готово: 41 из 42, 1 не собрана (антибот)', open: 'map' },
      { date: '20.09.2026', kind: 'Сбор', query: 'Пит-Стоп, по ссылке', result: 'Готово: 64 отзыва', open: 'map' },
      { date: '14.09.2026', kind: 'Сбор', query: 'Стоматологии · Томск · 2ГИС', result: 'Остановлен: источник изменился — 3 одинаковые ошибки подряд', open: 'collect' },
    ],
  };

  const TRENDS = {
    up: { symbol: '↑', label: 'растёт' },
    flat: { symbol: '→', label: 'без изменений' },
    down: { symbol: '↓', label: 'снижается' },
  };

  const SCORES = {
    hot: { label: 'горячий', css: 'pr-pill--hot' },
    warm: { label: 'тёплый', css: '' },
    cold: { label: 'холодный', css: 'pr-pill--cold' },
  };

  const LEADS_PREVIEW = 5;
  const TWO_GIS_URL = /^https?:\/\/(www\.)?2gis\.[a-z.]+\/\S+/i;
  const FOUR_STAR_CAVEAT = /(^|[\s,.;:—-])(но|однако|к сожалению)([\s,.;:!—-]|$)|единственн\S* минус/i;

  // Мини-версия будущего NegativeReviewRule: ≤ 3★, 4★ с оговоркой или без оценки.
  const isNegative = (review) =>
    review.rating === null || review.rating <= 3 || (review.rating === 4 && FOUR_STAR_CAVEAT.test(review.text));

  // В демо-проверке идеи слова идеи сопоставляются с категориями болей.
  const IDEA_TOPICS = [
    { category: 'booking', pattern: /запис|брон|расписан|очеред/i },
    { category: 'price', pattern: /цен|прайс|смет|калькул|стоимост/i },
    { category: 'comm', pattern: /звон|чат|мессендж|crm|срм|заявк/i },
    { category: 'speed', pattern: /срок|статус|уведомл|трек/i },
    { category: 'stock', pattern: /запчаст|склад|налич|остат/i },
    { category: 'info', pattern: /сайт|карточк|информац|режим работ/i },
  ];

  // ---------- Вкладки ----------

  class Tabs {
    constructor(root, fallback) {
      this.root = root;
      this.fallback = fallback;
      this.buttons = Array.from(root.querySelectorAll('[data-tab]'));
    }

    run() {
      this.buttons.forEach((button) => button.addEventListener('click', () => this.show(button.dataset.tab)));
      this.root.addEventListener('keydown', (event) => this.onKey(event));
      window.addEventListener('hashchange', () => this.show(this.fromHash(), { keepHash: true }));
      this.show(this.fromHash(), { keepHash: true });
    }

    fromHash() {
      const name = window.location.hash.slice(1);
      return this.buttons.some((button) => button.dataset.tab === name) ? name : this.fallback;
    }

    show(name, { keepHash = false } = {}) {
      this.buttons.forEach((button) => {
        const active = button.dataset.tab === name;
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        byId(button.getAttribute('aria-controls')).hidden = !active;
      });
      if (!keepHash) window.history.replaceState(null, '', `#${name}`);
    }

    onKey(event) {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const index = this.buttons.indexOf(document.activeElement);
      if (index < 0) return;
      const step = event.key === 'ArrowRight' ? 1 : -1;
      const next = this.buttons[(index + step + this.buttons.length) % this.buttons.length];
      next.focus();
      this.show(next.dataset.tab);
    }
  }

  // ---------- Карта болей ----------

  class PainMapView {
    constructor(data, tabs) {
      this.data = data;
      this.tabs = tabs;
      this.selected = data.categories[0].id;
      this.allLeads = false;
      this.el = {
        city: byId('map-city'),
        niche: byId('map-niche'),
        period: byId('map-period'),
        fourStars: byId('map-four-stars'),
        softOnly: byId('map-soft-only'),
        context: byId('map-context'),
        kpis: byId('map-kpis'),
        measure: byId('map-rank-measure'),
        rank: byId('map-rank'),
        meta: byId('map-rank-meta'),
        detail: byId('map-detail'),
      };
    }

    run() {
      const { city, niche, period, fourStars, softOnly } = this.el;
      [city, niche, period, fourStars, softOnly].forEach((input) =>
        input.addEventListener('change', () => this.render())
      );
      document
        .querySelectorAll('input[name="map-metric"]')
        .forEach((input) => input.addEventListener('change', () => this.render()));
      this.el.rank.addEventListener('click', (event) => {
        const row = event.target.closest('[data-category]');
        if (row) this.select(row.dataset.category);
      });
      this.el.kpis.addEventListener('click', (event) => {
        if (event.target.closest('[data-action="refresh"]')) this.tabs.show('collect');
      });
      this.el.detail.addEventListener('click', (event) => {
        const action = event.target.closest('[data-action]');
        if (!action) return;
        if (action.dataset.action === 'more-leads') {
          this.allLeads = true;
          this.renderDetail();
        }
        if (action.dataset.action === 'export-leads') this.exportLeads();
      });
      this.render();
    }

    get metric() {
      return checkedValue('map-metric') || 'share';
    }

    get withFourStars() {
      return this.el.fourStars.checked;
    }

    get periodLabel() {
      return this.el.period.selectedOptions[0].textContent;
    }

    category(id) {
      return this.data.categories.find((category) => category.id === id);
    }

    orgsOf(category) {
      return this.withFourStars ? category.orgs : category.orgsStrict;
    }

    complaintsOf(category) {
      return this.withFourStars ? category.complaints : category.complaints - category.fromFourStars;
    }

    visibleCategories() {
      const score = (category) => (this.metric === 'share' ? this.orgsOf(category) : this.complaintsOf(category));
      return this.data.categories
        .filter((category) => category.soft || !this.el.softOnly.checked)
        .sort((a, b) => score(b) - score(a));
    }

    select(id) {
      this.selected = id;
      this.allLeads = false;
      this.renderRank();
      this.renderDetail();
    }

    reveal(id) {
      if (!this.category(id).soft) this.el.softOnly.checked = false;
      this.tabs.show('map');
      this.select(id);
      this.el.detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    markFresh() {
      this.data.freshness = 'только что';
      this.data.scannedAt = todayLabel();
      this.renderKpis();
    }

    render() {
      this.el.context.textContent = `${this.el.niche.value} · ${this.el.city.value} · ${this.periodLabel} · демо-срез, фильтры заработают вместе с API`;
      this.renderKpis();
      this.renderRank();
      this.renderDetail();
    }

    renderKpis() {
      const data = this.data;
      const negative = this.withFourStars ? data.negative.withFourStars : data.negative.strict;
      const pains = this.withFourStars ? data.pains.withFourStars : data.pains.strict;
      const refresh = '<button type="button" class="pr-link-btn" data-action="refresh">обновить</button>';
      this.el.kpis.innerHTML = [
        kpiHtml('Организаций', fmt(data.orgs), `${data.orgsFailed} не собрана: антибот`),
        kpiHtml('Отзывов всего', fmt(data.reviews), this.periodLabel),
        kpiHtml('Негативных', fmt(negative), `${pct(negative, data.reviews)}% · в них ${fmt(pains)} болей`),
        kpiHtml('Свежесть', data.freshness, `скан ${data.scannedAt} · `, refresh),
      ].join('');
    }

    renderRank() {
      const share = this.metric === 'share';
      const categories = this.visibleCategories();
      if (!categories.some((category) => category.id === this.selected)) this.selected = categories[0].id;
      const maxComplaints = Math.max(...categories.map((category) => this.complaintsOf(category)));
      this.el.measure.textContent = share ? 'Доля организаций с болью' : 'Число жалоб';
      this.el.rank.innerHTML = categories
        .map((category) => {
          const orgs = this.orgsOf(category);
          const complaints = this.complaintsOf(category);
          const width = share ? pct(orgs, this.data.orgs) : pct(complaints, maxComplaints);
          const value = share ? `${orgs} из ${this.data.orgs}` : `${fmt(complaints)} жалоб`;
          const trend = TRENDS[category.trend];
          const title = `${category.title}: ${orgs} из ${this.data.orgs} организаций (${pct(orgs, this.data.orgs)}%), ${complaints} жалоб`;
          return `
            <button type="button" class="pr-rank__row" data-category="${category.id}"
              aria-pressed="${category.id === this.selected}" title="${esc(title)}">
              <span class="pr-rank__label">
                <span class="pr-rank__name">${esc(category.title)}</span>
                <span class="pr-rank__soft">${esc(category.software)}</span>
              </span>
              <span class="pr-bar" aria-hidden="true"><span class="pr-bar__fill" style="width:${width}%"></span></span>
              <span class="pr-rank__value">${value}</span>
              <span class="pr-trend" title="${trend.label}" aria-label="тренд: ${trend.label}">${trend.symbol}</span>
            </button>`;
        })
        .join('');
      const data = this.data;
      this.el.meta.textContent = `Разметка: таксономия ${data.taxonomy} · ${data.model} · боль засчитана нише, если есть у ${data.minOrgs}+ организаций`;
    }

    renderDetail() {
      const category = this.category(this.selected);
      const orgs = this.orgsOf(category);
      const quotes = category.quotes.filter((quote) => this.withFourStars || quote.rating <= 3);
      const churn = category.churn
        ? `<span class="pr-pill pr-pill--accent" title="Маркер ухода: «ушёл к другим», «больше не приеду»">↩ ${category.churn} ушли к другим</span>`
        : '';
      const exportButton =
        category.soft && category.leads.length
          ? '<button type="button" class="vesha-btn vesha-btn--sm vesha-btn--outline" data-action="export-leads">Выгрузить лиды (CSV)</button>'
          : '';
      const about = category.soft
        ? `Какой софт напрашивается: ${esc(category.software)}.`
        : 'Категория слабо мапится на софт: полезна генератору идей, лид-скоринг для неё не считаем.';
      this.el.detail.innerHTML = `
        <div class="pr-card__head">
          <div class="pr-detail__title"><h2>${esc(category.title)}</h2>${churn}</div>
          ${exportButton}
        </div>
        <p class="pr-hint">${about} Жалоб за период: ${fmt(this.complaintsOf(category))}, у ${orgs} из ${this.data.orgs} организаций.</p>
        <div class="pr-section-title">Цитаты</div>
        <div class="pr-quotes">
          ${quotes.map(quoteHtml).join('') || '<p class="pr-hint">Без отзывов 4★ с оговоркой цитат в этой категории нет.</p>'}
        </div>
        ${category.soft ? this.leadsHtml(category, orgs) : ''}`;
    }

    leadsHtml(category, orgs) {
      if (!category.leads.length) return '';
      const shown = this.allLeads ? category.leads : category.leads.slice(0, LEADS_PREVIEW);
      const rest = category.leads.length - shown.length;
      const more = rest
        ? `<button type="button" class="vesha-btn vesha-btn--sm vesha-btn--outline" data-action="more-leads">Показать ещё ${rest}</button>`
        : '';
      return `
        <div class="pr-section-title">Носители боли — топ по лид-скорингу (${category.leads.length} из ${orgs})</div>
        <div class="pr-table-wrap">
          <table class="pr-table">
            <thead>
              <tr>
                <th>Организация</th>
                <th>Жалоб</th>
                <th>Последняя</th>
                <th>Решение на карточке</th>
                <th>Отвечает на отзывы</th>
                <th>Лид</th>
              </tr>
            </thead>
            <tbody>${shown.map(leadRowHtml).join('')}</tbody>
          </table>
        </div>
        ${more}`;
    }

    exportLeads() {
      const category = this.category(this.selected);
      const rows = [['Организация', 'Жалоб', 'Последняя жалоба', 'Решение на карточке', 'Отвечает на отзывы', 'Лид']].concat(
        category.leads.map((lead) => [
          lead.org,
          lead.complaints,
          lead.last,
          lead.solution,
          lead.replies ? 'да' : 'нет',
          SCORES[lead.score].label,
        ])
      );
      downloadCsv(`pain-radar-leads-${category.id}.csv`, rows);
    }
  }

  // ---------- Сбор ----------

  class CollectView {
    constructor(jobs, runs, painMap) {
      this.jobs = jobs;
      this.runs = runs;
      this.painMap = painMap;
      this.job = null;
      this.el = {
        url: byId('collect-url'),
        city: byId('collect-city'),
        niche: byId('collect-niche'),
        max: byId('collect-max'),
        maxOut: byId('collect-max-out'),
        paste: byId('collect-paste'),
        depth: byId('collect-depth'),
        llm: byId('collect-llm'),
        llmBox: byId('collect-llm-box'),
        error: byId('collect-error'),
        run: byId('collect-run'),
      };
      this.card = new JobCard(byId('collect-job'), () => this.job && this.job.cancel());
    }

    run() {
      document.querySelectorAll('input[name="collect-mode"]').forEach((input) =>
        input.addEventListener('change', () => {
          showModeGroups('data-collect-mode', this.mode);
          this.clearError();
        })
      );
      this.el.max.addEventListener('input', () => {
        this.el.maxOut.textContent = this.el.max.value;
      });
      this.el.llm.addEventListener('change', () => {
        this.el.llmBox.hidden = !this.el.llm.checked;
      });
      [this.el.url, this.el.paste].forEach((input) => input.addEventListener('input', () => this.clearError()));
      this.el.run.addEventListener('click', () => this.start());
      showModeGroups('data-collect-mode', this.mode);
    }

    get mode() {
      return checkedValue('collect-mode') || 'url';
    }

    start() {
      if (this.job && this.job.isRunning()) {
        this.showError('Сбор уже идёт — дождитесь окончания или отмените его.');
        return;
      }
      const request = this.readRequest();
      if (request.error) {
        this.showError(request.error, request.field);
        return;
      }
      this.clearError();
      this.card.open(request.title);
      this.job = this.jobs.start(request, (snapshot) => this.onSnapshot(request, snapshot));
    }

    readRequest() {
      const base = { mode: this.mode, depth: Number(this.el.depth.value), llm: this.el.llm.checked };
      if (base.mode === 'url') {
        const url = this.el.url.value.trim();
        if (!url) return { error: 'Вставьте ссылку на карточку организации в 2ГИС.', field: this.el.url };
        if (!TWO_GIS_URL.test(url)) {
          return { error: 'Нужна ссылка на 2ГИС вида https://2gis.ru/город/firm/…', field: this.el.url };
        }
        return { ...base, title: `Организация по ссылке · ${shortUrl(url)}` };
      }
      if (base.mode === 'niche') {
        return {
          ...base,
          title: `${this.el.niche.value} · ${this.el.city.value} · 2ГИС`,
          maxOrgs: Number(this.el.max.value),
        };
      }
      const reviews = parsePastedReviews(this.el.paste.value);
      if (!reviews.length) return { error: 'Вставьте хотя бы один отзыв.', field: this.el.paste };
      return { ...base, title: `Вставленные отзывы · ${reviews.length}`, reviews };
    }

    onSnapshot(request, snapshot) {
      this.card.update(snapshot);
      if (snapshot.status !== 'done' && snapshot.status !== 'aborted') return;
      this.runs.add({ kind: 'Сбор', query: request.title, result: snapshot.result, open: snapshot.status === 'done' ? 'map' : 'collect' });
      if (snapshot.status === 'done' && request.mode !== 'paste') this.painMap.markFresh();
    }

    showError(text, field) {
      setError(this.el.error, text);
      if (field) {
        field.classList.add('is-invalid');
        field.focus();
      }
    }

    clearError() {
      setError(this.el.error, '');
      [this.el.url, this.el.paste].forEach((field) => field.classList.remove('is-invalid'));
    }
  }

  // Карточка джобы рисует снимки. Каркас строится один раз на джобу, чтобы кнопка
  // «Отменить» не пересоздавалась на каждом тике и клик по ней не терялся.
  class JobCard {
    constructor(root, onCancel) {
      this.root = root;
      this.onCancel = onCancel;
    }

    open(title) {
      this.root.hidden = false;
      this.root.innerHTML = `
        <div class="pr-job__head">
          <span class="pr-job__title"></span>
          <span class="pr-pill" data-part="status"></span>
          <button type="button" class="vesha-btn vesha-btn--sm vesha-btn--outline" data-part="cancel">Отменить</button>
        </div>
        <p class="pr-meta" data-part="meta"></p>
        <ol class="pr-steps" data-part="steps"></ol>
        <p class="pr-job__summary" data-part="summary" hidden></p>`;
      this.part('title').textContent = title;
      this.part('cancel').addEventListener('click', () => this.onCancel());
    }

    part(name) {
      return name === 'title' ? this.root.querySelector('.pr-job__title') : this.root.querySelector(`[data-part="${name}"]`);
    }

    update(snapshot) {
      const status = JOB_STATUS[snapshot.status];
      const running = snapshot.status === 'queued' || snapshot.status === 'running';
      const statusEl = this.part('status');
      statusEl.className = `pr-pill ${status.css}`;
      statusEl.textContent = status.label;
      this.part('cancel').hidden = !running;
      this.part('meta').textContent = jobMeta(snapshot);
      this.part('steps').innerHTML = snapshot.steps.map(stepHtml).join('');
      const summary = this.part('summary');
      summary.hidden = !snapshot.summary;
      summary.textContent = snapshot.summary;
    }
  }

  const JOB_STATUS = {
    queued: { label: 'в очереди', css: 'pr-pill--accent' },
    running: { label: 'идёт', css: 'pr-pill--accent' },
    done: { label: 'готово', css: 'pr-pill--ok' },
    aborted: { label: 'отменён', css: 'pr-pill--hot' },
  };

  const STEP_VIEW = {
    pending: { icon: '○', label: 'ещё не начат' },
    active: { icon: '…', label: 'идёт' },
    done: { icon: '✓', label: 'готово' },
    skipped: { icon: '–', label: 'пропущен' },
    aborted: { icon: '✕', label: 'отменён' },
  };

  function jobMeta(snapshot) {
    if (snapshot.status === 'queued') return 'В очереди: вы первые · дедлайн сбора 30 минут';
    if (snapshot.status === 'running') return `Запущен в ${timeLabel(snapshot.startedAt)} · дедлайн 30 минут`;
    return `Завершён в ${timeLabel(snapshot.finishedAt)}`;
  }

  function stepHtml(step) {
    const view = STEP_VIEW[step.status];
    const bar =
      step.status === 'active' && step.progress !== null
        ? `<div class="pr-bar" aria-hidden="true"><div class="pr-bar__fill" style="width:${Math.round(step.progress * 100)}%"></div></div>`
        : '';
    return `
      <li class="pr-step" data-status="${step.status}">
        <span class="pr-step__icon" role="img" aria-label="${view.label}">${view.icon}</span>
        <div>
          <div class="pr-step__title">${esc(step.title)}</div>
          <div class="pr-step__detail">${esc(step.detail)}</div>
          ${bar}
        </div>
      </li>`;
  }

  // ---------- Демо-джобы: имитация сбора ----------
  // Контракт тот же, что будет у клиента API: start(запрос, onSnapshot) → { cancel(), isRunning() }.

  class DemoJobs {
    constructor({ tickMs }) {
      this.tickMs = tickMs;
    }

    start(request, onSnapshot) {
      return new DemoJob(request, planSteps(request), this.tickMs, onSnapshot).run();
    }
  }

  class DemoJob {
    constructor(request, steps, tickMs, onSnapshot) {
      this.request = request;
      this.steps = steps;
      this.tickMs = tickMs;
      this.onSnapshot = onSnapshot;
      this.status = 'queued';
      this.queueTicks = 4;
      this.startedAt = null;
      this.finishedAt = null;
      this.timer = null;
    }

    run() {
      this.emit();
      this.timer = setInterval(() => this.tick(), this.tickMs);
      return this;
    }

    isRunning() {
      return this.status === 'queued' || this.status === 'running';
    }

    tick() {
      if (this.status === 'queued') {
        this.queueTicks -= 1;
        if (this.queueTicks > 0) return;
        this.status = 'running';
        this.startedAt = new Date();
      }
      const step = this.steps.find((candidate) => candidate.status === 'pending' || candidate.status === 'active');
      if (!step) {
        this.finish('done');
        return;
      }
      step.advance();
      this.emit();
    }

    cancel() {
      if (!this.isRunning()) return;
      this.steps.forEach((step) => {
        if (step.status === 'active') {
          step.status = 'aborted';
          step.detail = `Отменено · ${step.detail}`;
        } else if (step.status === 'pending') {
          step.detail = 'Не выполнялся';
        }
      });
      this.finish('aborted');
    }

    finish(status) {
      clearInterval(this.timer);
      this.status = status;
      this.finishedAt = new Date();
      this.emit();
    }

    emit() {
      this.onSnapshot({
        status: this.status,
        startedAt: this.startedAt,
        finishedAt: this.finishedAt,
        steps: this.steps.map(({ title, status, detail, progress }) => ({ title, status, detail, progress })),
        summary: this.summary(),
        result: this.result(),
      });
    }

    fetchFailures() {
      const fetch = this.steps.find((step) => step.id === 'fetch');
      return fetch ? fetch.failed : 0;
    }

    summary() {
      if (this.status === 'aborted') {
        return 'Сбор отменён. Собранное остаётся в корпусе: повторный запуск продолжит с места остановки.';
      }
      if (this.status !== 'done') return '';
      const failed = this.fetchFailures();
      const failure = failed ? ` ${failed} не удалось собрать — это строка отчёта, а не падение сбора.` : '';
      const labeled = this.request.llm
        ? ' Боли попали в корпус, карта пересчитана.'
        : ' Негатив отобран по оценке, разметка болей была выключена.';
      return `Готово.${failure}${labeled}`;
    }

    result() {
      if (this.status === 'aborted') return 'Отменён пользователем';
      if (this.status !== 'done') return '';
      const failed = this.fetchFailures();
      if (this.request.mode === 'niche') {
        const total = this.request.maxOrgs;
        return failed ? `Готово: ${total - failed} из ${total}, ${failed} не собрана (антибот)` : `Готово: ${total} из ${total}`;
      }
      if (this.request.mode === 'paste') return `Готово: ${this.request.reviews.length} отзывов разобрано`;
      return 'Готово: 186 отзывов, 27 негативных';
    }
  }

  function planSteps(request) {
    const map = new TimedStep('map', 'Сведение карты болей', 2, 'Карта обновлена');
    if (request.mode === 'paste') {
      const negative = request.reviews.filter(isNegative).length;
      return [
        new TimedStep('parse', 'Разбор вставленных отзывов', 2, `Строк: ${request.reviews.length}, в разметку: ${negative}`),
        labelStep(request, negative),
        map,
      ];
    }
    if (request.mode === 'niche') {
      const orgs = request.maxOrgs;
      return [
        new TimedStep('discover', 'Поиск организаций в каталоге 2ГИС', 4, `Найдено организаций: ${orgs}`),
        new CountingStep('fetch', 'Сбор отзывов', orgs, { unit: 'организаций', failAt: 7, failText: 'антибот' }),
        labelStep(request, orgs * 10),
        map,
      ];
    }
    return [
      new TimedStep('card', 'Карточка организации', 3, 'Найдена: 186 отзывов, 27 негативных'),
      new CountingStep('fetch', 'Сбор отзывов', 6, { unit: 'страниц' }),
      labelStep(request, 27),
      map,
    ];
  }

  function labelStep(request, negative) {
    if (!request.llm) {
      return new SkippedStep('label', 'Разметка болей', 'Пропущено: разметка выключена, только отбор негатива по оценке');
    }
    if (!negative) return new SkippedStep('label', 'Разметка болей', 'Пропущено: негативных отзывов нет');
    return new CountingStep('label', 'Разметка болей', Math.ceil(negative / 10), {
      unit: 'батчей',
      perTick: 3,
      waitTicks: 6,
      waitText: 'Ждёт LLM-слот · в очереди вторые',
    });
  }

  class TimedStep {
    constructor(id, title, ticks, doneText) {
      this.id = id;
      this.title = title;
      this.left = ticks;
      this.doneText = doneText;
      this.status = 'pending';
      this.detail = 'Ещё не начат';
      this.progress = null;
    }

    advance() {
      this.status = 'active';
      this.detail = 'Идёт…';
      this.left -= 1;
      if (this.left > 0) return;
      this.status = 'done';
      this.detail = this.doneText;
    }
  }

  class CountingStep {
    constructor(id, title, total, { unit, perTick = 1, failAt = 0, failText = '', waitTicks = 0, waitText = '' }) {
      this.id = id;
      this.title = title;
      this.total = total;
      this.unit = unit;
      this.perTick = perTick;
      this.failAt = failAt;
      this.failText = failText;
      this.wait = waitTicks;
      this.waitText = waitText;
      this.count = 0;
      this.failed = 0;
      this.status = 'pending';
      this.detail = 'Ещё не начат';
      this.progress = null;
    }

    advance() {
      this.status = 'active';
      if (this.wait > 0) {
        this.wait -= 1;
        this.detail = this.waitText;
        return;
      }
      this.count = Math.min(this.total, this.count + this.perTick);
      if (this.failAt && this.count >= this.failAt) this.failed = 1;
      this.progress = this.count / this.total;
      const failure = this.failed ? ` · ${this.failed} не удалось: ${this.failText}` : '';
      this.detail = `Обработано ${this.count} из ${this.total} ${this.unit}${failure}`;
      if (this.count >= this.total) this.status = 'done';
    }
  }

  class SkippedStep {
    constructor(id, title, reason) {
      this.id = id;
      this.title = title;
      this.status = 'skipped';
      this.detail = reason;
      this.progress = null;
    }

    advance() {}
  }

  // ---------- Идеи ----------

  class IdeasView {
    constructor(mapData, ideas, painMap, runs) {
      this.mapData = mapData;
      this.ideas = ideas;
      this.painMap = painMap;
      this.runs = runs;
      this.el = {
        city: byId('ideas-city'),
        skills: byId('ideas-skills'),
        fun: byId('ideas-fun'),
        signField: byId('ideas-sign-field'),
        sign: byId('ideas-sign'),
        idea: byId('ideas-idea'),
        error: byId('ideas-error'),
        run: byId('ideas-run'),
        llm: byId('ideas-llm'),
        result: byId('ideas-result'),
      };
    }

    run() {
      document.querySelectorAll('input[name="ideas-mode"]').forEach((input) =>
        input.addEventListener('change', () => this.switchMode())
      );
      this.el.fun.addEventListener('change', () => {
        this.el.signField.hidden = !this.el.fun.checked;
      });
      [this.el.skills, this.el.idea].forEach((input) => input.addEventListener('input', () => this.clearError()));
      this.el.run.addEventListener('click', () => this.submit());
      this.el.result.addEventListener('click', (event) => {
        const button = event.target.closest('[data-reveal]');
        if (button) this.painMap.reveal(button.dataset.reveal);
      });
      this.watchLlm();
      this.switchMode();
    }

    get mode() {
      return checkedValue('ideas-mode') || 'pick';
    }

    category(id) {
      return this.mapData.categories.find((category) => category.id === id);
    }

    withoutSolution(id) {
      return this.category(id).leads.filter((lead) => !lead.hasSolution).length;
    }

    watchLlm() {
      const llm = window.VeshaLlm;
      if (!llm) return;
      if (typeof llm.onChange === 'function') llm.onChange((detail) => this.showLlm(detail));
      if (typeof llm.ready === 'function') {
        Promise.resolve(llm.ready())
          .then(() => this.showLlm({ ready: llm.isReady() }))
          .catch(() => {});
      }
    }

    showLlm(detail) {
      if (detail.statusLabel) this.el.llm.textContent = `LLM: ${detail.statusLabel}`;
      else this.el.llm.textContent = detail.ready ? 'LLM: готова к работе' : 'LLM: нужна настройка на вкладке «Сбор»';
    }

    switchMode() {
      const pick = this.mode === 'pick';
      showModeGroups('data-ideas-mode', this.mode);
      this.el.run.textContent = pick ? 'Подобрать идеи' : 'Проверить идею';
      this.clearError();
      this.el.result.innerHTML = `<div class="pr-empty">${
        pick
          ? 'Заполните профиль — подберём идеи, каждая с жалобами-доказательствами из корпуса.'
          : 'Опишите идею — найдём в корпусе жалобы за и против.'
      }</div>`;
    }

    submit() {
      if (this.mode === 'pick') {
        const skills = this.el.skills.value.trim();
        if (!skills) {
          this.showError('Укажите хотя бы один навык — по навыкам подбираются идеи.', this.el.skills);
          return;
        }
        this.clearError();
        this.renderIdeas();
        this.runs.add({ kind: 'Идеи', query: `${skills} · ${this.el.city.value}`, result: `${this.ideas.length} идеи`, open: 'ideas' });
        return;
      }
      const idea = this.el.idea.value.trim();
      if (idea.length < 10) {
        this.showError('Опишите идею хотя бы одним предложением.', this.el.idea);
        return;
      }
      this.clearError();
      const supported = this.renderVerdict(idea);
      this.runs.add({
        kind: 'Проверка идеи',
        query: idea.length > 60 ? `${idea.slice(0, 57)}…` : idea,
        result: supported ? 'подкреплена болями' : 'похожих болей нет',
        open: 'ideas',
      });
    }

    renderIdeas() {
      const flavor = this.el.fun.checked
        ? `Тон для знака «${this.el.sign.value}»: смелее с первым шагом. Подбор от игровых полей не меняется.`
        : '';
      this.el.result.innerHTML =
        this.ideas.map((idea) => this.ideaHtml(idea, flavor)).join('') +
        '<p class="pr-meta">Демо: пример результата, профиль пока не влияет на подбор. С API идеи соберёт LLM по болям корпуса, каждая — со ссылками на них.</p>';
    }

    ideaHtml(idea, flavor) {
      const evidence = idea.pains
        .map((id) => this.category(id))
        .map(
          (category) =>
            `<span class="pr-pill pr-pill--accent">${esc(category.title.toLowerCase())} · ${category.orgs} из ${this.mapData.orgs} организаций</span>`
        )
        .join('');
      const clients = this.withoutSolution(idea.clientsFrom);
      return `
        <article class="pr-card">
          <div class="pr-card__head"><h3>${esc(idea.title)}</h3></div>
          <div class="pr-evidence">${evidence}</div>
          ${quoteHtml(this.category(idea.quoteFrom).quotes[0])}
          <p class="pr-idea__why">${esc(idea.why)}<br />${esc(idea.start)}${flavor ? `<br />${esc(flavor)}` : ''}</p>
          <div>${this.clientsButton(idea.clientsFrom, clients)}</div>
        </article>`;
    }

    clientsButton(categoryId, clients) {
      return `<button type="button" class="vesha-btn vesha-btn--sm vesha-btn--outline" data-reveal="${categoryId}">Первые клиенты: ${clients} ${plural(
        clients,
        'организация',
        'организации',
        'организаций'
      )} без решения на карточке</button>`;
    }

    renderVerdict(idea) {
      const categories = IDEA_TOPICS.filter((topic) => topic.pattern.test(idea)).map((topic) => this.category(topic.category));
      if (!categories.length) {
        this.el.result.innerHTML = `
          <article class="pr-card">
            <div class="pr-card__head"><h3>Похожих болей в корпусе нет</h3><span class="pr-pill pr-pill--cold">не подкреплена</span></div>
            <p class="pr-hint">«${esc(idea)}»</p>
            <p class="pr-idea__why">Либо спрос не проявляется в отзывах, либо нужен другой сигнал: белые пятна каталога, поисковые запросы. Демо распознаёт запись, цены, коммуникацию, сроки, запчасти и информацию на карточке.</p>
          </article>`;
        return false;
      }
      const orgs = this.mapData.orgs;
      const main = categories[0];
      const pros = categories.map(
        (category) => `${category.title}: у ${category.orgs} из ${orgs} организаций, ${category.complaints} жалоб, тренд ${TRENDS[category.trend].label}`
      );
      pros.push(`${this.withoutSolution(main.id)} носителей боли без решения на карточке — готовые первые клиенты`);
      const cons = categories
        .filter((category) => category.leads.some((lead) => lead.hasSolution))
        .map((category) => {
          const solved = category.leads.filter((lead) => lead.hasSolution).length;
          return `${category.title}: у ${solved} из ${category.leads.length} носителей решение уже есть — там продаётся внедрение, а не продукт`;
        });
      const quality = this.category('quality');
      cons.push(`${quality.title}: у ${quality.orgs} из ${orgs} организаций — это софтом не лечится, часть негатива останется`);
      const list = (items) => `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
      this.el.result.innerHTML = `
        <article class="pr-card">
          <div class="pr-card__head"><h3>Проверка идеи</h3><span class="pr-pill pr-pill--ok">подкреплена</span></div>
          <p class="pr-hint">«${esc(idea)}»</p>
          <div class="pr-verdict">
            <div><div class="pr-section-title">За</div>${list(pros)}</div>
            <div><div class="pr-section-title">Против</div>${list(cons)}</div>
          </div>
          <p class="pr-idea__why">Вердикт: боль частая, у большинства носителей решения нет — идею есть на чём проверить.</p>
          <div>${this.clientsButton(main.id, this.withoutSolution(main.id))}</div>
          <p class="pr-meta">Демо: сопоставление по ключевым словам. С API это сделает LLM по болям корпуса.</p>
        </article>`;
      return true;
    }

    showError(text, field) {
      setError(this.el.error, text);
      field.classList.add('is-invalid');
      field.focus();
    }

    clearError() {
      setError(this.el.error, '');
      [this.el.skills, this.el.idea].forEach((field) => field.classList.remove('is-invalid'));
    }
  }

  // ---------- История ----------

  class RunsHistory {
    constructor(body, rows, tabs) {
      this.body = body;
      this.rows = rows.slice();
      this.tabs = tabs;
    }

    run() {
      this.body.addEventListener('click', (event) => {
        const button = event.target.closest('[data-open]');
        if (button) this.tabs.show(button.dataset.open);
      });
      this.render();
    }

    add(row) {
      this.rows.unshift({ date: todayLabel(), ...row });
      this.render();
    }

    render() {
      this.body.innerHTML = this.rows
        .map(
          (row) => `
            <tr>
              <td class="pr-muted">${esc(row.date)}</td>
              <td>${esc(row.kind)}</td>
              <td>${esc(row.query)}</td>
              <td class="pr-dim">${esc(row.result)}</td>
              <td><button type="button" class="vesha-btn vesha-btn--sm vesha-btn--outline" data-open="${row.open}">Открыть</button></td>
            </tr>`
        )
        .join('');
    }
  }

  // ---------- Разметка и мелкие помощники ----------

  function kpiHtml(label, value, sub, extraHtml = '') {
    return `
      <div class="pr-kpi">
        <div class="pr-kpi__label">${esc(label)}</div>
        <div class="pr-kpi__value">${esc(value)}</div>
        <div class="pr-kpi__sub">${esc(sub)}${extraHtml}</div>
      </div>`;
  }

  function quoteHtml(quote) {
    const caveat = quote.rating === 4 ? ' с оговоркой' : '';
    const churn = quote.churn ? ' · ↩ ушёл к другим' : '';
    return `
      <figure class="pr-quote">
        <blockquote class="pr-quote__text">«${esc(quote.text)}»</blockquote>
        <figcaption class="pr-quote__meta">${esc(quote.org)} · 2ГИС · ${esc(quote.date)} · ★${quote.rating}${caveat} · ✓ цитата дословная${churn}</figcaption>
      </figure>`;
  }

  function leadRowHtml(lead) {
    const score = SCORES[lead.score];
    return `
      <tr>
        <td>${esc(lead.org)}</td>
        <td class="pr-num">${lead.complaints}</td>
        <td class="pr-muted">${esc(lead.last)}</td>
        <td class="pr-muted">${lead.hasSolution ? '✓' : '✕'} ${esc(lead.solution)}</td>
        <td class="pr-muted">${lead.replies ? 'да' : 'нет'}</td>
        <td><span class="pr-pill ${score.css}">${score.label}</span></td>
      </tr>`;
  }

  function parsePastedReviews(text) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^([1-5])\s*;\s*([^;]*);\s*(.+)$/);
        return match
          ? { rating: Number(match[1]), date: match[2].trim(), text: match[3].trim() }
          : { rating: null, date: '', text: line };
      });
  }

  function showModeGroups(attribute, value) {
    document.querySelectorAll(`[${attribute}]`).forEach((group) => {
      group.hidden = group.getAttribute(attribute) !== value;
    });
  }

  function setError(el, text) {
    el.textContent = text;
    el.hidden = !text;
  }

  function downloadCsv(filename, rows) {
    const cell = (value) => {
      const text = String(value);
      return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = `﻿${rows.map((row) => row.map(cell).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function shortUrl(url) {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.length > 32 ? `${parsed.pathname.slice(0, 31)}…` : parsed.pathname;
      return `${parsed.hostname}${path}`;
    } catch (_) {
      return url;
    }
  }

  function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function checkedValue(name) {
    const input = document.querySelector(`input[name="${name}"]:checked`);
    return input ? input.value : null;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value).replace(
      /[&<>"']/g,
      (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
    );
  }

  function fmt(n) {
    return Number(n).toLocaleString('ru-RU');
  }

  function pct(part, whole) {
    return whole ? Math.round((part / whole) * 100) : 0;
  }

  function todayLabel() {
    return new Date().toLocaleDateString('ru-RU');
  }

  function timeLabel(date) {
    return date ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';
  }

  main();
})();
