const test = require('node:test');
const assert = require('node:assert/strict');
const { __test } = require('../server/services/notesExport');

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
