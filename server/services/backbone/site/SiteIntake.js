// Приём заявки с витрины (docs/backbone-architecture.md §6.3, §8): форма «заявка
// списком» → черновик заявки. Текст или файл (xlsx, pdf с текстовым слоем), контакт
// для ответа, согласие на обработку персональных данных (152-ФЗ).
//
// Решения здесь, а не в рендерере (П27):
//   — контакт — почта или телефон, иначе ответить некуда;
//   — скан или фото — заявку принимаем, но с именованным отказом: квитанция попросит
//     прислать текст (§8, сценарий «клиент прислал скан»); неподходящий формат и
//     слишком большой файл — отказ сразу, клиент исправит на месте;
//   — ключ «контакт + содержимое»: тот же список дважды — одна заявка (П36).

const crypto = require('node:crypto');
const { LIMITS } = require('../orders/Order');

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const ACCEPT_LATER = new Set(['scan']); // отказ разбора, с которым заявку всё равно принимаем

function bad(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// Контакт → { kind: 'email' | 'phone', value } или ошибка.
function contactOf(raw) {
  const text = String(raw ?? '').trim();
  if (EMAIL.test(text)) return { kind: 'email', value: text.toLowerCase() };
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 10 && digits.length <= 15 && /^[+\d\s()-]+$/.test(text)) {
    const ru = digits.length === 11 && (digits[0] === '7' || digits[0] === '8') ? `+7${digits.slice(1)}` : null;
    return { kind: 'phone', value: ru || (digits.length === 10 ? `+7${digits}` : `+${digits}`) };
  }
  throw bad('Укажите почту или телефон для ответа');
}

class SiteIntake {
  constructor(requestText, { maxText = LIMITS.text } = {}) {
    this.requestText = requestText; // тот же RequestText, что у инструмента: форматы и отказы одни
    this.maxText = maxText;
  }

  // form: { name, contact, text, consent, website }, file: { name, data } | null
  // → { draft, contentKey, contact, refusal }
  async read(form = {}, file = null) {
    if (String(form.website ?? '').trim()) throw bad('Заявка не принята'); // поле-ловушка для роботов
    const consent = ['on', 'true', '1', 'yes'].includes(String(form.consent ?? '').toLowerCase());
    if (!consent) throw bad('Нужно согласие на обработку персональных данных — иначе мы не сможем ответить');
    const contact = contactOf(form.contact);
    const typed = String(form.text ?? '').trim();
    let fromFile = '';
    let refusal = null;
    if (file && file.data && file.data.length) {
      try {
        const { lines } = await this.requestText.read({ file });
        fromFile = lines.join('\n');
      } catch (err) {
        if (!err.refusal) throw err;
        if (!ACCEPT_LATER.has(err.code)) throw bad(err.message);
        refusal = { code: err.code, message: err.message, file: String(file.name || '') };
        fromFile = `[файл «${refusal.file}»: ${err.message}]`;
      }
    }
    const text = [typed, fromFile].filter(Boolean).join('\n');
    if (!text) throw bad('Пришлите список: текстом или файлом xlsx, pdf');
    if (text.length > this.maxText) throw bad(`Список длиннее ${this.maxText} символов — пришлите его файлом`);
    const name = String(form.name ?? '').trim().slice(0, LIMITS.client);
    const draft = { client: name || contact.value, contact: contact.value, text, channel: 'site' };
    const normal = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const contentKey = crypto.createHash('sha256').update(`${contact.value}\n${normal}`).digest('hex').slice(0, 40);
    return { draft, contentKey, contact, refusal };
  }
}

module.exports = { SiteIntake, contactOf };
