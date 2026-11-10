// registry.json ← projects/<id>/project.json: каталог экспериментов остаётся
// прежним файлом для страниц и syncRegistry, но собирается из манифестов.
// Запуск: npm run catalog:build [-- --check]
//   --check — ничего не пишет, падает, если registry.json разошёлся с манифестами.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'experiments', 'registry.json');

// Манифест → запись registry.json. Поля, которых нет в манифесте, не появляются.
export function registryFrom(projects) {
  const experiments = projects
    .filter((p) => p.kind === 'experiment')
    .map((p) => {
      const entry = {
        id: p.id,
        title: p.title,
        description: p.description,
        href: `/experiments/${p.id}/`,
        status: p.status,
        tech: p.tech,
      };
      if (p.admin) entry.admin = true;
      if (p.parts) entry.parts = p.parts;
      return entry;
    });
  return { experiments };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { load } = require('../server/projects.js');
  const next = registryFrom(load({ fresh: true }));
  const text = `${JSON.stringify(next, null, 2)}\n`;

  if (process.argv.includes('--check')) {
    const current = fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n');
    if (current !== text) {
      const was = JSON.parse(current).experiments || [];
      const now = next.experiments;
      const ids = [...new Set([...was.map((e) => e.id), ...now.map((e) => e.id)])];
      const diff = ids.filter((id) => JSON.stringify(was.find((e) => e.id === id)) !== JSON.stringify(now.find((e) => e.id === id)));
      console.error(`registry.json разошёлся с манифестами: ${diff.join(', ') || 'порядок или формат'}`);
      console.error('поправьте projects/*/project.json или выполните npm run catalog:build');
      process.exit(1);
    }
    console.log(`registry.json совпадает с манифестами: ${next.experiments.length} записей`);
  } else {
    fs.writeFileSync(OUT, text);
    console.log(`registry.json: ${next.experiments.length} записей из projects/*/project.json`);
  }
}
