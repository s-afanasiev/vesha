// Обезличивание данных покупателя (152-ФЗ, ст. 21): что в хранимых строках — его
// персональные данные и чем их заменить. Решение — здесь, применение — репозиторий
// одной транзакцией (П15). Строки не удаляются: номер заявки, позиции черновика,
// количества, суммы и события журнала остаются — на них держатся замеры (§6.6).
// Уходит то, по чему можно узнать человека: имя, контакт, текст и файл заявки, ключи
// гостя и содержимого (их стирает репозиторий целиком), а в тексте, который остаётся, —
// почты и телефоны любого вида, контакт и имя из заявки (фразой и по словам; слово от
// четырёх букв — основой с окончанием до трёх букв: «Ипполит» находит «для Ипполита»).
//
// Что остаётся и где проверяем (П40 — потеря объявлена):
//   строка черновика  — source и name: вырезаны ПДн; строка, которую разбор не понял
//                       (raw), — целиком: в ней подпись, реквизиты, адрес;
//   событие журнала   — строки data (имя файла заявки — целиком, строки разбора нейросетью —
//                       как строки черновика); номера, артикулы, числа — как были;
//   синоним товара    — пример из строки покупателя вычищен; фраза с ПДн — синоним уходит.

const { Synonyms } = require('../catalog/Synonyms');

const ERASED = 'данные удалены'; // клиент заявки после обезличивания
const CUT = '[удалено]';         // вырезанный кусок текста
const EMAILS = /[^\s@<>()"'«»,;:]+@[^\s@<>()"'«»,;:]+\.[a-zа-я]{2,}/giu;
// +7 / 8 / 7 и десять цифр с пробелами, скобками, дефисами — или «+код» и 10–14 цифр
const PHONES = /(?<![\d+])(?:(?:\+7|8|7)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}|\+\d(?:[\s()-]*\d){9,13})(?!\d)/g;
// слова обращения, которые не называют человека: форма организации и общие слова
const LEGAL = new Set(['ооо', 'оао', 'зао', 'пао', 'ао', 'ип', 'гуп', 'муп', 'фгуп', 'нко', 'тоо', 'организация', 'компания',
  'общество', 'ограниченной', 'ответственностью', 'индивидуальный', 'предприниматель']);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[её]/giu, '[её]');
const digits = (s) => String(s || '').replace(/\D/g, '');
// Основа слова имени для падежей: «Ольга» → «Ольг» (Ольги, Ольгой), «Пётр» → «Пётр» (Петра).
const stem = (word) => (word.length >= 4 && /[аяйьео]$/iu.test(word) ? word.slice(0, -1) : word);
const ENDING = 3; // сколько букв окончания допускает основа

// Контакт для поиска заявок покупателя: почта строчными, телефон — цифрами с 7 впереди.
// «8 (910) 123-45-67», «+7 910 1234567» и «9101234567» — один телефон; кусок — как есть.
function contactKey(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (text.includes('@')) return text;
  const d = digits(text);
  if (d.length === 11 && (d[0] === '8' || d[0] === '7')) return `7${d.slice(1)}`;
  if (d.length === 10) return `7${d}`;
  return d;
}

// Заявка найдена по запросу кабинета: контакт (любой записью), имя или номер.
function findsOrder(order, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  const want = contactKey(q);
  if (want && contactKey(order.contact).includes(want)) return true;
  if (String(order.client || '').toLowerCase().includes(q)) return true;
  return q.replace(/^№\s*/, '') === String(order.number);
}

class Anonymizer {
  // Кого обезличиваем: контакты и имена заявок → что вырезать из оставшегося текста.
  needles(orders) {
    const patterns = [];
    const keys = new Set();  // контакт и имя целиком, телефон цифрами — в нормальной форме фразы синонима
    const stems = new Set(); // основы слов имени — там же
    for (const o of orders) {
      for (const value of [o.contact, o.client]) {
        const v = String(value || '').trim();
        if (v.length < 3) continue;
        patterns.push(new RegExp(escape(v), 'giu'));
        keys.add(Synonyms.phrase(v));
      }
      const phone = digits(o.contact);
      if (!String(o.contact || '').includes('@') && phone.length >= 10) {
        const tail = phone.slice(-10); // те же десять цифр без кода страны, с любыми разделителями
        patterns.push(new RegExp(`(?<!\\d)${[...tail].join('[\\s()-]*')}(?!\\d)`, 'g'));
        keys.add(tail);
      }
      for (const word of String(o.client || '').split(/[^\p{L}\d-]+/u)) {
        if (word.length < 3 || LEGAL.has(word.toLowerCase()) || /^\d+$/.test(word)) continue;
        const base = word.length >= 4 ? stem(word) : word;
        const ending = word.length >= 4 ? `\\p{L}{0,${ENDING}}` : '';
        patterns.push(new RegExp(`(?<![\\p{L}\\d])${escape(base)}${ending}(?![\\p{L}\\d])`, 'giu'));
        stems.add(Synonyms.phrase(base));
      }
    }
    return { patterns, keys: [...keys].filter(Boolean), stems: [...stems].filter(Boolean) };
  }

  // Текст без почт, телефонов, контакта и имени покупателя.
  scrub(text, needles) {
    let out = String(text ?? '').replace(EMAILS, CUT).replace(PHONES, CUT);
    for (const re of needles.patterns) out = out.replace(re, CUT);
    return out;
  }

  // Строка черновика → { source, name } или null — менять нечего.
  line(l, needles) {
    const next = l.origin === 'raw'
      ? { source: CUT, name: CUT }
      : { source: this.scrub(l.source, needles), name: this.scrub(l.name, needles) };
    return next.source === l.source && next.name === l.name ? null : next;
  }

  // Данные события → новые данные или null. Имя файла заявки — целиком; у строки разбора
  // (объект с origin) нераспознанная — целиком, как строка черновика.
  data(data, needles) {
    let changed = false;
    const walk = (v, key, raw) => {
      if (typeof v === 'string') {
        const next = (key === 'file' && v) || (raw && (key === 'source' || key === 'name')) ? CUT : this.scrub(v, needles);
        if (next !== v) changed = true;
        return next;
      }
      if (Array.isArray(v)) return v.map((x) => walk(x, key, false));
      if (v && typeof v === 'object') {
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k, v.origin === 'raw')]));
      }
      return v;
    };
    const next = walk(data || {}, null, false);
    return changed ? next : null;
  }

  // Синоним, пример которого — строка обезличиваемой заявки: фраза называет покупателя —
  // синоним уходит ({ drop }); иначе пример вычищается, как строка черновика.
  synonym(s, needles, origin) {
    const phrase = ` ${s.phrase} `;
    const words = s.phrase.split(' ');
    const named = needles.keys.some((k) => (/^\d+$/.test(k) ? digits(s.phrase).includes(k) : phrase.includes(` ${k} `)))
      || needles.stems.some((k) => words.some((w) => w.startsWith(k) && w.length - k.length <= ENDING));
    if (named) return { drop: true };
    const example = origin === 'raw' ? CUT : this.scrub(s.example, needles);
    return example === s.example ? null : { example };
  }

  // План обезличивания заявок: какие строки черновика, события и синонимы переписать.
  plan({ orders, lines, events, synonyms }) {
    const needles = this.needles(orders);
    const own = new Set(orders.map((o) => String(o.id)));
    const mine = lines.filter((l) => own.has(String(l.order_id)));
    const origins = new Map(mine.map((l) => [l.source, l.origin])); // исходная строка → как её понял разбор
    return {
      orderIds: [...own],
      client: ERASED,
      lines: mine.map((l) => { const next = this.line(l, needles); return next && { id: l.id, ...next }; }).filter(Boolean),
      events: events.map((e) => { const data = this.data(e.data, needles); return data && { id: e.id, data }; }).filter(Boolean),
      synonyms: synonyms.filter((s) => origins.has(s.example))
        .map((s) => { const next = this.synonym(s, needles, origins.get(s.example)); return next && { phrase: s.phrase, ...next }; })
        .filter(Boolean),
    };
  }
}

module.exports = { Anonymizer, contactKey, findsOrder, ERASED, CUT };
