// Приведение чужих полей к общему виду: чистый текст, даты, хэш содержимого.
const crypto = require('crypto');

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  shy: '',
};

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    const value = NAMED_ENTITIES[name.toLowerCase()];
    return value === undefined ? whole : value;
  });
}

function plainText(value, maxChars = 0) {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'object' ? value['#text'] ?? '' : String(value);
  const text = decodeEntities(String(raw).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  if (!maxChars || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function validDate(date) {
  return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
}

// RSS pubDate (RFC 822) или ISO с зоной.
function parseFeedDate(value) {
  const text = plainText(value);
  return text ? validDate(new Date(text)) : null;
}

// Дата без зоны у российских госисточников — московское время.
function parseMoscowDate(value) {
  const text = plainText(value);
  if (!text) return null;
  const hasZone = /(z|[+-]\d{2}:?\d{2})$/i.test(text);
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00` : text;
  return validDate(new Date(hasZone ? iso : `${iso}+03:00`));
}

function contentHash(...parts) {
  const normalized = parts
    .map((part) => plainText(part).toLowerCase().replace(/ё/g, 'е'))
    .join('\n');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

module.exports = {
  plainText,
  parseFeedDate,
  parseMoscowDate,
  contentHash,
};
