const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildNicheMatcher, matchableText } = require('../server/services/radar/niches');
const { weekStart, lastWeeks, weeklyNicheCounts } = require('../server/services/idea-radar/keywords');
const { buildNoiseRule } = require('../server/services/idea-radar/relevance');
const { parseFeed } = require('../server/services/collectors/adapters/rss');
const { extractPdfText } = require('../server/services/collectors/adapters/pravo');
const { hasUsefulText } = require('../server/services/idea-radar/govTexts');
const { trigramJaccard } = require('../server/services/collectors/similarity');
const { buildDuplicateRule, clusterStories } = require('../server/services/idea-radar/stories');
const { plainText, parseMoscowDate, contentHash } = require('../server/services/collectors/text');

const NICHES = [
  {
    slug: 'auto',
    title: 'Авто',
    aliases: ['автомоб'],
    excludes: ['дтп', 'штраф за парковк'],
    parentSlug: null,
  },
  { slug: 'auto_tires', title: 'Шиномонтаж', aliases: ['шиномонтаж', 'шин'], parentSlug: 'auto' },
  { slug: 'auto_parts', title: 'Запчасти', aliases: ['параллельн импорт'], parentSlug: 'auto' },
];

test('niche matcher returns verdicts with the reason and credits the parent via the child', () => {
  const match = buildNicheMatcher(NICHES);
  assert.deepEqual(match('Зимние ШИНЫ подорожали'), [
    { slug: 'auto', hits: [{ alias: 'шин', matchedText: 'шины', viaSlug: 'auto_tires' }] },
    { slug: 'auto_tires', hits: [{ alias: 'шин', matchedText: 'шины' }] },
  ]);
  assert.deepEqual(match('Параллельного импорта станет больше'), [
    {
      slug: 'auto',
      hits: [{ alias: 'параллельн импорт', matchedText: 'параллельного импорта', viaSlug: 'auto_parts' }],
    },
    { slug: 'auto_parts', hits: [{ alias: 'параллельн импорт', matchedText: 'параллельного импорта' }] },
  ]);
  // Собственный синоним и срабатывание ребёнка складываются в один вердикт.
  assert.deepEqual(match('Рынок автомобилей с пробегом'), [
    { slug: 'auto', hits: [{ alias: 'автомоб', matchedText: 'автомобилей' }] },
  ]);
  assert.deepEqual(match('Новая машина мэра'), []);
});

test('a synonym at the end of the title counts too', () => {
  const match = buildNicheMatcher(NICHES);
  assert.deepEqual(match('В Курске открылся шиномонтаж'), [
    { slug: 'auto', hits: [{ alias: 'шиномонтаж', matchedText: 'шиномонтаж', viaSlug: 'auto_tires' }] },
    { slug: 'auto_tires', hits: [{ alias: 'шиномонтаж', matchedText: 'шиномонтаж' }] },
  ]);
});

test('niche excludes veto the match, ancestors included', () => {
  const match = buildNicheMatcher(NICHES);
  // Синоним сработал, но исключение сняло нишу: ДТП — не про ремонт и обслуживание.
  assert.deepEqual(match('ДТП в Курске: столкнулись автомобили'), []);
  // Вето предка снимает и детей.
  assert.deepEqual(match('После ДТП поток в шиномонтаж вырос'), []);
  // Исключение — фраза, а не отдельное слово: штраф без парковки нишу не снимает.
  assert.deepEqual(match('Штраф за тонировку автомобиля'), [
    { slug: 'auto', hits: [{ alias: 'автомоб', matchedText: 'автомобиля' }] },
  ]);
  assert.deepEqual(match('Штраф за парковку на тротуаре у автомобилей'), []);
});

test('matchableText joins title and lead — one rule for the feed and the counter', () => {
  assert.equal(matchableText({ title: 'Шины дорожают', lead: null }), 'Шины дорожают');
  assert.equal(matchableText({ title: 'Т', lead: 'Л' }), 'Т Л');
  assert.equal(matchableText({ title: '', lead: 'Лид' }), 'Лид');
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
      { text: 'Шины дорожают', region: 'ru-46', regionName: 'Курская область', publishedAt: new Date('2026-09-29T08:00:00Z') },
      { text: 'Про погоду', region: 'ru-46', regionName: 'Курская область', publishedAt: new Date('2026-09-22T08:00:00Z') },
      { text: 'Шиномонтаж', region: 'ru-46', regionName: 'Курская область', publishedAt: null },
      { text: 'Шины в прошлом году', region: 'ru-46', regionName: 'Курская область', publishedAt: new Date('2025-09-29T08:00:00Z') },
    ],
    niches: NICHES,
    matchNiches: buildNicheMatcher(NICHES),
    weeks: ['2026-09-21', '2026-09-28'],
  });
  assert.deepEqual(result.regions, [{ code: 'ru-46', name: 'Курская область' }]);
  assert.deepEqual(result.totals, { 'ru-46': [1, 1] });
  assert.deepEqual(result.niches.find((n) => n.slug === 'auto_tires').counts, { 'ru-46': [0, 1] });
  assert.equal(result.niches.find((n) => n.slug === 'auto').total, 1);
});

test('weekly counts split by the source region, federal flow keeps its own denominator', () => {
  const result = weeklyNicheCounts({
    publications: [
      { text: 'Курские шины дорожают', region: 'ru-46', regionName: 'Курская область', publishedAt: new Date('2026-09-29T08:00:00Z') },
      { text: 'Федеральный рынок шин', region: 'ru', regionName: 'Россия', publishedAt: new Date('2026-09-30T08:00:00Z') },
      { text: 'Курский шиномонтаж открылся', region: 'ru-46', regionName: 'Курская область', publishedAt: new Date('2026-09-22T08:00:00Z') },
    ],
    niches: NICHES,
    matchNiches: buildNicheMatcher(NICHES),
    weeks: ['2026-09-21', '2026-09-28'],
  });
  assert.deepEqual(result.regions, [
    { code: 'ru-46', name: 'Курская область' },
    { code: 'ru', name: 'Россия' },
  ]);
  assert.deepEqual(result.totals, { 'ru-46': [1, 1], ru: [0, 1] });
  const tires = result.niches.find((n) => n.slug === 'auto_tires');
  assert.deepEqual(tires.counts, { 'ru-46': [1, 1], ru: [0, 1] });
  assert.equal(tires.total, 3);
});

test('rubric noise rule gives a verdict with the reason', () => {
  const noise = buildNoiseRule();
  assert.deepEqual(noise({ categories: ['Спорт'] }), { relevance: 'off_topic', reason: 'рубрика «Спорт»' });
  assert.deepEqual(noise({ categories: ['Общество', 'Происшествия'] }), {
    relevance: 'off_topic',
    reason: 'рубрика «Происшествия»',
  });
  assert.deepEqual(noise({ categories: ['Экономика', 'Транспорт'] }), { relevance: 'unknown', reason: null });
  assert.deepEqual(noise({ categories: [] }), { relevance: 'unknown', reason: null });
  assert.deepEqual(noise({}), { relevance: 'unknown', reason: null });
  // Стем, а не точное имя рубрики: «Спортивная жизнь» — шум, «Автоспорт» — не спорт.
  assert.equal(noise({ categories: ['Спортивная жизнь'] }).relevance, 'off_topic');
  assert.equal(noise({ categories: ['Автоспорт'] }).relevance, 'unknown');
});

test('trigram similarity separates a reprint from a different event', () => {
  const reprint = trigramJaccard(
    'В Курской области проходит акция Минприроды по сбору старых автомобильных шин',
    'В Курской области начался сбор использованных автомобильных шин'
  );
  assert.ok(reprint >= 0.3, `ожидали ≥ 0.3, получили ${reprint.toFixed(2)}`);
  assert.ok(
    trigramJaccard('Ремонт автомобильных дорог завершён', 'Шиномонтаж открылся на Ленина') < 0.3
  );
  assert.equal(trigramJaccard('Ёлки, парк!', 'елки парк'), 1);
  assert.equal(trigramJaccard('', 'что-то'), 0);
});

test('duplicate rule gives a verdict with the reason at the declared threshold', () => {
  const rule = buildDuplicateRule({ threshold: 0.3 });
  assert.deepEqual(rule({ similarity: 0.42 }), { duplicate: true, reason: 'заголовки схожи на 0.42' });
  assert.deepEqual(rule({ similarity: 0.14 }), { duplicate: false, reason: null });
});

test('story clustering keeps a reprint in one story and different events apart', () => {
  const clusters = clusterStories({
    rule: buildDuplicateRule({}),
    publications: [
      // настоящие заголовки перепечатки из живых данных (сходство 0.39)
      { id: 'a', title: 'В Курской области проходит акция Минприроды по сбору старых автомобильных шин', publishedAt: new Date('2026-09-28T10:00:00Z'), sourceId: 'gtrk' },
      { id: 'b', title: 'В Курской области начался сбор использованных автомобильных шин', publishedAt: new Date('2026-09-28T12:00:00Z'), sourceId: 'izvestia' },
      { id: 'c', title: 'В Курске 28 сентября проведут акцию про приемке шин на переработку', publishedAt: new Date('2026-09-28T13:00:00Z'), sourceId: '46tv' },
      { id: 'd', title: 'В центре Курска ярко горел легковой автомобиль', publishedAt: new Date('2026-09-28T14:00:00Z'), sourceId: 'gtrk' },
    ],
  });
  assert.equal(clusters.length, 3);
  const story = clusters.find((c) => c.pubIds.length === 2);
  assert.ok(story, 'перепечатка должна склеиться');
  assert.deepEqual(story.pubIds, ['a', 'b']);
  assert.equal(story.seedTitle.includes('Минприроды'), true); // первый издатель
  assert.equal(story.sources, 2);
});

test('story clustering skips undated publications', () => {
  const clusters = clusterStories({
    rule: buildDuplicateRule({}),
    publications: [
      { id: 'a', title: 'Шины дорожают', publishedAt: null, sourceId: 'x' },
      { id: 'b', title: 'Шины дорожают', publishedAt: new Date('2026-09-28T10:00:00Z'), sourceId: 'y' },
    ],
  });
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].pubIds, ['b']);
});

test('pdf text extraction keeps the official act readable', async () => {
  // Официальный документ — не объект авторского права (ст. 1259 п. 6 ГК РФ).
  const fixture = path.join(__dirname, 'fixtures', 'pravo-act-sample.pdf');
  const text = await extractPdfText(fs.readFileSync(fixture));
  assert.ok(text.includes('ПОСТАНОВЛЯЕТ'), 'в тексте есть постановляющая часть');
  assert.ok(text.includes('привлечения остатков'), 'предмет акта читается');
  assert.equal(hasUsefulText(text), true, 'настоящий акт проходит правило достаточности');
});

test('hasUsefulText rejects scanned pdfs that only carry page markers', () => {
  assert.equal(hasUsefulText('-- 1 of 3 --\n-- 2 of 3 --\n-- 3 of 3 --'), false);
  assert.equal(hasUsefulText(''), false);
  assert.equal(
    hasUsefulText(
      'В соответствии со статьей 236 Бюджетного кодекса Российской Федерации ' +
        'Правительство Курской области ПОСТАНОВЛЯЕТ: Утвердить прилагаемые изменения.'
    ),
    true
  );
});

test('rss parser keeps title, lead and link, drops markup', () => {  const xml = `<?xml version="1.0" encoding="utf-8"?>
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
