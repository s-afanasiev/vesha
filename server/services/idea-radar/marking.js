// Разметка сдвигов (фаза 2): LLM извлекает 0…N сдвигов из сюжета. Чужой мир LLM —
// за дверью completeChat (llm-picker: ключ, модель и адрес задаёт человек на фронте,
// на сервере — только опциональный дефолт). Цитата обязана быть дословной подстрокой
// публикации (VerifiedQuotes, Б9) — не сошлось, сдвиг сохраняется без цитаты. Предмет
// приводится к канону правилом; ниши и направления — связь «сдвиг × адресат» (И3).
// Таксономия v1 — docs/idea-radar-architecture.md, раздел «Сдвиг».
const db = require('../../db');
const config = require('../../config');
const { completeChat } = require('../llm');
const { loadNiches, normalizeText } = require('../radar/niches');
const { buildNoiseRule } = require('./relevance');

const PROMPT_VERSION = 'v1';
const MAX_PUB_CHARS = 4000;
const MAX_STORY_CHARS = 9000;
const MARK_PAUSE_MS = 300;

const SHIFT_TYPES = {
  new_duty: 'появилась новая обязанность с адресатом и сроком',
  new_permission: 'разрешили то, что раньше было запрещено или затруднено',
  public_money: 'государственные деньги: субсидия, грант, закупка, льгота',
  tech_enabler: 'технология стала доступной, дешёвой или обязательной',
  platform_change: 'изменились правила площадки или маркетплейса',
  infrastructure: 'инфраструктура: дороги, сети, связь, ЖКХ',
  behavior_shift: 'люди стали вести себя иначе: спрос, привычки, переезды',
  demography: 'демография и состав населения региона',
  other: 'сдвиг, не подходящий ни под один тип',
};

const DIRECTIONS = {
  duty: 'кому-то теперь обязательно сделать новое',
  opportunity: 'кому-то открылась новая возможность',
  threat: 'кому-то грозит риск, штраф или потеря',
};

function systemPrompt(niches) {
  const typeLines = Object.entries(SHIFT_TYPES)
    .map(([slug, description]) => `- ${slug}: ${description}`)
    .join('\n');
  const directionLines = Object.entries(DIRECTIONS)
    .map(([slug, description]) => `- ${slug}: ${description}`)
    .join('\n');
  const nicheLines = niches
    .map((niche) => `- ${niche.slug} — ${niche.title}`)
    .join('\n');
  return [
    'Ты аналитик региональных сдвигов: находишь в публикациях изменения, которые отвечают на вопрос «почему сейчас» у начинающего предпринимателя.',
    'Из сюжета извлеки 0…N сдвигов. Большинство сюжетов — не сдвиги вовсе: пустой ответ честнее натянутого.',
    '',
    'Типы сдвигов:',
    typeLines,
    '',
    'Направления (для каждой ниши-адресата):',
    directionLines,
    '',
    `Ниши-адресаты (только эти slug):`,
    nicheLines,
    '',
    'Правила:',
    '- subject — короткое каноничное имя предмета («маркировка шин», «онлайн-кассы»); subject_raw — как предмет назван в тексте.',
    '- quote — дословная подстрока одной из публикаций; пересказывать нельзя. Нет цитаты — поле пустое.',
    '- effective_date — дата вступления в силу, только если она названа в тексте (YYYY-MM-DD).',
    '- niches — 0…3 адресатов из списка, у каждого своё направление.',
    '- Ответ — строго JSON: {"shifts": [...]}. Без markdown-заборов и пояснений.',
  ].join('\n');
}

function buildStoryContent(story) {
  const parts = [`Сюжет: ${story.title}`, `Публикаций в сюжете: ${story.pubs.length}`, ''];
  let total = 0;
  story.pubs.forEach((pub, index) => {
    const text = [pub.title, pub.lead, pub.body].filter(Boolean).join('\n').slice(0, MAX_PUB_CHARS);
    total += text.length;
    if (total > MAX_STORY_CHARS) return;
    const date = pub.publishedAt ? String(pub.publishedAt).slice(0, 10) : 'без даты';
    parts.push(`[${index + 1}] ${pub.kind} · ${date}`);
    parts.push(text);
    parts.push('');
  });
  return parts.join('\n');
}

// Модель присылает JSON, иногда в markdown-заборах — снимаем их, валидируем строго.
function parseShifts(text) {
  const raw = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('ответ модели не JSON');
  }
  const shifts = Array.isArray(data.shifts) ? data.shifts : [];
  return shifts
    .map((shift) => {
      const subject = String(shift.subject || '').trim().slice(0, 120);
      const summary = String(shift.summary || '').trim().slice(0, 500);
      if (!subject || !summary) return null;
      const type = String(shift.type || '').trim().toLowerCase();
      const niches = (Array.isArray(shift.niches) ? shift.niches : [])
        .map((entry) => ({
          slug: String(entry && entry.slug ? entry.slug : '').trim(),
          direction: String(entry && entry.direction ? entry.direction : '').trim().toLowerCase(),
        }))
        .filter((entry) => entry.slug && entry.direction in DIRECTIONS)
        .slice(0, 3);
      const date = String(shift.effective_date || '').trim();
      return {
        type: type in SHIFT_TYPES ? type : 'other',
        subject,
        subjectRaw: String(shift.subject_raw || '').trim().slice(0, 120) || null,
        effectiveDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
        summary,
        quote: String(shift.quote || '').trim().slice(0, 500) || null,
        niches,
      };
    })
    .filter(Boolean);
}

// Дословность цитаты проверяем после нормализации: пробелы, кавычки, тире, «ё».
function normalizeQuote(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»„“”"']/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function findQuoteSource(quote, pubs) {
  const needle = normalizeQuote(quote);
  if (!needle) return null;
  return (
    pubs.find((pub) =>
      normalizeQuote([pub.title, pub.lead, pub.body].filter(Boolean).join('\n')).includes(needle)
    ) || null
  );
}

// Канон предмета — правило (И9: точное совпадение после нормализации); карта живёт
// весь запуск разметки, новые предметы видят следующие сюжеты.
async function canonSubjectId(client, subject, subjectIdByName) {
  const key = normalizeText(subject);
  if (subjectIdByName.has(key)) return subjectIdByName.get(key);
  const { rows } = await client.query(
    'INSERT INTO idea_radar_subjects (name) VALUES ($1) RETURNING id',
    [subject]
  );
  subjectIdByName.set(key, rows[0].id);
  return rows[0].id;
}

async function markStory(story, niches, llm, subjectIdByName) {
  const nicheBySlug = new Map(niches.map((niche) => [niche.slug, niche]));
  const result = await completeChat({
    selection: llm,
    messages: [
      { role: 'system', content: systemPrompt(niches) },
      { role: 'user', content: buildStoryContent(story) },
    ],
    temperature: 0.2,
    timeoutMs: config.llmTimeoutMs,
  });
  const parsed = parseShifts(result.text);

  const saved = await db.withClient(async (client) => {
    await client.query('BEGIN');
    try {
      let found = 0;
      for (const shift of parsed) {
        const subjectId = await canonSubjectId(client, shift.subject, subjectIdByName);
        const quoteSource = shift.quote ? findQuoteSource(shift.quote, story.pubs) : null;
        const { rows: inserted } = await client.query(
          `INSERT INTO idea_radar_shifts
             (story_id, type, region_id, subject_id, subject_raw, effective_date,
              summary, quote, quote_verified, taxonomy_version, prompt_version, model)
           VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, 'v1', $9, $10)
           RETURNING id`,
          [
            story.id,
            shift.type,
            subjectId,
            shift.subjectRaw,
            shift.effectiveDate,
            shift.summary,
            quoteSource ? shift.quote : null,
            Boolean(quoteSource),
            PROMPT_VERSION,
            result.model || null,
          ]
        );
        found += 1;
        for (const entry of shift.niches) {
          const niche = nicheBySlug.get(entry.slug);
          if (!niche) continue;
          await client.query(
            `INSERT INTO idea_radar_shift_addressees (shift_id, niche_id, direction) VALUES ($1, $2, $3)
             ON CONFLICT (shift_id, niche_id) DO NOTHING`,
            [inserted[0].id, niche.id, entry.direction]
          );
        }
      }
      await client.query(
        `INSERT INTO idea_radar_markings (story_id, shifts_found, prompt_version, model)
         VALUES ($1, $2, $3, $4)`,
        [story.id, found, PROMPT_VERSION, result.model || null]
      );
      await client.query('COMMIT');
      return found;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
  return { shifts: saved, model: result.model };
}

// Сюжеты без непомеченных публикаций нельзя размечать — записываем это правилом шума,
// чтобы сюжет не висел «в ожидании» вечно; в метриках И8 такие не участвуют.
async function markPendingStories({ llm, limit = 5 } = {}) {
  if (!llm || typeof llm !== 'object') throw badSelection();
  const niches = await loadNiches();
  const noise = buildNoiseRule();
  const { rows: subjectRows } = await db.query('SELECT name, id FROM idea_radar_subjects');
  const subjectIdByName = new Map(subjectRows.map((row) => [normalizeText(row.name), row.id]));
  const { rows } = await db.query(
    `SELECT st.id, st.title,
            json_agg(json_build_object(
              'title', p.title, 'lead', p.lead, 'body', p.body,
              'publishedAt', p.published_at, 'kind', s.kind,
              'categories', COALESCE(p.meta->'categories', '[]'::jsonb)
            )) AS pubs
     FROM idea_radar_stories st
     JOIN idea_radar_publications p ON p.story_id = st.id
     JOIN idea_radar_sources s ON s.id = p.source_id
     WHERE s.kind <> 'serendipity'
       AND NOT EXISTS (
         SELECT 1 FROM idea_radar_markings m
         WHERE m.story_id = st.id AND m.prompt_version = $1
       )
     GROUP BY st.id
     ORDER BY min(p.published_at) DESC NULLS LAST
     LIMIT $2`,
    [PROMPT_VERSION, limit]
  );

  let marked = 0;
  let shiftsFound = 0;
  let withoutShifts = 0;
  let skippedByNoise = 0;
  const errors = [];
  for (const [index, story] of rows.entries()) {
    if (index > 0) await pause(MARK_PAUSE_MS);
    const meaningful = story.pubs.filter(
      (pub) => noise({ categories: pub.categories || [] }).relevance !== 'off_topic'
    );
    if (!meaningful.length) {
      await db.query(
        `INSERT INTO idea_radar_markings (story_id, shifts_found, prompt_version, model)
         VALUES ($1, 0, $2, 'noise-rule')`,
        [story.id, PROMPT_VERSION]
      );
      skippedByNoise += 1;
      continue;
    }
    try {
      const outcome = await markStory({ ...story, pubs: meaningful }, niches, llm, subjectIdByName);
      marked += 1;
      shiftsFound += outcome.shifts;
      if (!outcome.shifts) withoutShifts += 1;
    } catch (err) {
      // Не пишем marking с ошибкой: сюжет останется в ожидании и повторится на следующем запуске.
      errors.push({ title: story.title, error: String(err.message).slice(0, 200) });
    }
  }

  return { requested: rows.length, marked, shiftsFound, withoutShifts, skippedByNoise, errors: errors.slice(0, 3) };
}

function badSelection() {
  const err = new Error('Не передан выбор LLM (llm) — задайте нейросеть в блоке на странице');
  err.status = 400;
  return err;
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  markPendingStories,
  PROMPT_VERSION,
  __test: {
    parseShifts,
    findQuoteSource,
    normalizeQuote,
    buildStoryContent,
    systemPrompt,
  },
};
