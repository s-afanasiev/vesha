const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'landing');

before(() => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-landing.mjs')], {
    cwd: ROOT,
    stdio: 'pipe',
  });
});

test('лендинг собирается с тремя разделами', () => {
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  assert.match(html, /Портфолио/);
  assert.match(html, /Индивидуальные заказы/);
  assert.match(html, /Эксперименты/);
  assert.match(html, /href="\/portfolio\/showcases\/"/);
});

test('витрины лежат в /portfolio и не светят /experiments', () => {
  const file = path.join(OUT, 'portfolio', 'showcases', 'index.html');
  assert.ok(fs.existsSync(file));
  const html = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(html, /\/experiments\//);
  assert.match(html, /href="\/portfolio\/ui-space\/"/);
  assert.match(html, /href="\/"/);
});

test('виджет чат-движка ведёт в контакты', () => {
  const file = path.join(OUT, 'portfolio', 'ocenka-site', 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  assert.match(html, /href="\/#contact"/);
});

test('build.json перечисляет собранные проекты', () => {
  const build = JSON.parse(fs.readFileSync(path.join(OUT, 'build.json'), 'utf8'));
  for (const id of ['showcases', 'ocenka-site', 'scene-builder']) {
    assert.ok(build.portfolio.includes(id), id);
  }
});
