(() => {
  'use strict';

  // Моковые данные: как будто уже спарсили отзывы и выделили боли.
  const MOCK_REVIEWS = [
    {
      source: 'yandex',
      sourceLabel: 'Яндекс Карты',
      org: 'Кофейня «Зерно»',
      pain: 'Очередь / скорость',
      quote: 'Ждала капучино 25 минут, хотя в зале было пусто. Бариста один на всё.',
      rating: 2,
      date: '2026-09-20',
    },
    {
      source: '2gis',
      sourceLabel: '2ГИС',
      org: 'Автосервис «Пит-Стоп»',
      pain: 'Цена / обман',
      quote: 'Назвали одну цену по телефону, по факту выставили счёт в два раза больше.',
      rating: 1,
      date: '2026-09-18',
    },
    {
      source: 'yandex',
      sourceLabel: 'Яндекс Карты',
      org: 'Стоматология «Улыбка»',
      pain: 'Запись / доступность',
      quote: 'Записаться невозможно: ближайшее окно через 3 недели, телефон не отвечает.',
      rating: 2,
      date: '2026-09-15',
    },
    {
      source: '2gis',
      sourceLabel: '2ГИС',
      org: 'Барбершоп «Лезвие»',
      pain: 'Запись / доступность',
      quote: 'Записывался онлайн, пришёл — моего мастера нет, предложили «подождать часок».',
      rating: 2,
      date: '2026-09-12',
    },
    {
      source: 'yandex',
      sourceLabel: 'Яндекс Карты',
      org: 'Доставка «БыстроЕдим»',
      pain: 'Доставка / сроки',
      quote: 'Заказ ехал 2,5 часа вместо 40 минут, привезли холодным. Компенсации нет.',
      rating: 1,
      date: '2026-09-10',
    },
    {
      source: '2gis',
      sourceLabel: '2ГИС',
      org: 'Кофейня «Зерно»',
      pain: 'Очередь / скорость',
      quote: 'Утром постоянно очередь из 10+ человек и один бариста. Ушёл без кофе.',
      rating: 2,
      date: '2026-09-08',
    },
  ];

  const tbody = document.getElementById('reviews-body');
  const statsEl = document.getElementById('stats');

  function renderStats(reviews) {
    const total = reviews.length;
    const byPain = new Map();
    for (const r of reviews) {
      byPain.set(r.pain, (byPain.get(r.pain) || 0) + 1);
    }
    const topPain = [...byPain.entries()].sort((a, b) => b[1] - a[1])[0];
    const orgs = new Set(reviews.map((r) => r.org)).size;

    const items = [
      { value: total, label: 'Негативных отзывов' },
      { value: orgs, label: 'Организаций под наблюдением' },
      { value: topPain ? `${topPain[0]} (${topPain[1]})` : '—', label: 'Топ-боль' },
    ];

    statsEl.innerHTML = items
      .map(
        (s) => `
        <div class="pr-stat">
          <span class="pr-stat__value">${s.value}</span>
          <span class="pr-stat__label">${s.label}</span>
        </div>`
      )
      .join('');
  }

  function renderTable(reviews) {
    tbody.innerHTML = reviews
      .map(
        (r) => `
        <tr>
          <td><span class="pr-source pr-source--${r.source}">${r.sourceLabel}</span></td>
          <td>${r.org}</td>
          <td class="pr-pain">${r.pain}</td>
          <td class="pr-quote">«${r.quote}»</td>
          <td class="pr-rating">★ ${r.rating}</td>
          <td>${r.date}</td>
        </tr>`
      )
      .join('');
  }

  renderStats(MOCK_REVIEWS);
  renderTable(MOCK_REVIEWS);
})();
