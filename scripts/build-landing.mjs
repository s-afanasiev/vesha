#!/usr/bin/env node
// Сборка лендинга vesha.pro: статика лендинга + витринные проекты.
//
//   npm run build:landing
//
// Раскладка dist/landing:
//   index.html, assets/*      — сам лендинг
//   portfolio/<id>/...        — статические витрины (kind=showcase)
//
// Внутренние ссылки витрин вида /experiments/<id>/ переписываются в
// /portfolio/<id>/, чтобы публичный URL не утекал в «эксперименты».
// Ссылки на каталог /experiments/ ведут на главную, виджет чат-движка —
// в блок контактов.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const projects = require('../server/projects.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'deploy', 'edge', 'landing');
const OUT = path.join(ROOT, 'dist', 'landing');
const PORTFOLIO = path.join(OUT, 'portfolio');

// Не тащим в портфолио, даже если на них ссылаются витрины.
const EXCLUDE = new Set(['chat-engine']);

const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.xml']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

function rewrite(text) {
  return text
    .replace(/\/experiments\/chat-engine\/(?:widget\.html)?/g, '/#contact')
    .replace(/href="\/experiments\/"/g, 'href="/"')
    .replace(/\/experiments\//g, '/portfolio/');
}

function rewriteTree(dir) {
  let files = 0;
  for (const abs of walk(dir)) {
    if (!TEXT_EXT.has(path.extname(abs).toLowerCase())) continue;
    const before = fs.readFileSync(abs, 'utf8');
    const after = rewrite(before);
    if (after !== before) fs.writeFileSync(abs, after);
    files++;
  }
  return files;
}

function copyProject(id) {
  const project = projects.load().find((p) => p.id === id);
  const rel = project?.static || `public/experiments/${id}`;
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) throw new Error(`нет статики ${rel} (проект ${id})`);
  const to = path.join(PORTFOLIO, id);
  fs.cpSync(from, to, { recursive: true });
  return to;
}

function linkedIds(dir) {
  const ids = new Set();
  for (const abs of walk(dir)) {
    if (!TEXT_EXT.has(path.extname(abs).toLowerCase())) continue;
    const text = fs.readFileSync(abs, 'utf8');
    for (const m of text.matchAll(/\/experiments\/([a-z0-9][a-z0-9-]*)\//g)) ids.add(m[1]);
  }
  return ids;
}

function main() {
  if (!fs.existsSync(SRC)) throw new Error(`нет ${SRC}`);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.cpSync(SRC, OUT, { recursive: true });

  const queue = projects.select(projects.load(), 'showcase').map((p) => p.id);
  const done = new Set();

  while (queue.length) {
    const id = queue.shift();
    if (done.has(id)) continue;
    done.add(id);

    const dest = copyProject(id);
    for (const dep of linkedIds(dest)) {
      if (EXCLUDE.has(dep) || done.has(dep)) continue;
      if (!fs.existsSync(path.join(ROOT, 'public', 'experiments', dep))) continue;
      queue.push(dep);
    }
  }

  let files = 0;
  for (const id of done) files += rewriteTree(path.join(PORTFOLIO, id));

  let commit = null;
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch { /* не в git — не страшно */ }

  const build = { builtAt: new Date().toISOString(), commit, portfolio: [...done].sort() };
  fs.writeFileSync(path.join(OUT, 'build.json'), `${JSON.stringify(build, null, 2)}\n`);

  const bytes = walk(OUT).reduce((sum, f) => sum + fs.statSync(f).size, 0);
  console.log(`dist/landing: ${done.size} проектов, ${(bytes / 1024 / 1024).toFixed(2)} МБ`);
  console.log(`  ${[...done].sort().join(', ')}`);
  console.log(`  переписано файлов: ${files}`);
}

main();
