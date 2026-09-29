// Адаптер открытых данных «Работы России» (opendata.trudvsem.ru) — портал центров занятости.
// Контакты работодателя (телефоны, почта, контактное лицо) не сохраняем.
const { fetchJson } = require('../http');
const { plainText, parseMoscowDate } = require('../text');

const API_BASE = 'https://opendata.trudvsem.ru/api/v1';
const LEAD_MAX_CHARS = 500;

function pause(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

function fromVacancy(vacancy, query) {
  const company = vacancy.company ? plainText(vacancy.company.name) : '';
  const salary = plainText(vacancy.salary);
  const duty = plainText(vacancy.duty);
  return {
    externalId: plainText(vacancy.id),
    url: plainText(vacancy.vac_url) || `https://trudvsem.ru/vacancy/card/${vacancy.id}`,
    title: plainText(vacancy['job-name']),
    lead: plainText([company, salary, duty].filter(Boolean).join(' · '), LEAD_MAX_CHARS),
    body: null,
    publishedAt: parseMoscowDate(vacancy['creation-date']),
    meta: {
      company: company || null,
      salaryMin: Number(vacancy.salary_min) || null,
      salaryMax: Number(vacancy.salary_max) || null,
      employment: plainText(vacancy.employment) || null,
      schedule: plainText(vacancy.schedule) || null,
      modifiedAt: plainText(vacancy.date_modify) || null,
      queries: [query],
    },
  };
}

async function search(regionCode, query, limit, ctx) {
  const url = `${API_BASE}/vacancies/region/${encodeURIComponent(regionCode)}?text=${encodeURIComponent(query)}&limit=${limit}&offset=0`;
  const data = await fetchJson(url, {
    signal: ctx.signal,
    timeoutMs: ctx.pageTimeoutMs,
    maxBytes: ctx.maxBytes,
  });
  return { query, found: (data.results && data.results.vacancies) || [] };
}

// API отвечает ~10 с на запрос независимо от limit, поэтому запросы идут парами:
// восемь запросов укладываются в дедлайн опроса, а портал не получает залп.
// Полнотекстовый поиск портала шумит («мойщик» → мойщик посуды), поэтому keepTitle —
// правило отбора по названию вакансии, объявленное в настройках источника.
async function* pages(source, ctx) {
  const { regionCode, queries = [], limit = 100, concurrency = 2, pauseMs = 300, keepTitle } = source.settings;
  const titleRule = keepTitle ? new RegExp(keepTitle, 'iu') : null;
  const byId = new Map();
  for (let i = 0; i < queries.length; i += concurrency) {
    if (i > 0) await pause(pauseMs, ctx.signal);
    const batch = queries.slice(i, i + concurrency);
    const answers = await Promise.all(batch.map((query) => search(regionCode, query, limit, ctx)));
    for (const { query, found } of answers) {
      for (const { vacancy } of found) {
        if (!vacancy || !vacancy.id) continue;
        const known = byId.get(vacancy.id);
        if (known) known.meta.queries.push(query);
        else byId.set(vacancy.id, fromVacancy(vacancy, query));
      }
    }
  }
  yield [...byId.values()].filter((item) => item.title && (!titleRule || titleRule.test(item.title)));
}

module.exports = {
  pages,
};
