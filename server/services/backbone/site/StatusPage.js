// Окно статуса заявки для клиента (docs/backbone-architecture.md §6.2, §6.3; stages@1).
// Клиент видит не названия колонок, а шаги по смысловым типам (О24): «получена →
// в работе → ждём вас → готово». Название текущей колонки — пояснение к шагу
// («Счёт отправлен»). Только номер, шаги и даты: ни контактов, ни текста заявки.
// Окно не исчезает: ссылка через месяц показывает путь до «выдан» (§8).

const STEPS = [
  { type: 'inbox', name: 'Заявка получена' },
  { type: 'working', name: 'В работе' },
  { type: 'waiting_client', name: 'Ждём вашего ответа' },
  { type: 'done', name: 'Готово' },
];

class StatusPage {
  constructor({ steps = STEPS } = {}) {
    this.steps = steps;
  }

  // order, колонки магазина, события заявки по порядку → вид stages@1
  view({ order, columns, events, shopName }) {
    const col = columns.find((c) => c.id === order.column_id) || { type: 'inbox', title: '' };
    const entered = {}; // тип → когда заявка вошла в него последний раз
    let last = order.created_at;
    for (const e of events) {
      if (e.type === 'received') entered.inbox = e.at;
      if (e.type === 'moved' && e.data.toType) entered[e.data.toType] = e.at;
      last = e.at;
    }
    const at = (type) => (entered[type] ? new Date(entered[type]).toISOString() : undefined);
    const base = {
      title: `Заявка №${order.number}`,
      subtitle: `${shopName} · получена ${new Date(order.created_at).toLocaleDateString('ru-RU')}`,
      updatedAt: new Date(last).toISOString(),
    };

    if (col.type === 'refused') {
      return {
        ...base,
        steps: this.steps.map((s) => ({ name: s.name, state: entered[s.type] ? 'done' : 'next', at: at(s.type) })),
        exit: { name: 'Заявка закрыта', tone: 'refused', at: at('refused') },
      };
    }
    const current = this.steps.findIndex((s) => s.type === col.type);
    const steps = this.steps.map((s, i) => {
      if (col.type === 'done' || i < current) return { name: s.name, state: 'done', at: at(s.type) };
      if (i === current) return { name: s.name, state: 'current', at: at(s.type), note: col.title !== s.name ? col.title : undefined };
      return { name: s.name, state: 'next' };
    });
    return { ...base, steps, exit: col.type === 'done' ? { name: col.title || 'Готово', tone: 'done', at: at('done') } : null };
  }
}

module.exports = { StatusPage, STEPS };
