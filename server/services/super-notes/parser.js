// Парсер иерархических списков и структурированных ссылок для Суперсправочника

/**
 * Извлекает URL из строки (если есть)
 */
function extractUrl(text) {
  const match = String(text || '').match(/https?:\/\/[^\s)"]+/i);
  return match ? match[0] : null;
}

/**
 * Парсит произвольный текст (список строк, markdown-список) в массив структурированных элементов
 * Примеры входных данных:
 * 1) plasma-discover - https://userbase.kde.org/Discover - GUI центр KDE
 * 2) * [flatpak](https://flatpak.org) — песочницы приложений
 * 3) https://github.com/stplr (CLI утилита)
 */
function parseHierarchicalItems(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];

  for (const line of lines) {
    // 1. Markdown ссылка: * [Title](url) - description или [Title](url) description
    const mdMatch = line.match(/^[-*•\d.)\s]*\[([^\]]+)\]\((https?:\/\/[^)]+)\)(?:\s*[-—:]\s*(.*))?$/i);
    if (mdMatch) {
      items.push({
        title: mdMatch[1].trim(),
        url: mdMatch[2].trim(),
        description: (mdMatch[3] || '').trim(),
      });
      continue;
    }

    // 2. Если в строке есть URL: всё до URL — название, всё после URL — описание
    const url = extractUrl(line);
    if (url) {
      const urlIdx = line.indexOf(url);
      const beforeUrl = line
        .slice(0, urlIdx)
        .replace(/^[-*•\d.)\s]+/, '')
        .replace(/\s*[-—|:]\s*$/, '')
        .trim();
      const afterUrl = line
        .slice(urlIdx + url.length)
        .replace(/^\s*[-—|:]\s*/, '')
        .trim();

      let title = beforeUrl;
      let description = afterUrl;

      if (!title) {
        try {
          const u = new URL(url);
          title = u.hostname.replace(/^www\./, '');
        } catch {
          title = url;
        }
      }

      items.push({
        title: title.trim(),
        url: url.trim(),
        description: description.trim(),
      });
      continue;
    }

    // 3. Обычный текстовый пункт без URL
    const cleaned = line.replace(/^[-*•\d.)\s]+/, '').trim();
    if (cleaned) {
      const subParts = cleaned.split(/\s+[-—|:]\s+/);
      items.push({
        title: subParts[0].trim(),
        url: null,
        description: subParts.slice(1).join(' — ').trim(),
      });
    }
  }

  return items;
}

/**
 * Нормализует список тегов из строки или массива
 * "#linux, devops, #tools" -> ["linux", "devops", "tools"]
 */
function parseTags(input) {
  if (!input) return [];
  let rawList = [];
  if (Array.isArray(input)) {
    rawList = input;
  } else if (typeof input === 'string') {
    rawList = input.split(/[,;\s]+/);
  }
  const set = new Set();
  for (const item of rawList) {
    const clean = String(item || '')
      .trim()
      .replace(/^#+/, '')
      .toLowerCase();
    if (clean && clean.length <= 40 && !clean.includes(' ')) {
      set.add(clean);
    }
  }
  return Array.from(set);
}

module.exports = {
  extractUrl,
  parseHierarchicalItems,
  parseTags,
};
