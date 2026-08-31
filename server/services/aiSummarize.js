const fs = require('fs');
const path = require('path');
const config = require('../config');

const SUMMARIZE_PROMPT = `Ты эксперт по анализу и суммаризации аудио и видео контента.
Твоя задача — проанализировать предоставленный контент (аудиозапись или расшифровку) и сделать структурированную, полезную и лаконичную выжимку на РУССКОМ языке.

Верни ТОЛЬКО валидный JSON со следующей структурой (без markdown-оберток):
{
  "title": "Краткий и емкий заголовок записи",
  "tldr": "Краткая суть в 2-3 предложениях (главный посыл)",
  "language": "ru|en|другой",
  "key_points": [
    "Ключевой тезис 1 с важными деталями",
    "Ключевой тезис 2 с важными деталями",
    "Ключевой тезис 3..."
  ],
  "timeline": [
    {
      "time": "00:00",
      "seconds": 0,
      "title": "Введение и постановка темы",
      "summary": "Кратко о чем говорится в этом блоке"
    },
    {
      "time": "01:30",
      "seconds": 90,
      "title": "Основная часть...",
      "summary": "..."
    }
  ],
  "action_items": [
    "Конкретные шаги, выводы или задачи, которые упоминаются"
  ],
  "transcript": "Полная или максимально точная текстовая расшифровка (если доступна)"
}

Правила:
- Пиши грамотно, без лишней «воды», выделяй конкретику, факты, цифры и термины.
- Таймкоды должны быть правдоподобными и соответствовать таймингу записи.`;

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
    throw new Error('Не удалось разобрать JSON суммаризации');
  }
}

async function summarizeWithGemini(options = {}) {
  const { audioPath, audioMime = 'audio/wav', transcriptText = '', onProgress } = options;
  const report = (patch) => {
    if (typeof onProgress === 'function') onProgress(patch);
  };

  if (!config.geminiApiKey) {
    report({ detail: 'GEMINI_API_KEY нет — отдаём демонстрационный ответ.' });
    return {
      provider: 'mock',
      model: 'mock',
      summary: createMockSummary(transcriptText || 'Аудиозапись'),
    };
  }

  const models = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-flash-latest', 'gemini-1.5-flash'];
  const parts = [{ text: SUMMARIZE_PROMPT }];

  if (audioPath && fs.existsSync(audioPath)) {
    const stat = fs.statSync(audioPath);
    const mb = (stat.size / (1024 * 1024)).toFixed(1);
    report({
      detail: `Читаем ${path.basename(audioPath)} (${mb} МБ) и кодируем для Gemini…`,
    });
    const b64 = fs.readFileSync(audioPath).toString('base64');
    parts.push({
      inlineData: {
        mimeType: audioMime,
        data: b64,
      },
    });
  } else if (transcriptText) {
    parts.push({
      text: `Расшифровка записи для суммаризации:\n\n${transcriptText}`,
    });
  } else {
    throw new Error('Нет входных данных для суммаризации (нужен файл аудио или текст)');
  }

  let lastErr;
  for (const model of models) {
    try {
      report({
        detail: `Отправляем audio.wav в ${model} и ждём JSON с расшифровкой…`,
        command: [
          `POST https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          '  Content-Type: application/json',
          '  parts: prompt (суммаризация на русском) + inlineData audio.wav',
        ].join('\n'),
      });
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
        `?key=${encodeURIComponent(config.geminiApiKey)}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          `[${model}] ` + (data.error?.message || `HTTP ${res.status}`)
        );
      }

      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
      const parsed = parseJsonLoose(text);
      return {
        provider: 'gemini',
        model,
        summary: parsed,
      };
    } catch (err) {
      lastErr = err;
      report({
        detail: `${model} не сработал: ${err.message}. Пробуем следующую модель…`,
      });
    }
  }

  console.warn('Gemini summarize failed, returning fallback:', lastErr?.message);
  report({
    detail: lastErr
      ? `Gemini не ответил (${lastErr.message}). Показываем запасной ответ.`
      : 'Gemini не ответил. Показываем запасной ответ.',
  });
  return {
    provider: 'fallback',
    model: 'mock',
    summary: createMockSummary(transcriptText),
    error: lastErr?.message,
  };
}

function createMockSummary(context = '') {
  return {
    title: 'Суммаризация аудиозаписи',
    tldr: 'В записи рассматриваются ключевые идеи проекта, архитектурные решения и дальнейшие шаги реализации.',
    language: 'ru',
    key_points: [
      'Анализ аудиопотока и выделение основных смысловых блоков',
      'Локальная и серверная обработка для обеспечения гибкости и скорости',
      'Интеграция с моделями суммаризации и распознавания речи',
      'Генерация структурированных таймкодов и списка действий (Action Items)',
    ],
    timeline: [
      {
        time: '00:00',
        seconds: 0,
        title: 'Введение и обзор темы',
        summary: 'Начало записи, постановка цели и формулировка задач.',
      },
      {
        time: '00:45',
        seconds: 45,
        title: 'Техническая реализация',
        summary: 'Обсуждение извлечения звука и вариантов транскрибации.',
      },
      {
        time: '01:30',
        seconds: 90,
        title: 'Итоги и следующие шаги',
        summary: 'Формирование плана действий и заключительные рекомендации.',
      },
    ],
    action_items: [
      'Проверить извлечение аудиодорожки из исходного видео',
      'Сохранить структурированную выжимку в Markdown или TXT',
      'Применить таймкоды для быстрой навигации по ключевым моментам',
    ],
    transcript: context || 'Пример транскрипции аудиозаписи...',
  };
}

module.exports = {
  summarizeWithGemini,
  createMockSummary,
};
