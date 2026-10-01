(() => {
  'use strict';

  // Дашборд «Радар идей», фаза 1: источники, счётчик ниш по неделям, лента сырья.
  // Точка сборки: вьюхи не знают друг о друге — кто кого обновляет, решает main.
  function main() {
    const api = new IdeaRadarApi('/api/idea-radar');
    const feed = new FeedView(api, {
      list: byId('feed-list'),
      empty: byId('feed-empty'),
      more: byId('feed-more'),
      reset: byId('feed-reset'),
      form: byId('feed-filters'),
      source: byId('feed-source'),
      niche: byId('feed-niche'),
      week: byId('feed-week'),
      q: byId('feed-q'),
    });
    const counts = new CountsView(api, byId('counts-table'), {
      onPick: (filter) => feed.show(filter),
      onLoaded: (data) => feed.setVocabulary(data.niches, data.weeks),
    });
    const sources = new SourcesView(api, byId('sources-body'), byId('poll-status'), byId('poll-all'), {
      onSources: (list) => feed.setSources(list),
      onPolled: () => {
        counts.load();
        feed.load();
      },
    });
    feed.onFilterChange = (filter) => counts.highlight(filter);
    [sources, counts, feed].forEach((part) => part.load());
  }

  // ---------- Клиент API ----------

  class IdeaRadarApi {
    constructor(base) {
      this.base = base;
    }

    async request(path, options = {}) {
      const res = await fetch(this.base + path, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
      return data;
    }

    sources() {
      return this.request('/sources');
    }

    poll(slug) {
      return this.request('/polls', {
        method: 'POST',
        body: JSON.stringify(slug ? { source: slug } : {}),
      });
    }

    publications(params) {
      const query = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== '' && value !== null && value !== undefined) query.set(key, value);
      });
      return this.request(`/publications?${query}`);
    }

    keywords(weeks) {
      return this.request(`/keywords?weeks=${weeks}`);
    }
  }

  // ---------- Источники ----------

  const KIND_LABELS = {
    gov: 'госакты',
    news: 'новости',
    events: 'события',
    jobs: 'вакансии',
    initiatives: 'инициативы',
    serendipity: 'случайное',
  };

  const OUTCOME_LABELS = {
    ok: 'ок',
    partial: 'частично',
    failed: 'ошибка',
    skipped: 'пропущен',
  };

  class SourcesView {
    constructor(api, body, status, pollAllBtn, { onSources, onPolled }) {
      this.api = api;
      this.body = body;
      this.status = status;
      this.pollAllBtn = pollAllBtn;
      this.onSources = onSources;
      this.onPolled = onPolled;
      this.busy = false;
      this.pollAllBtn.addEventListener('click', () => this.poll(null));
    }

    async load() {
      try {
        const { sources } = await this.api.sources();
        this.render(sources);
      } catch (err) {
        this.say(`Не удалось загрузить источники: ${err.message}`, true);
      }
    }

    render(sources) {
      this.onSources(sources);
      this.body.replaceChildren(...sources.map((source) => this.row(source)));
    }

    row(source) {
      const pollBtn = el('button', {
        type: 'button',
        class: 'vesha-btn vesha-btn--outline vesha-btn--sm',
        text: 'Опросить',
        disabled: this.busy,
      });
      pollBtn.addEventListener('click', () => this.poll(source.slug));

      const sub = el('span', { class: 'ir-source-sub' }, [
        el('span', { class: 'ir-chip', text: KIND_LABELS[source.kind] || source.kind }),
        el('span', { text: [source.region, source.rubric].filter(Boolean).join(' · ') }),
      ]);
      const name = el('div', { class: 'ir-source-name' }, [
        el('a', { href: source.siteUrl, target: '_blank', rel: 'noopener', text: source.name }),
        sub,
      ]);

      return el('tr', {}, [
        el('td', {}, [name]),
        el('td', {}, [this.pollCell(source)]),
        el('td', { class: 'ir-num', text: source.lastPoll ? String(source.lastPoll.itemsNew) : '—' }),
        el('td', { class: 'ir-num', text: String(source.total) }),
        el('td', { class: 'ir-poll-when', text: source.latestPublishedAt ? formatDateTime(source.latestPublishedAt) : '—' }),
        el('td', {}, [pollBtn]),
      ]);
    }

    pollCell(source) {
      const poll = source.lastPoll;
      if (!poll) return el('span', { class: 'ir-poll-when', text: 'ещё не опрашивали' });
      const outcome = poll.outcome || 'running';
      const health = source.health.polls3d
        ? `за 3 дня: ${source.health.polls3d} опр., ошибок ${source.health.failed3d}`
        : '';
      return el('div', { class: 'ir-poll-cell' }, [
        el('span', {}, [
          el('span', {
            class: `ir-outcome ir-outcome--${outcome}`,
            text: OUTCOME_LABELS[outcome] || 'идёт',
          }),
        ]),
        el('span', { class: 'ir-poll-when', text: `${ago(poll.startedAt)} · видели ${poll.itemsSeen}` }),
        health ? el('span', { class: 'ir-poll-when', text: health }) : null,
        poll.error ? el('span', { class: 'ir-poll-error', text: poll.error }) : null,
      ]);
    }

    async poll(slug) {
      if (this.busy) return;
      this.setBusy(true);
      this.say(slug ? 'Опрашиваю источник…' : 'Опрашиваю все источники — до полутора минут…');
      try {
        const { results, sources } = await this.api.poll(slug);
        this.setBusy(false);
        this.render(sources);
        this.say(summarizePoll(results));
        this.onPolled();
      } catch (err) {
        this.setBusy(false);
        this.say(`Опрос не удался: ${err.message}`, true);
      }
    }

    setBusy(busy) {
      this.busy = busy;
      this.pollAllBtn.disabled = busy;
      this.body.querySelectorAll('button').forEach((btn) => {
        btn.disabled = busy;
      });
    }

    say(text, isError = false) {
      this.status.textContent = text;
      this.status.classList.toggle('ir-status--error', isError);
    }
  }

  function summarizePoll(results) {
    const fresh = results.reduce((sum, r) => sum + (r.itemsNew || 0), 0);
    const parts = [`Новых публикаций: ${fresh}.`];
    const failed = results.filter((r) => r.outcome === 'failed' || r.outcome === 'partial');
    if (failed.length) parts.push(`С ошибкой: ${failed.map((r) => r.slug).join(', ')}.`);
    const skipped = results.filter((r) => r.outcome === 'skipped');
    if (skipped.length) {
      parts.push(
        `Пропущены: ${skipped
          .map((r) => `${r.slug} (${r.reason}${r.retryInSec ? `, через ${Math.ceil(r.retryInSec / 60)} мин` : ''})`)
          .join(', ')}.`
      );
    }
    return parts.join(' ');
  }

  // ---------- Счётчик ниш ----------

  const WEEKS_SHOWN = 8;

  class CountsView {
    constructor(api, table, { onPick, onLoaded }) {
      this.api = api;
      this.table = table;
      this.onPick = onPick;
      this.onLoaded = onLoaded;
      this.filter = {};
    }

    async load() {
      try {
        const data = await this.api.keywords(WEEKS_SHOWN);
        this.data = data;
        this.onLoaded(data);
        this.render();
      } catch (err) {
        this.table.replaceChildren(el('caption', { class: 'ir-status ir-status--error', text: err.message }));
      }
    }

    highlight(filter) {
      this.filter = filter;
      if (this.data) this.render();
    }

    render() {
      const { weeks, niches, totals } = this.data;
      const head = el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col', text: 'Ниша' }),
          ...weeks.map((week) => el('th', { scope: 'col', class: 'ir-num', text: formatWeek(week) })),
          el('th', { scope: 'col', class: 'ir-num', text: 'Всего' }),
        ]),
      ]);

      const rows = niches.map((niche) =>
        el('tr', { class: niche.parentSlug ? 'ir-row--child' : 'ir-row--parent' }, [
          el('th', { scope: 'row', text: niche.title }),
          ...niche.counts.map((n, i) => el('td', { class: 'ir-num' }, [this.cell(n, niche.slug, weeks[i])])),
          el('td', { class: 'ir-num' }, [this.cell(niche.total, niche.slug, '')]),
        ])
      );
      const totalRow = el('tr', { class: 'ir-row--total' }, [
        el('th', { scope: 'row', text: 'Всего публикаций с датой' }),
        ...totals.map((n) => el('td', { class: 'ir-num', text: String(n) })),
        el('td', { class: 'ir-num', text: String(totals.reduce((a, b) => a + b, 0)) }),
      ]);

      this.table.replaceChildren(head, el('tbody', {}, [...rows, totalRow]));
    }

    cell(count, niche, week) {
      if (!count) return el('span', { class: 'ir-zero', text: '·' });
      const pressed = this.filter.niche === niche && (this.filter.week || '') === week;
      const btn = el('button', {
        type: 'button',
        class: 'ir-cell-btn',
        text: String(count),
        'aria-pressed': String(pressed),
        title: week ? `Показать в ленте: неделя с ${formatWeek(week)}` : 'Показать в ленте за все недели',
      });
      btn.addEventListener('click', () => this.onPick({ niche, week }));
      return btn;
    }
  }

  // ---------- Лента ----------

  const PAGE_SIZE = 40;
  const SEARCH_DEBOUNCE_MS = 350;

  class FeedView {
    constructor(api, els) {
      this.api = api;
      this.els = els;
      this.offset = 0;
      this.nicheTitles = {};
      this.requestNo = 0;
      this.onFilterChange = () => {};

      ['source', 'niche', 'week'].forEach((key) => {
        els[key].addEventListener('change', () => this.load());
      });
      let timer = null;
      els.q.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => this.load(), SEARCH_DEBOUNCE_MS);
      });
      els.form.addEventListener('submit', (event) => event.preventDefault());
      els.more.addEventListener('click', () => this.load({ append: true }));
      els.reset.addEventListener('click', () => this.show({}));
    }

    setSources(sources) {
      fillSelect(this.els.source, sources.map((s) => [s.slug, s.name]));
    }

    setVocabulary(niches, weeks) {
      this.nicheTitles = Object.fromEntries(niches.map((n) => [n.slug, n.title]));
      fillSelect(
        this.els.niche,
        niches.map((n) => [n.slug, n.parentSlug ? `— ${n.title}` : n.title])
      );
      fillSelect(
        this.els.week,
        weeks.slice().reverse().map((week) => [week, `с ${formatWeek(week)}`])
      );
    }

    show({ niche = '', week = '', source = '', q = '' }) {
      this.els.niche.value = niche;
      this.els.week.value = week;
      this.els.source.value = source;
      this.els.q.value = q;
      this.load();
      this.els.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    filter() {
      return {
        source: this.els.source.value,
        niche: this.els.niche.value,
        week: this.els.week.value,
        q: this.els.q.value.trim(),
      };
    }

    async load({ append = false } = {}) {
      const filter = this.filter();
      const hasFilter = Object.values(filter).some(Boolean);
      this.els.reset.hidden = !hasFilter;
      this.onFilterChange(filter);
      if (!append) this.offset = 0;

      const requestNo = ++this.requestNo;
      try {
        const data = await this.api.publications({ ...filter, limit: PAGE_SIZE, offset: this.offset });
        if (requestNo !== this.requestNo) return;
        const items = data.items.map((pub) => this.item(pub));
        if (append) this.els.list.append(...items);
        else this.els.list.replaceChildren(...items);
        this.offset += data.items.length;
        this.els.more.hidden = !data.hasMore;
        this.els.empty.hidden = this.els.list.children.length > 0;
        this.els.empty.textContent = hasFilter
          ? 'По этим фильтрам публикаций нет.'
          : 'Пока пусто. Нажмите «Опросить все».';
      } catch (err) {
        if (requestNo !== this.requestNo) return;
        this.els.list.replaceChildren();
        this.els.empty.hidden = false;
        this.els.empty.textContent = `Не удалось загрузить ленту: ${err.message}`;
      }
    }

    item(pub) {
      const meta = el('div', { class: 'ir-item__meta' }, [
        el('time', {
          datetime: pub.publishedAt || '',
          title: `собрано ${formatDateTime(pub.fetchedAt)}`,
          text: pub.publishedAt ? formatDateTime(pub.publishedAt) : 'без даты',
        }),
        el('span', { class: 'ir-chip ir-chip--muted', text: pub.source.name }),
        ...this.nicheChips(pub),
      ]);
      return el('li', { class: 'ir-item' }, [
        meta,
        el('a', { class: 'ir-item__title', href: pub.url, target: '_blank', rel: 'noopener', text: pub.title }),
        pub.lead ? el('p', { class: 'ir-item__lead', text: pub.lead }) : null,
      ]);
    }

    // Вердикт матча в подсказке: какой синоним сработал и что совпало — отладка словаря.
    nicheChips(pub) {
      const verdicts = pub.nicheHits || pub.niches.map((slug) => ({ slug, hits: [] }));
      return verdicts.map(({ slug, hits }) =>
        el('span', {
          class: 'ir-chip',
          text: this.nicheTitles[slug] || slug,
          title:
            hits
              .map((h) =>
                `${h.viaSlug ? `через «${this.nicheTitles[h.viaSlug] || h.viaSlug}»: ` : ''}` +
                `${h.alias} → ${h.matchedText}`
              )
              .join('; ') || null,
        })
      );
    }
  }

  // ---------- Мелочи ----------

  function byId(id) {
    return document.getElementById(id);
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, value);
    });
    children.filter(Boolean).forEach((child) => node.append(child));
    return node;
  }

  function fillSelect(select, options) {
    const current = select.value;
    const first = select.options[0];
    select.replaceChildren(first, ...options.map(([value, label]) => el('option', { value, text: label })));
    select.value = options.some(([value]) => value === current) ? current : '';
  }

  const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });

  function formatDateTime(value) {
    return dateTimeFormat.format(new Date(value)).replace(',', '');
  }

  function formatWeek(week) {
    const [, month, day] = week.split('-');
    return `${day}.${month}`;
  }

  function ago(value) {
    const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
    if (minutes < 1) return 'только что';
    if (minutes < 60) return `${minutes} мин назад`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} ч назад`;
    return formatDateTime(value);
  }

  main();
})();
