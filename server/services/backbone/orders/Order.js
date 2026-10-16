// Заявка — одна сущность от обращения до выдачи (docs/backbone-architecture.md §6.1).
// Order отвечает за форму заявки и за путь в смысловых типах; хранит её репозиторий.
// Колонка — вид, событие — факт: переход пишется как moved(from, to) вместе с типами,
// чтобы замеры и окно статуса читали смысл, а не названия колонок.

const LIMITS = { client: 120, contact: 120, text: 4000 };

function bad(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function field(value, what, max, { required = false } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw bad(`${what}: пусто`);
  if (text.length > max) throw bad(`${what}: не длиннее ${max} символов`);
  return text;
}

// Путь в смысловых типах. Шаг 1: переход разрешён между любыми колонками
// доски; правило-рост — запреты вроде «из отказа только во входящие».
class Path {
  constructor(types) {
    this.types = types;
  }

  // → событие перехода или ошибка
  transition(fromCol, toCol) {
    if (!toCol) throw bad('Нет такой колонки на доске');
    if (fromCol && fromCol.id === toCol.id) throw bad('Заявка уже в этой колонке');
    return {
      type: 'moved',
      data: { from: fromCol ? fromCol.id : null, to: toCol.id, fromType: fromCol ? fromCol.type : null, toType: toCol.type },
    };
  }
}

class Order {
  // Ручная заявка: клиент обязателен, контакт и текст — по желанию.
  static draft({ client, contact, text }) {
    return {
      client: field(client, 'Клиент', LIMITS.client, { required: true }),
      contact: field(contact, 'Контакт', LIMITS.contact),
      text: field(text, 'Текст заявки', LIMITS.text),
    };
  }
}

module.exports = { Order, Path, LIMITS };
