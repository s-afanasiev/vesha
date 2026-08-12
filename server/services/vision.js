const fs = require('fs');
const config = require('../config');

const EXTRACTION_PROMPT = `Ты анализируешь фото. Нужно найти ОДЕЖДУ (предмет гардероба).
Верни ТОЛЬКО валидный JSON без markdown со схемой:
{
  "is_clothing": true,
  "bbox": { "x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0 },
  "category": "string — тип вещи на русском (футболка, джинсы, шорты, ...)",
  "colors": ["основные цвета одежды на русском"],
  "pattern": "однотонный|полоска|клетка|принт|другое",
  "material": "если видно, иначе null",
  "brand": "если читается логотип/надпись, иначе null",
  "gender": "мужское|женское|унисекс|неясно",
  "style": "краткое описание стиля",
  "key_features": ["короткие визуальные признаки: крой, детали, фурнитура, принт"],
  "distinctive_features": ["2-4 САМЫХ отличительных признака для поиска похожей вещи — не общие слова вроде спортивные/повседневные"],
  "title_ru": "короткое название вещи",
  "search_queries": ["2-3 поисковых запроса на русском"],
  "reject_reason": null
}

Правила bbox (критично):
- bbox — нормализованные координаты ГЛАВНОГО предмета одежды относительно всего кадра.
- x,y — левый верхний угол; w,h — ширина и высота; все значения от 0 до 1.
- Рамка должна плотно охватывать одежду (не всё фото и не только логотип).
- Если на фото НЕТ одежды (природа, еда, техника и т.п.): is_clothing=false, bbox=null, reject_reason="кратко почему", остальные поля можно null/[].
- Если вещей несколько — выбери самую крупную/центральную и дай bbox только для неё.

Правила для search_queries (критично):
- Каждый запрос ОБЯЗАН включать category + цвет (если есть) + пол (если не неясно) + минимум 1-2 distinctive_features / key_features.
- НЕ пиши только «спортивные шорты мужские голубые» — добавляй детали: «карманы на молнии», «полосатый низ», «на шнурке» и т.п.
- Пример хорошего запроса: «мужские голубые спортивные шорты карманы на молнии полосатый низ»
- Один запрос — точный (много деталей), один — короче с 1-2 яркими признаками.`;

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.min(1, Math.max(0, x));
}

function normalizeBbox(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Support [ymin, xmin, ymax, xmax] in 0..1 or 0..1000 (Gemini style)
  if (Array.isArray(raw) && raw.length >= 4) {
    let a = Number(raw[0]);
    let b = Number(raw[1]);
    let c = Number(raw[2]);
    let d = Number(raw[3]);
    if ([a, b, c, d].some((v) => !Number.isFinite(v))) return null;
    if (Math.max(a, b, c, d) > 1.5) {
      a /= 1000;
      b /= 1000;
      c /= 1000;
      d /= 1000;
    }
    const y = Math.min(a, c);
    const x = Math.min(b, d);
    const h = Math.abs(c - a);
    const w = Math.abs(d - b);
    return { x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) };
  }

  let x = clamp01(raw.x ?? raw.left ?? raw.xmin);
  let y = clamp01(raw.y ?? raw.top ?? raw.ymin);
  let w = clamp01(raw.w ?? raw.width);
  let h = clamp01(raw.h ?? raw.height);

  if (x == null && raw.xmin != null && raw.xmax != null) {
    const xmin = clamp01(raw.xmin);
    const xmax = clamp01(raw.xmax);
    if (xmin != null && xmax != null) {
      x = Math.min(xmin, xmax);
      w = Math.abs(xmax - xmin);
    }
  }
  if (y == null && raw.ymin != null && raw.ymax != null) {
    const ymin = clamp01(raw.ymin);
    const ymax = clamp01(raw.ymax);
    if (ymin != null && ymax != null) {
      y = Math.min(ymin, ymax);
      h = Math.abs(ymax - ymin);
    }
  }

  if (x == null || y == null || w == null || h == null) return null;
  if (w < 0.02 || h < 0.02) return null;
  if (x + w > 1) w = 1 - x;
  if (y + h > 1) h = 1 - y;
  return { x, y, w, h };
}

function normalizeAttributes(attributes) {
  const attrs = attributes && typeof attributes === 'object' ? attributes : {};
  const distinctive = Array.isArray(attrs.distinctive_features)
    ? attrs.distinctive_features.filter(Boolean).slice(0, 4)
    : [];
  const keyFeatures = Array.isArray(attrs.key_features)
    ? attrs.key_features.filter(Boolean)
    : [];
  if (!distinctive.length && keyFeatures.length) {
    attrs.distinctive_features = keyFeatures.slice(0, 4);
  }
  const searchQueries = Array.isArray(attrs.search_queries)
    ? attrs.search_queries.filter(Boolean).slice(0, 3)
    : [];
  attrs.search_queries = searchQueries;

  if (typeof attrs.is_clothing === 'string') {
    attrs.is_clothing = /^(true|1|yes|да)$/i.test(attrs.is_clothing);
  } else if (attrs.is_clothing == null) {
    attrs.is_clothing = true;
  } else {
    attrs.is_clothing = Boolean(attrs.is_clothing);
  }

  attrs.bbox = normalizeBbox(attrs.bbox);
  if (!attrs.is_clothing) attrs.bbox = null;

  return { attributes: attrs, search_queries: searchQueries };
}

function parseJsonLoose(text) {
  if (!text) throw new Error('Пустой ответ модели');
  const trimmed = String(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Не удалось разобрать JSON ответа vision');
  }
}

async function extractWithGemini(imagePath, mime) {
  if (!config.geminiApiKey) {
    throw new Error('GEMINI_API_KEY не задан');
  }
  // 2.5* недоступны новым ключам; рабочие: 3.5 / 3.6 / flash-latest
  const models = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];
  const b64 = fs.readFileSync(imagePath).toString('base64');
  let lastErr;

  for (const model of models) {
    try {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
        `?key=${encodeURIComponent(config.geminiApiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: EXTRACTION_PROMPT },
                { inlineData: { mimeType: mime, data: b64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          `[${model}] ` + (data.error?.message || `Gemini HTTP ${res.status}`)
        );
      }
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      const parsed = normalizeAttributes(parseJsonLoose(text));
      return {
        provider: 'gemini',
        model,
        raw_response: data,
        attributes: parsed.attributes,
        search_queries: parsed.search_queries,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Gemini недоступен');
}

async function extractWithOpenAI(imagePath, mime) {
  if (!config.openaiApiKey) {
    throw new Error('OPENAI_API_KEY не задан');
  }
  const b64 = fs.readFileSync(imagePath).toString('base64');
  const dataUrl = `data:${mime};base64,${b64}`;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: EXTRACTION_PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI HTTP ${res.status}`);
  }
  const text = data.choices?.[0]?.message?.content || '';
  const parsed = normalizeAttributes(parseJsonLoose(text));
  return {
    provider: 'openai',
    model: 'gpt-4o',
    raw_response: data,
    attributes: parsed.attributes,
    search_queries: parsed.search_queries,
  };
}

async function extractClothing(imagePath, mime) {
  if (config.geminiApiKey) {
    try {
      return await extractWithGemini(imagePath, mime);
    } catch (err) {
      if (!config.openaiApiKey) throw err;
      console.warn('Gemini failed, falling back to OpenAI:', err.message);
    }
  }
  if (config.openaiApiKey) {
    return extractWithOpenAI(imagePath, mime);
  }
  throw new Error('Нет ключей vision (GEMINI_API_KEY / OPENAI_API_KEY)');
}

module.exports = { extractClothing };
