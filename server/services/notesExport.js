const sanitizeHtml = require('sanitize-html');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const config = require('../config');
const { completeChat } = require('./llm');

let markedPromise = null;

const STRUCTURE_PROMPT = `Ты — синтаксический анализатор курсов. Возьми предоставленный текст и преобразуй его в структурированный Markdown.
Твоя задача — ТОЛЬКО проставить заголовки нужного уровня:
- Модули преобразуй в заголовки \`# Модуль N: [Название]\`
- Уроки преобразуй в заголовки \`## Урок N: [Название]\`
- Подглавы/темы — в \`### [Название]\`
Не удаляй, не меняй и не сокращай внутренний текст лекций. Сохраняй исходный текст дословно.
Верни только чистый Markdown, без пояснений и без обёртки в fences.`;

const SUMMARIZE_PROMPT = `Ты — методист образовательных программ. Проанализируй неструктурированный текст лекции/курса.
1. Логически разбей материал на модули (\`# Модуль N\`) и уроки (\`## Урок N\`).
2. В начале документа создай блок \`## Краткое оглавление\`.
3. Внутри каждого урока сделай суммаризацию: ключевые тезисы, определения и выводы в виде структурированного списка с жирными акцентами на терминах.
Выведи результат строго в формате чистого Markdown.`;

function bad(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function limitText(text, label) {
  const value = String(text || '').replace(/^\uFEFF/, '');
  if (!value.trim()) throw bad(`Пустой ${label}`);
  if (value.length > config.notesExportMaxChars) {
    throw bad(
      `${label} слишком длинный (${value.length} символов, лимит ${config.notesExportMaxChars})`,
      413
    );
  }
  return value;
}

function safeTitle(title) {
  const value = String(title || 'Конспект курса')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  return value.slice(0, 200) || 'Конспект курса';
}

function escapeHtmlText(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function markedToSafeHtml(markdown) {
  if (!markedPromise) {
    markedPromise = import('marked').then((module) => module.marked);
  }
  const marked = await markedPromise;
  const rendered = await marked.parse(markdown, {
    async: false,
    gfm: true,
    breaks: false,
  });
  return sanitizeHtml(String(rendered), {
    allowedTags: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'hr',
      'blockquote',
      'pre',
      'code',
      'strong',
      'em',
      'del',
      's',
      'sub',
      'sup',
      'kbd',
      'ul',
      'ol',
      'li',
      'a',
      'img',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      'figure',
      'figcaption',
      'details',
      'summary',
    ],
    allowedAttributes: {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      code: ['class'],
      ol: ['start'],
      th: ['colspan', 'rowspan', 'align'],
      td: ['colspan', 'rowspan', 'align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
    },
    allowProtocolRelative: false,
  });
}

function hardenStandaloneHtml(html) {
  const policy = [
    "default-src 'self' data: https: http:",
    "script-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "style-src 'self' 'unsafe-inline' data: https: http:",
    "font-src 'self' data: https: http:",
    "img-src 'self' data: https: http:",
  ].join('; ');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const source = String(html || '');
  if (/http-equiv=["']Content-Security-Policy["']/i.test(source)) return source;
  if (/<meta\s+charset=["'][^"']+["']\s*\/?>/i.test(source)) {
    return source.replace(
      /<meta\s+charset=["'][^"']+["']\s*\/?>/i,
      (charset) => `${charset}\n${meta}`
    );
  }
  return /<head(?:\s[^>]*)?>/i.test(source)
    ? source.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}\n${meta}`)
    : `${meta}\n${source}`;
}

async function buildStandaloneHtml(markdown, title) {
  const body = await markedToSafeHtml(markdown);
  const escapedTitle = escapeHtmlText(title);
  const document = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="generator" content="Vesha / Marked">
  <title>${escapedTitle}</title>
  <style>
    :root { color-scheme: light dark; }
    body { max-width: 54rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; font: 17px/1.65 system-ui, sans-serif; }
    h1, h2, h3, h4 { line-height: 1.25; margin-top: 1.7em; }
    h1 { border-bottom: 1px solid #8885; padding-bottom: .35em; }
    a { color: #0f766e; }
    img { max-width: 100%; height: auto; }
    blockquote { margin-left: 0; padding-left: 1rem; border-left: 3px solid #8888; color: #666; }
    pre { overflow-x: auto; padding: 1rem; border-radius: .5rem; background: #8882; }
    code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: .5rem .65rem; border: 1px solid #8886; text-align: left; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
  return hardenStandaloneHtml(document);
}

function fileSlug(title) {
  const slug = safeTitle(title)
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80);
  return slug || 'conspect';
}

function unwrapMarkdown(text) {
  let value = String(text || '').trim();
  if (!value) return '';
  value = value.replace(/^```(?:markdown|md)?\s*\r?\n/i, '');
  value = value.replace(/\r?\n```\s*$/, '');
  return value.trim();
}

function structureFingerprint(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s+/, '')
        .trim()
        .replace(
          /^((?:Модуль|Урок)\s+\d+)\s*[.:\-–—]\s*/iu,
          '$1: '
        )
    )
    .filter(Boolean);
}

function assertStructurePreserved(source, markdown) {
  const before = structureFingerprint(source);
  const after = structureFingerprint(markdown);
  if (before.length !== after.length || before.some((line, index) => line !== after[index])) {
    const err = bad(
      'Модель изменила текст в режиме «только структура». Результат отклонён — исходный конспект сохранён.',
      502
    );
    err.code = 'structure_changed';
    throw err;
  }
}

function mockMarkdown(text, mode) {
  if (mode === 'summarize') {
    return [
      '## Краткое оглавление',
      '',
      '- Модуль 1. Демонстрационная структура',
      '  - Урок 1. Краткое содержание',
      '',
      '# Модуль 1: Демонстрационная структура',
      '',
      '## Урок 1: Краткое содержание',
      '',
      '- **Тезис:** NOTES_EXPORT_MOCK=1 — живой LLM не вызывался.',
      '- **Вывод:** отключите mock-режим и настройте LLM, чтобы получить настоящую разметку.',
      '',
      'Исходный фрагмент:',
      '',
      text.trim().slice(0, 1200),
    ].join('\n');
  }
  return ['# Модуль 1: Курс', '', '## Урок 1: Материал', '', text.trim()].join('\n');
}

async function processWithLlm({ text, mode, llm }) {
  const source = limitText(text, 'текст');
  const kind = mode === 'summarize' ? 'summarize' : 'structure';
  if (config.notesExportMock) {
    return {
      markdown: mockMarkdown(source, kind),
      provider: 'mock',
      model: 'mock',
    };
  }

  const system = kind === 'summarize' ? SUMMARIZE_PROMPT : STRUCTURE_PROMPT;
  const selectedProvider = String(llm?.provider || '').toLowerCase();
  const usesPickerTuning = selectedProvider === 'openai';
  const result = await completeChat({
    selection: llm || {},
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `Исходный текст:\n\n${source}` },
    ],
    timeoutMs: config.notesExportLlmTimeoutMs,
    temperature: usesPickerTuning ? undefined : kind === 'summarize' ? 0.3 : 0,
    maxTokens: usesPickerTuning ? undefined : config.notesExportMaxTokens,
  });
  const markdown = unwrapMarkdown(result.text);
  if (!markdown) throw bad('Модель вернула пустой Markdown', 502);
  if (kind === 'structure') assertStructurePreserved(source, markdown);
  return {
    markdown,
    provider: result.provider,
    model: result.model,
    usage: result.usage || null,
    finishReason: result.finishReason || null,
  };
}

async function htmlToMarkdown(html) {
  const source = limitText(html, 'HTML');
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });
  turndown.use(gfm);
  turndown.remove([
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'template',
    'noscript',
    'svg',
    'canvas',
  ]);
  const markdown = turndown.turndown(source).trim();
  if (!markdown) throw bad('Turndown не нашёл текстового содержимого в HTML');
  return markdown;
}

async function exportMarkdown({ markdown, format, title }) {
  const source = limitText(markdown, 'Markdown');
  const kind = String(format || 'html').toLowerCase();
  if (kind !== 'html') {
    throw bad('Сейчас поддерживается только экспорт в HTML');
  }
  const metaTitle = safeTitle(title);
  const slug = fileSlug(metaTitle);
  const output = await buildStandaloneHtml(source, metaTitle);
  return {
    buffer: Buffer.from(output, 'utf8'),
    format: 'html',
    mime: 'text/html; charset=utf-8',
    filename: `${slug}.html`,
  };
}

module.exports = {
  processWithLlm,
  htmlToMarkdown,
  exportMarkdown,
  __test: {
    assertStructurePreserved,
    buildStandaloneHtml,
    hardenStandaloneHtml,
    markedToSafeHtml,
    structureFingerprint,
  },
};
