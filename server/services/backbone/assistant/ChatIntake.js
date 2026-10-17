// Заявка из разговора с ассистентом (docs/backbone-architecture.md §4: Intake.chat,
// §6.4): список, который клиент написал в чат, ассистент предлагает отправить заявкой;
// согласие и контакт → заявка. Решения здесь (П27):
//   — список узнают те же правила, что разбирают заявку (RuleLines: «наименование —
//     количество ед.»): две строки с количеством — список; одна — если это не вопрос;
//   — контакт и согласие на обработку персональных данных — как у сайта (152-ФЗ);
//   — ключ «контакт + содержимое» — тот же, что у сайта (contentKey): тот же список
//     в чате и на сайте — одна заявка, второй канал — событие received_again (П36).

const { contactOf, contentKey } = require('../site/SiteIntake');
const { LIMITS } = require('../orders/Order');

const QUESTION = /\?|^\s*(?:есть|почем|почём|сколько|какие|какая|какой|а есть|у вас)/i;

function bad(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

class ChatIntake {
  constructor(ruleLines, { maxText = LIMITS.text } = {}) {
    this.ruleLines = ruleLines;
    this.maxText = maxText;
  }

  // Сообщение → { lines } — похоже на список; null — нет.
  listOf(text) {
    const { lines } = this.ruleLines.of(String(text ?? '').split('\n'));
    if (lines.length >= 2 || (lines.length === 1 && !QUESTION.test(text))) return { lines: lines.length };
    return null;
  }

  // form: { contact, name, consent }, text — сообщение-список → { draft, contentKey, contact }
  read(form = {}, text) {
    const consent = ['on', 'true', '1', 'yes'].includes(String(form.consent ?? '').toLowerCase());
    if (!consent) throw bad('Нужно согласие на обработку персональных данных — иначе мы не сможем ответить');
    const contact = contactOf(form.contact);
    const list = String(text ?? '').trim();
    if (!this.listOf(list)) throw bad('Это сообщение не похоже на список: «наименование — количество», по строке на позицию');
    if (list.length > this.maxText) throw bad(`Список длиннее ${this.maxText} символов — пришлите его файлом формой «Заявка списком»`);
    const name = String(form.name ?? '').trim().slice(0, LIMITS.client);
    const draft = { client: name || contact.value, contact: contact.value, text: list, channel: 'chat' };
    return { draft, contentKey: contentKey(contact.value, list), contact };
  }
}

module.exports = { ChatIntake };
