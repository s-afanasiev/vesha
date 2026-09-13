const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { randomUUID } = require('crypto');
const config = require('../config');
const { run, resolveBin } = require('./mediaBins');

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

function whichOnPath(name) {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, [name], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    return (
      String(out || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) || null
    );
  } catch {
    return null;
  }
}

function firstExistingFile(candidates) {
  for (const file of candidates) {
    if (!file) continue;
    try {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
    } catch (_) {
      /* skip */
    }
  }
  return null;
}

function resolvePandoc() {
  const fromEnvOrBin = resolveBin('pandoc', config.pandocPath);
  if (fromEnvOrBin) return fromEnvOrBin;

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const typicalInstall =
    process.platform === 'win32'
      ? firstExistingFile([
          'C:\\Program Files\\Pandoc\\pandoc.exe',
          'C:\\Program Files (x86)\\Pandoc\\pandoc.exe',
          home && path.join(home, 'AppData', 'Local', 'Pandoc', 'pandoc.exe'),
        ])
      : firstExistingFile(['/usr/local/bin/pandoc', '/usr/bin/pandoc']);

  return typicalInstall || whichOnPath('pandoc') || 'pandoc';
}

function versionLine(text) {
  return (
    String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || ''
  );
}

function pandocMissingError() {
  return bad(
    'Pandoc не установлен. Установите CLI (https://pandoc.org/installing.html) и убедитесь, что команда pandoc есть в PATH, либо задайте PANDOC_PATH_WINDOWS / PANDOC_PATH_LINUX в .env.',
    500
  );
}

async function runPandoc(args, { timeoutMs = config.notesExportTimeoutMs, cwd } = {}) {
  const bin = resolvePandoc();
  try {
    return await run(bin, args, { timeoutMs, cwd });
  } catch (err) {
    if (err.code === 'ENOENT' || /Не найден бинарь/i.test(err.message || '')) {
      throw pandocMissingError();
    }
    const wrapped = bad(err.message || 'Pandoc завершился с ошибкой', err.status || 502);
    wrapped.stderr = err.stderr;
    throw wrapped;
  }
}

async function probePandoc() {
  const resolved = resolvePandoc();
  try {
    const { stdout, stderr } = await runPandoc(['-v'], { timeoutMs: 15000 });
    const version = versionLine(stdout || stderr);
    return {
      ok: true,
      path: resolved,
      version: version || 'pandoc',
    };
  } catch (err) {
    return {
      ok: false,
      path: resolved === 'pandoc' ? null : resolved,
      error: err.message || 'Pandoc недоступен',
    };
  }
}

function llmStatus() {
  const configured = Boolean(config.openaiApiKey) || config.notesExportMock;
  return {
    configured,
    mock: Boolean(config.notesExportMock),
    baseUrl: config.openaiBaseUrl,
    model: config.openaiModel,
  };
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

function messageContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  return '';
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
      '- **Вывод:** замените флаг и задайте OPENAI_API_KEY, чтобы получить настоящую разметку.',
      '',
      'Исходный фрагмент:',
      '',
      text.trim().slice(0, 1200),
    ].join('\n');
  }
  return ['# Модуль 1: Курс', '', '## Урок 1: Материал', '', text.trim()].join('\n');
}

async function processWithLlm({ text, mode }) {
  const source = limitText(text, 'текст');
  const kind = mode === 'summarize' ? 'summarize' : 'structure';
  if (config.notesExportMock && !config.openaiApiKey) {
    return {
      markdown: mockMarkdown(source, kind),
      provider: 'mock',
      model: 'mock',
    };
  }
  if (!config.openaiApiKey) {
    throw bad(
      'OPENAI_API_KEY не задан. Добавьте ключ OpenAI-совместимого API в .env (OPENAI_API_KEY, OPENAI_BASE_URL).',
      500
    );
  }

  const system = kind === 'summarize' ? SUMMARIZE_PROMPT : STRUCTURE_PROMPT;
  const url = `${config.openaiBaseUrl}/chat/completions`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.openaiModel,
        temperature: kind === 'summarize' ? 0.3 : 0,
        max_tokens: config.notesExportMaxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Исходный текст:\n\n${source}` },
        ],
      }),
      signal: AbortSignal.timeout(config.notesExportLlmTimeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw bad('Таймаут запроса к LLM', 504);
    }
    throw bad(`Не удалось обратиться к LLM (${config.openaiBaseUrl}): ${err.message}`, 502);
  }

  const raw = await res.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw bad(`LLM вернул не JSON (HTTP ${res.status}): ${raw.slice(0, 180)}`, 502);
  }
  if (!res.ok) {
    throw bad(data.error?.message || `LLM HTTP ${res.status}`, 502);
  }
  const markdown = unwrapMarkdown(messageContent(data.choices?.[0]?.message?.content));
  if (!markdown) throw bad('Модель вернула пустой Markdown', 502);
  return {
    markdown,
    provider: 'openai',
    model: data.model || config.openaiModel,
  };
}

async function withTempDir(fn) {
  const dir = path.join(config.notesExportDir, randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function htmlToMarkdown(html) {
  const source = limitText(html, 'HTML');
  return withTempDir(async (dir) => {
    const input = path.join(dir, 'input.html');
    const output = path.join(dir, 'output.md');
    fs.writeFileSync(input, source, 'utf8');
    await runPandoc(['input.html', '-f', 'html', '-t', 'markdown', '--wrap=none', '-o', 'output.md'], {
      timeoutMs: 60000,
      cwd: dir,
    });
    if (!fs.existsSync(output)) throw bad('Pandoc не создал Markdown', 502);
    return fs.readFileSync(output, 'utf8');
  });
}

async function exportMarkdown({ markdown, format, title }) {
  const source = limitText(markdown, 'Markdown');
  const kind = String(format || '').toLowerCase();
  if (kind !== 'html' && kind !== 'epub') {
    throw bad('Формат должен быть html или epub');
  }
  const metaTitle = safeTitle(title);
  const slug = fileSlug(metaTitle);

  return withTempDir(async (dir) => {
    const input = path.join(dir, 'input.md');
    const outputName = kind === 'html' ? 'output.html' : 'output.epub';
    const output = path.join(dir, outputName);
    fs.writeFileSync(input, source, 'utf8');

    const args =
      kind === 'html'
        ? [
            'input.md',
            '-s',
            '--metadata',
            `title=${metaTitle}`,
            '-o',
            outputName,
          ]
        : [
            'input.md',
            '-o',
            outputName,
            '--toc',
            '--toc-depth=2',
            '--metadata',
            `title=${metaTitle}`,
          ];

    await runPandoc(args, { cwd: dir });
    if (!fs.existsSync(output) || fs.statSync(output).size < 8) {
      throw bad('Pandoc не создал выходной файл', 502);
    }
    const buffer = fs.readFileSync(output);
    return {
      buffer,
      format: kind,
      mime: kind === 'html' ? 'text/html; charset=utf-8' : 'application/epub+zip',
      filename: `${slug}.${kind === 'html' ? 'html' : 'epub'}`,
    };
  });
}

module.exports = {
  probePandoc,
  llmStatus,
  processWithLlm,
  htmlToMarkdown,
  exportMarkdown,
};
