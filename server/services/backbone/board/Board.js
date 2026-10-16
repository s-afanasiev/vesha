// Доска — правило конструктора колонок (docs/backbone-architecture.md §6.2, П14):
// отвечает, можно ли так изменить доску, и называет изменение событием.
// Хранением не занимается: получает колонки и число карточек в них, отдаёт
// новые колонки, переносы карточек и событие. Инварианты живут здесь, а не в
// рендерере (П27):
//   — у каждой колонки ровно один тип из STAGE_TYPES;
//   — типы inbox, done, refused всегда есть хотя бы в одной колонке;
//   — удаление колонки с карточками требует сказать, куда их перенести.

const STAGE_TYPES = ['inbox', 'working', 'waiting_client', 'done', 'refused'];
const REQUIRED_TYPES = ['inbox', 'done', 'refused'];
const TYPE_NAMES = {
  inbox: 'входящие',
  working: 'в работе',
  waiting_client: 'ждём клиента',
  done: 'готово',
  refused: 'отказ',
};

function bad(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

class Board {
  constructor({ types = STAGE_TYPES, required = REQUIRED_TYPES, maxColumns = 12, maxTitle = 40, maxLimit = 999 } = {}) {
    this.types = types;
    this.required = required;
    this.maxColumns = maxColumns;
    this.maxTitle = maxTitle;
    this.maxLimit = maxLimit;
  }

  typeNames() {
    return this.types.map((id) => ({ id, name: TYPE_NAMES[id] || id }));
  }

  // Полная проверка набора колонок — и шаблона при создании доски, и результата любой правки.
  check(columns) {
    if (!columns.length) throw bad('На доске нет колонок');
    if (columns.length > this.maxColumns) throw bad(`Колонок не больше ${this.maxColumns}`);
    const ids = new Set();
    for (const c of columns) {
      if (!c.id || ids.has(c.id)) throw bad(`Повтор или пустой id колонки: ${c.id}`);
      ids.add(c.id);
      if (!this.types.includes(c.type)) throw bad(`Неизвестный тип колонки: ${c.type}`);
    }
    const missing = this.required.filter((t) => !columns.some((c) => c.type === t));
    if (missing.length) {
      throw bad(`На доске должна остаться колонка с типом «${missing.map((t) => TYPE_NAMES[t] || t).join('», «')}»`);
    }
    return columns;
  }

  // op — операция конструктора; counts — число карточек по id колонки.
  // → { columns, moves: [{from, to}], event: {type, data} }
  apply(columns, op = {}, counts = {}) {
    const cols = columns.map((c) => ({ ...c }));
    const find = (id) => {
      const col = cols.find((c) => c.id === id);
      if (!col) throw bad(`Нет колонки: ${id}`);
      return col;
    };
    let moves = [];
    let event;

    switch (op.op) {
      case 'add': {
        const col = {
          id: this.freeId(cols),
          title: this.title(op.title),
          type: this.type(op.type),
          color: op.color === undefined || op.color === null ? null : this.color(op.color),
          limit: this.limit(op.limit),
        };
        const after = op.after ? cols.findIndex((c) => c.id === op.after) : cols.length - 1;
        if (op.after && after < 0) throw bad(`Нет колонки: ${op.after}`);
        cols.splice(after + 1, 0, col);
        event = { type: 'column_added', data: { column: col.id, title: col.title, columnType: col.type } };
        break;
      }
      case 'rename': {
        const col = find(op.id);
        const title = this.title(op.title);
        event = { type: 'column_renamed', data: { column: col.id, from: col.title, to: title } };
        col.title = title;
        break;
      }
      case 'retype': {
        const col = find(op.id);
        const type = this.type(op.type);
        event = { type: 'column_retyped', data: { column: col.id, from: col.type, to: type } };
        col.type = type;
        break;
      }
      case 'recolor': {
        const col = find(op.id);
        const color = op.color === null || op.color === '' ? null : this.color(op.color);
        event = { type: 'column_recolored', data: { column: col.id, from: col.color || null, to: color } };
        col.color = color;
        break;
      }
      case 'limit': {
        const col = find(op.id);
        const limit = this.limit(op.limit);
        event = { type: 'column_limited', data: { column: col.id, from: col.limit || null, to: limit } };
        col.limit = limit;
        break;
      }
      case 'move': {
        const from = cols.findIndex((c) => c.id === op.id);
        if (from < 0) throw bad(`Нет колонки: ${op.id}`);
        const to = Number(op.to);
        if (!Number.isInteger(to) || to < 0 || to >= cols.length) throw bad('Позиция колонки вне доски');
        const [col] = cols.splice(from, 1);
        cols.splice(to, 0, col);
        event = { type: 'column_moved', data: { column: col.id, from, to } };
        break;
      }
      case 'remove': {
        const col = find(op.id);
        const cards = Number(counts[col.id] || 0);
        if (cards > 0) {
          if (!op.moveTo) throw bad(`В колонке «${col.title}» ${cards} карт. — выберите, куда их перенести`);
          if (op.moveTo === col.id) throw bad('Карточки нельзя перенести в удаляемую колонку');
          find(op.moveTo);
          moves = [{ from: col.id, to: op.moveTo }];
        }
        cols.splice(cols.indexOf(col), 1);
        event = { type: 'column_removed', data: { column: col.id, title: col.title, cards, moveTo: cards > 0 ? op.moveTo : null } };
        break;
      }
      default:
        throw bad(`Неизвестная операция доски: ${op.op}`);
    }

    return { columns: this.check(cols), moves, event };
  }

  title(value) {
    const title = String(value || '').trim();
    if (!title) throw bad('Название колонки не может быть пустым');
    if (title.length > this.maxTitle) throw bad(`Название колонки — не длиннее ${this.maxTitle} символов`);
    return title;
  }

  type(value) {
    if (!this.types.includes(value)) throw bad(`Неизвестный тип колонки: ${value}`);
    return value;
  }

  color(value) {
    const color = String(value).trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw bad('Цвет колонки — в виде #rrggbb');
    return color.toLowerCase();
  }

  limit(value) {
    if (value === undefined || value === null || value === '' || Number(value) === 0) return null;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 0 || limit > this.maxLimit) throw bad(`Лимит колонки — целое от 1 до ${this.maxLimit}`);
    return limit;
  }

  freeId(cols) {
    for (let i = 1; ; i++) {
      const id = `col-${i}`;
      if (!cols.some((c) => c.id === id)) return id;
    }
  }
}

module.exports = { Board, STAGE_TYPES, REQUIRED_TYPES, TYPE_NAMES };
