const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNicheMatcher } = require('../server/services/radar/niches');
const { weekStart, lastWeeks, weeklyNicheCounts } = require('../server/services/idea-radar/keywords');
const { parseFeed } = require('../server/services/idea-radar/adapters/rss');
const { plainText, parseMoscowDate, contentHash } = require('../server/services/idea-radar/text');

const NICHES = [
  { slug: 'auto', title: 'Авто', aliases: ['автомоб'], parentSlug: null },
  { slug: 'auto_tires', title: 'Шиномонтаж', aliases: ['шиномонтаж', 'шин'], parentSlug: 'auto' },
  { slug: 'auto_parts', title: 'Запчасти', aliases: ['параллельн импорт'], parentSlug: 'auto' },
];

test('niche matcher finds word starts and credits the parent', () => {
  const match = buildNicheMatcher(NICHES);
  assert.deepEqual(match('Зимние ШИНЫ подорожали'), ['auto', 'auto_tires']);
  assert.deepEqual(match('Открылся шиномонтаж на Ленина'), ['auto', 'auto_tires']);
  assert.deepEqual(match('Новая машина мэра'), []);
  assert.deepEqual(match('Параллельного импорта станет больше'), ['auto', 'auto_parts']);
  assert.deepEqual(match('Рынок автомобилей с пробегом'), ['auto']);
});

test('weeks start on Monday in Moscow time', () => {
  // Воскресенье 23:30 по Москве — ещё прошлая неделя; понедельник 00:30 — новая.
  assert.equal(weekStart(new Date('2026-09-27T20:30:00Z')), '2026-09-21');
  assert.equal(weekStart(new Date('2026-09-27T21:30:00Z')), '2026-09-28');
  assert.deepEqual(lastWeeks(new Date('2026-09-29T10:00:00Z'), 3), [
    '2026-09-14',
    '2026-09-21',
    '2026-09-28',
  ]);
});

test('weekly counts skip undated and out-of-range publications', () => {
  const result = weeklyNicheCounts({
    publications: [
      { title: 'Шины дорожают', lead: '', publishedAt: new Date('2026-09-29T08:00:00Z') },
      { title: 'Про погоду', lead: 'без авто', publishedAt: new Date('2026-09-22T08:00:00Z') },
      { title: 'Шиномонтаж', lead: null, publishedAt: null },
      { title: 'Шины в прошлом году', lead: '', publishedAt: new Date('2025-09-29T08:00:00Z') },
    ],
    niches: NICHES,
    matchNiches: buildNicheMatcher(NICHES),
    weeks: ['2026-09-21', '2026-09-28'],
  });
  assert.deepEqual(result.totals, [1, 1]);
  assert.deepEqual(result.niches.find((n) => n.slug === 'auto_tires').counts, [0, 1]);
  assert.equal(result.niches.find((n) => n.slug === 'auto').total, 1);
});

test('rss parser keeps title, lead and link, drops markup', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
    <rss version="2.0"><channel><title>Лента</title>
      <item>
        <title>Курск &amp; область: «новое»</title>
        <link>https://example.ru/news/1</link>
        <description><![CDATA[<p>Первый&nbsp;абзац <b>новости</b></p>]]></description>
        <pubDate>Tue, 29 Sep 2026 20:06:15 +0300</pubDate>
        <category>Экономика</category>
      </item>
      <item><title>2026</title><link>https://example.ru/news/2</link></item>
    </channel></rss>`;
  const [first, second] = parseFeed(xml);
  assert.equal(first.title, 'Курск & область: «новое»');
  assert.equal(first.lead, 'Первый абзац новости');
  assert.equal(first.externalId, 'https://example.ru/news/1');
  assert.equal(first.publishedAt.toISOString(), '2026-09-29T17:06:15.000Z');
  assert.deepEqual(first.meta.categories, ['Экономика']);
  assert.equal(second.title, '2026');
  assert.equal(second.publishedAt, null);
});

test('dates without zone are read as Moscow time', () => {
  assert.equal(parseMoscowDate('2026-09-29T00:00:00').toISOString(), '2026-09-28T21:00:00.000Z');
  assert.equal(parseMoscowDate('2026-01-26').toISOString(), '2026-01-25T21:00:00.000Z');
  assert.equal(parseMoscowDate(''), null);
  assert.equal(plainText('Длинный текст', 6), 'Длинн…');
  assert.equal(contentHash('Ёлка', null), contentHash('елка', ''));
});
