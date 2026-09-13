const test = require('node:test');
const assert = require('node:assert/strict');
const {
  htmlToMarkdown,
  exportMarkdown,
  __test,
} = require('../server/services/notesExport');

test('structure-only mode accepts heading markers without text changes', () => {
  const source = ['Модуль 1. Введение', 'Урок 1. Начало', 'Первый абзац.', 'Подтема'].join('\n');
  const markdown = [
    '# Модуль 1: Введение',
    '## Урок 1: Начало',
    'Первый абзац.',
    '### Подтема',
  ].join('\n');

  assert.doesNotThrow(() => __test.assertStructurePreserved(source, markdown));
});

test('structure-only mode rejects rewritten or removed content', () => {
  const source = ['Модуль 1. Введение', 'Урок 1. Начало', 'Точный исходный текст.'].join('\n');

  assert.throws(
    () =>
      __test.assertStructurePreserved(
        source,
        ['# Модуль 1: Введение', '## Урок 1: Начало', 'Пересказ текста.'].join('\n')
      ),
    /Модель изменила текст/
  );
  assert.throws(
    () =>
      __test.assertStructurePreserved(
        source,
        ['# Модуль 1: Введение', '## Урок 1: Начало'].join('\n')
      ),
    /Модель изменила текст/
  );
});

test('standalone HTML receives a restrictive script policy', () => {
  const html = __test.hardenStandaloneHtml(
    '<!doctype html><html><head><title>Notes</title></head><body>Text</body></html>'
  );

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'none'/);
  assert.match(html, /object-src 'none'/);
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<title>'));
});

test('Turndown converts HTML to GFM and removes active content', async () => {
  const markdown = await htmlToMarkdown(`
    <h1>Lesson</h1>
    <p>Hello <strong>world</strong>.</p>
    <script>alert('bad')</script>
    <table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Vesha</td></tr></tbody></table>
  `);

  assert.match(markdown, /^# Lesson/m);
  assert.match(markdown, /\*\*world\*\*/);
  assert.match(markdown, /\|\s*Name\s*\|/);
  assert.doesNotMatch(markdown, /alert|script/i);
});

test('Marked creates sanitized standalone HTML', async () => {
  const result = await exportMarkdown({
    markdown: [
      '# Lesson',
      '',
      '<script>alert("bad")</script>',
      '',
      '<img src="x" onerror="alert(1)">',
      '',
      '[safe](https://example.com)',
      '',
      '[unsafe](javascript:alert(1))',
    ].join('\n'),
    format: 'html',
    title: '<Course>',
  });
  const html = result.buffer.toString('utf8');

  assert.equal(result.mime, 'text/html; charset=utf-8');
  assert.match(html, /<title>&lt;Course&gt;<\/title>/);
  assert.match(html, /<h1>Lesson<\/h1>/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.doesNotMatch(html, /<script|onerror=|href="javascript:/i);
});

test('EPUB export is explicitly deferred', async () => {
  await assert.rejects(
    exportMarkdown({ markdown: '# Lesson', format: 'epub', title: 'Course' }),
    /только экспорт в HTML/
  );
});
