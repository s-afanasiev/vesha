const fs = require('fs');
const config = require('../config');

const EXTRACTION_PROMPT = `Ты анализируешь фотографию предмета одежды.
Верни ТОЛЬКО валидный JSON без markdown со схемой:
{
  "category": "string — тип вещи на русском (футболка, джинсы, ...)",
  "colors": ["основные цвета на русском"],
  "pattern": "однотонный|полоска|клетка|принт|другое",
  "material": "если видно, иначе null",
  "brand": "если читается логотип/надпись, иначе null",
  "gender": "мужское|женское|унисекс|неясно",
  "style": "краткое описание стиля",
  "key_features": ["короткие признаки"],
  "title_ru": "короткое название вещи",
  "search_queries": ["1-3 поисковых запроса на русском для покупки похожей вещи"]
}`;

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
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
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
                { inline_data: { mime_type: mime, data: b64 } },
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
        throw new Error(data.error?.message || `Gemini HTTP ${res.status}`);
      }
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      const attributes = parseJsonLoose(text);
      const searchQueries = Array.isArray(attributes.search_queries)
        ? attributes.search_queries.filter(Boolean).slice(0, 3)
        : [];
      return {
        provider: 'gemini',
        model,
        raw_response: data,
        attributes,
        search_queries: searchQueries,
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
  const attributes = parseJsonLoose(text);
  const searchQueries = Array.isArray(attributes.search_queries)
    ? attributes.search_queries.filter(Boolean).slice(0, 3)
    : [];
  return {
    provider: 'openai',
    model: 'gpt-4o',
    raw_response: data,
    attributes,
    search_queries: searchQueries,
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
