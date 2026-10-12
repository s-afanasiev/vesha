// Разметка батча отзывов по справочнику потребностей: промпт и разбор ответа.
// Чистые функции (П15): модель вызывает тот, кто держит квоту и узел дерева, —
// здесь только «что спросить» и «как понять ответ». Цитата сверяется с текстом
// отзыва (VerifiedQuotes); чужой id, код вне справочника и кривая полярность —
// отброшены с причиной, а не молча (П38).

const { AUTHORS } = require('./needCatalog');

function systemPrompt(catalog) {
  const lines = (dict) => Object.entries(dict).map(([code, text]) => `- ${code}: ${text}`).join('\n');
  const { other, ...needs } = catalog.needs;
  const core = Object.fromEntries(Object.entries(needs).filter(([code]) => !code.startsWith('niche.')));
  return [
    `Ты извлекаешь из отзывов о бизнесе «${catalog.label}» сигналы спроса — конкретные потребности клиента, которые бизнес может закрыть.`,
    'Сигнал бывает двух полярностей: missing — клиенту это было нужно, а он не получил; valued — клиент ценит, что это есть.',
    'Не выписывай эмоции без предмета («ужасное место», «не рекомендую», «всё отлично», «спасибо»). Сигнал — только конкретная потребность.',
    'Отказ разделяй: access.capability — не могут (нет оборудования, специалиста, услуги для этого случая); attitude.willing — не хотят (человек отказался, ушёл, бросил работу).',
    '',
    'Потребности ядра (общие для любого бизнеса):',
    lines(core),
    '',
    ...(Object.keys(catalog.packNeeds).length ? ['Потребности ниши:', lines(catalog.packNeeds), ''] : []),
    `- other: ${other}`,
    '',
    `Услуга (service): ${catalog.services.join(', ')} — к какой услуге относится сигнал.`,
    `Автор (author): ${AUTHORS.join(', ')} — client: клиент; employee: сотрудник или соискатель; other: отзыв не о клиентском сервисе.`,
    '',
    'Правила:',
    '- Если подходит и код ядра, и код ниши — бери код ниши.',
    '- quote — дословная подстрока текста этого отзыва; пересказывать нельзя.',
    '- detail — только для offer.specific и other.',
    '- Для каждого отзыва из входа — ровно один элемент с его id; signals может быть пустым.',
    '',
    'Ответ — строго JSON без markdown-заборов и пояснений, ровно такой формы:',
    '{"reviews": [{"id": "…", "author": "client", "signals": [{"need": "access.booking", "polarity": "missing", "service": "…", "quote": "…", "detail": ""}]}]}',
  ].join('\n');
}

function userContent(reviews) {
  return reviews
    .map((r) => `[id ${r.review_id}] ★${r.rating} · ${String(r.date_created || r.date || '').slice(0, 10)}\n${String(r.text || '').trim()}`)
    .join('\n\n');
}

const normalize = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"']/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

function parseBatch(text, reviews, catalog) {
  const raw = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const data = JSON.parse(raw);
  const byId = new Map(reviews.map((r) => [String(r.review_id), r]));
  const seen = new Set();
  const results = [];
  const rejected = [];
  for (const item of Array.isArray(data.reviews) ? data.reviews : []) {
    const review = byId.get(String(item && item.id));
    if (!review) {
      rejected.push('чужой id');
      continue;
    }
    seen.add(String(review.review_id));
    const signals = [];
    for (const signal of Array.isArray(item.signals) ? item.signals : []) {
      const need = String((signal && signal.need) || '').trim();
      const polarity = String((signal && signal.polarity) || '').trim();
      if (!catalog.known(need) || !['missing', 'valued'].includes(polarity)) {
        rejected.push(catalog.known(need) ? 'полярность' : 'код вне справочника');
        continue;
      }
      const quote = String(signal.quote || '').trim();
      signals.push({
        need,
        polarity,
        service: catalog.services.includes(signal.service) ? signal.service : 'other',
        quote: quote || null,
        quoteVerified: Boolean(quote && normalize(review.text).includes(normalize(quote))),
        detail: String(signal.detail || '').trim() || null,
      });
    }
    results.push({ review, author: AUTHORS.includes(item.author) ? item.author : 'client', signals });
  }
  const missing = reviews.filter((r) => !seen.has(String(r.review_id))).map((r) => String(r.review_id));
  return { results, rejected, missing };
}

// Батчи: негатив по 10, позитив по 20 — как в прогоне 11.10.2026.
function batchesOf(reviews, { negative = 10, positive = 20 } = {}) {
  const out = [];
  const chunk = (list, size, group) => {
    for (let i = 0; i < list.length; i += size) out.push({ group, reviews: list.slice(i, i + size) });
  };
  chunk(reviews.filter((r) => r.rating <= 3), negative, 'negative');
  chunk(reviews.filter((r) => r.rating >= 4), positive, 'positive');
  return out;
}

module.exports = { systemPrompt, userContent, parseBatch, batchesOf, normalize };
