// Точка сборки компонентных экземпляров костяка (docs/ui-components.md §1).
// Данные и правила — только через дверь BackboneDesk (П28): колонки доски — от
// источника при каждом запросе, перенос — desk.moveOrder, конструктор — desk.configure,
// новая заявка — desk.createOrder. Журнал и каталог — таблицы table@1.
// Шаг 2 — экран черновика: заявки с кнопкой «Разобрать» (desk.parseOrder), строки
// черновиков с правкой менеджера (desk.review) и синонимы магазина.
// Шаг 3 — счёт: выгрузка в xlsx для 1С, «счёт отправлен» (помощь), «приложить счёт
// из 1С» (тень); экран замеров: «до / после» и недели (desk.measures, desk.switchMode).
// Монтируется в server/routes/backbone.js под /api/backbone/c (за requireAdmin).

const { Components } = require('../../components');
const { Kanban } = require('../../components/kanban');
const { Table } = require('../../components/table');
const { backboneDesk, board, catalog, demoRequest, DEMO_SHOP } = require('./index');
const { TYPE_NAMES } = require('./board/Board');

const actorOf = (user) => (user && (user.email || user.id)) || 'admin';

// Событие журнала — строкой для человека; колонки — по текущим названиям,
// удалённая колонка остаётся своим id.
function describe(e, titles) {
  const d = e.data || {};
  const col = (id) => (id ? `«${titles.get(id) || id}»` : '—');
  switch (e.type) {
    case 'board_created': return `доска создана из шаблона «${d.niche}»: ${(d.columns || []).length} колонок`;
    case 'received': return `заявка №${d.number} принята в ${col(d.column)}`;
    case 'moved': return `заявка №${d.number}: ${col(d.from)} → ${col(d.to)}${e.cause === 'column_removed' ? ' (колонку удалили)' : ''}`;
    case 'column_added': return `колонка ${col(d.column)} добавлена, тип «${TYPE_NAMES[d.columnType] || d.columnType}»`;
    case 'column_renamed': return `колонка «${d.from}» переименована в «${d.to}»`;
    case 'column_retyped': return `колонка ${col(d.column)}: тип «${TYPE_NAMES[d.from] || d.from}» → «${TYPE_NAMES[d.to] || d.to}»`;
    case 'column_moved': return `колонка ${col(d.column)} переставлена: ${d.from + 1} → ${d.to + 1}`;
    case 'column_recolored': return `колонка ${col(d.column)}: цвет ${d.to || 'по умолчанию'}`;
    case 'column_limited': return `колонка ${col(d.column)}: лимит ${d.to || 'снят'}`;
    case 'column_removed': return `колонка «${d.title}» удалена${d.cards ? `, ${d.cards} карт. → ${col(d.moveTo)}` : ''}`;
    case 'parsed': return `заявка №${d.number} разобрана: ${d.lines} строк (правила ${d.rule}, модель ${d.model}${d.raw ? `, не разобрано ${d.raw}` : ''}${d.verify ? `, проверить ${d.verify}` : ''})${(d.failures || []).length ? ` · ${d.failures.join(', ')}` : ''}`;
    case 'draft_ready': return `черновик №${d.number}: ${d.accepted} принято, ${d.ask} выбрать, ${d.missing} нет в каталоге, ${d.questions} вопросов · ${money(d.sum)} ₽`;
    case 'parse_failed': return `заявка №${d.number} не разобрана: ${d.reason}`;
    case 'invoice_exported': return `черновик №${d.number} выгружен в xlsx: в счёт ${d.lines} строк на ${money(d.sum)} ₽${d.left ? `, не вошло ${d.left}` : ''}`;
    case 'invoice_sent': return d.mode === 'shadow'
      ? `тень, заявка №${d.number}: счёт из 1С приложен — совпало ${d.matched} из ${d.final} строк, в черновике ${d.draft}; точность ${ratio(d.accuracy)}`
      : `счёт по заявке №${d.number} отправлен: без правки ${d.right} из ${d.base} строк`;
    case 'mode_changed': return `режим магазина: ${MODES[d.from]} → ${MODES[d.to]} — ${d.reason}`;
    case 'reviewed': return `черновик №${d.number}, строка ${d.line}: ${VERDICTS[d.verdict] || d.verdict}${d.verdict === 'replaced' ? ` ${d.from || '—'} → ${d.to}` : ''}${d.verdict === 'edited' ? ` ${d.from ?? '—'} → ${d.to}` : ''}${d.synonym ? ` · синоним «${d.synonym}»` : ''}`;
    default: return e.type;
  }
}

const VERDICTS = { accepted: 'принята', replaced: 'позиция заменена', edited: 'количество' };
const MODES = { shadow: 'тень', help: 'помощь' };
const STREAMS = { order: 'заявка', board: 'доска', shop: 'магазин' };
const ratio = (x) => (x == null ? '—' : String(Math.round(x * 100) / 100).replace('.', ','));
const pct = (x) => (x == null ? null : `${Math.round(x * 100)} %`);
const mins = (x) => (x == null ? null : `${String(Math.round(x * 10) / 10).replace('.', ',')} мин`);
const day = (at) => new Date(at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
const accuracyText = (a) => (a.value == null ? null : `${ratio(a.value)} (${a.base} стр.)`);
const conversionText = (c) => (c.value == null ? null : `${pct(c.value)} (${c.won} из ${c.won + c.lost})`);
function delta(before, after, kind) {
  if (before == null || after == null) return null;
  if (kind === 'pct') return `${after - before >= 0 ? '+' : ''}${Math.round((after - before) * 100)} п.п.`;
  return `${after - before >= 0 ? '+' : ''}${String(Math.round((after - before) * 10) / 10).replace('.', ',')}`;
}
const STATES = { accepted: '✓ принято', ask: '? выбрать', missing: '✗ нет в каталоге' };
const ORIGINS = { rule: 'правило', model: 'модель', raw: 'не разобрано' };
const money = (n) => (n == null ? '' : Number(n).toFixed(2));
const amount = (n, unit) => (n == null ? null : `${String(n).replace('.', ',')} ${unit || ''}`.trim());
const itemName = (sku) => {
  const item = sku && catalog.bySku(sku);
  return item ? `${sku} · ${item.name}` : sku || null;
};

// Последний исход разбора заявки — словами; в тени черновик менеджеру не показываем.
function statusOf(d, mode) {
  const e = d.outcome;
  if (d.sent) {
    return d.sent.data.mode === 'shadow'
      ? `счёт из 1С приложен · точность ${ratio(d.sent.data.accuracy)}`
      : `счёт отправлен · без правки ${d.sent.data.right} из ${d.sent.data.base}`;
  }
  if (e && e.type === 'parse_failed') return `отказ: ${e.data.reason}${d.lines ? ' (черновик прежний)' : ''}`;
  if (d.lines && mode === 'shadow') return 'тень: черновик скрыт до счёта из 1С';
  if (d.lines) return d.reviewed ? `черновик, правок ${d.reviewed}` : 'черновик';
  return 'не разобрана';
}

module.exports = Components({
  'board': Kanban({
    columns: () => backboneDesk.columns(DEMO_SHOP),
    columnKey: 'column',
    card: { title: 'title', snippet: 'snippet', time: 'created_at' },
    cards: async () => {
      const shop = await backboneDesk.shop(DEMO_SHOP);
      const drafts = new Map((await backboneDesk.drafts(DEMO_SHOP)).map((d) => [d.order.id, d]));
      return (await backboneDesk.orders(DEMO_SHOP)).map((o) => {
        const d = drafts.get(o.id);
        const seen = d && d.lines && (shop.mode !== 'shadow' || d.sent); // в тени черновик скрыт до счёта
        const badges = o.contact && o.text ? [{ text: o.contact }] : [];
        if (seen) badges.push({ text: `черновик ${d.accepted}/${d.lines}`, kind: 'draft' });
        if (seen && d.questions) badges.push({ text: `вопросов ${d.questions}`, kind: 'waiting' });
        if (d && d.sent) badges.push({ text: 'счёт отправлен' });
        return { id: o.id, column: o.column_id, title: `№${o.number} · ${o.client}`, snippet: o.text || o.contact, created_at: o.created_at, badges };
      });
    },
    move: ({ cardId, to, user }) => backboneDesk.moveOrder(DEMO_SHOP, cardId, to, { actor: actorOf(user), cause: 'drag' }),
    create: {
      label: 'Новая заявка',
      fields: [
        { key: 'client', label: 'Клиент', required: true },
        { key: 'contact', label: 'Контакт' },
        { key: 'text', label: 'Что нужно', multiline: true },
      ],
      run: ({ fields, user }) => backboneDesk.createOrder(DEMO_SHOP, fields, actorOf(user)),
    },
    configure: {
      types: board.typeNames(),
      run: ({ op, user }) => backboneDesk.configure(DEMO_SHOP, op, actorOf(user)),
    },
  }),

  'journal': Table({
    rows: async () => {
      const [events, columns] = await Promise.all([backboneDesk.journalOf(DEMO_SHOP, { limit: 300 }), backboneDesk.columns(DEMO_SHOP)]);
      const titles = new Map(columns.map((c) => [c.id, c.title]));
      // удалённая колонка — по названию из события удаления
      for (const e of events) {
        if (e.type === 'column_removed' && !titles.has(e.data.column)) titles.set(e.data.column, e.data.title);
      }
      return events.map((e) => ({
        id: String(e.id),
        at: new Date(e.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
        stream: STREAMS[e.stream] || e.stream,
        what: describe(e, titles),
        actor: e.actor,
        cause: e.cause,
      }));
    },
    idKey: 'id',
    columns: [
      { key: 'id', name: '№', type: 'num', sortable: true },
      { key: 'at', name: 'Когда' },
      { key: 'stream', name: 'Поток', sortable: true },
      { key: 'what', name: 'Событие' },
      { key: 'actor', name: 'Кто' },
      { key: 'cause', name: 'Почему' },
    ],
    search: ['what', 'actor', 'stream'],
  }),

  // ---------- шаг 2: экран черновика ----------

  'drafts': Table({
    rows: async () => {
      const shop = await backboneDesk.shop(DEMO_SHOP);
      const hidden = shop.mode === 'shadow';
      return (await backboneDesk.drafts(DEMO_SHOP)).map((d) => {
        const has = d.lines > 0 && (!hidden || d.sent);
        return {
          id: d.order.id,
          number: d.order.number,
          client: d.order.client,
          status: statusOf(d, shop.mode),
          lines: has ? d.lines : null,
          accepted: has ? d.accepted : null,
          ask: has ? d.ask : null,
          missing: has ? d.missing : null,
          questions: has ? d.questions : null,
          reviewed: has ? d.reviewed : null,
          sum: has ? d.sum : null,
        };
      });
    },
    idKey: 'id',
    columns: [
      { key: 'number', name: '№', type: 'num', sortable: true },
      { key: 'client', name: 'Клиент', sortable: true },
      { key: 'status', name: 'Разбор' },
      { key: 'lines', name: 'Строк', type: 'num', sortable: true },
      { key: 'accepted', name: 'Принято', type: 'num' },
      { key: 'ask', name: 'Выбрать', type: 'num' },
      { key: 'missing', name: 'Нет в каталоге', type: 'num' },
      { key: 'questions', name: 'Вопросов', type: 'num' },
      { key: 'reviewed', name: 'Правок', type: 'num' },
      { key: 'sum', name: 'Сумма, ₽', type: 'num', sortable: true },
    ],
    search: ['client', 'status'],
    actions: [
      {
        id: 'parse', name: 'Разобрать', bulk: true, max: 5,
        run: async ({ ids, user }) => {
          const done = [];
          for (const id of ids) {
            try {
              const r = await backboneDesk.parseOrder(DEMO_SHOP, id, { actor: actorOf(user), user });
              const notes = (r.failures || []).map((f) => f.detail).join('; ');
              done.push(r.ok ? `№${r.number}: ${r.summary}${notes ? ` (${notes})` : ''}` : `№${r.number}: ${r.message}`);
            } catch (err) {
              done.push(String(err.message || err));
            }
          }
          return { message: done.join(' · ') };
        },
      },
      {
        id: 'export', name: 'Выгрузить в xlsx для 1С', bulk: true, max: 1,
        run: async ({ ids, user }) => {
          const r = await backboneDesk.exportInvoice(DEMO_SHOP, ids[0], actorOf(user));
          return {
            ...r,
            message: `№${r.number}: в счёт ${r.included} строк на ${money(r.sum)} ₽${r.left ? `, не вошло ${r.left} — лист «Вопросы и пропуски»` : ''}`,
            download: `/api/backbone/files/invoice/${r.orderId}.xlsx`,
          };
        },
      },
      {
        id: 'sent', name: 'Счёт отправлен', bulk: true, max: 1,
        run: async ({ ids, user }) => {
          const r = await backboneDesk.invoiceSent(DEMO_SHOP, ids[0], actorOf(user));
          return { ...r, message: `№${r.number}: счёт отправлен, без правки ${r.right} из ${r.base} строк` };
        },
      },
      {
        id: 'attach', name: 'Приложить счёт из 1С', bulk: true, max: 1,
        fields: [{ key: 'invoice', label: 'Строки счёта из 1С', required: true, multiline: true, placeholder: 'скопируйте табличную часть счёта в 1С и вставьте сюда' }],
        run: async ({ ids, body, user }) => {
          const r = await backboneDesk.attachInvoice(DEMO_SHOP, ids[0], body.invoice, { actor: actorOf(user), user });
          return { ...r, message: `№${r.number}: совпало ${r.matched} из ${r.final} строк счёта, в черновике ${r.draft}; точность ${ratio(r.accuracy)}${r.unknown ? `; не узнано строк: ${r.unknown}` : ''}` };
        },
      },
      {
        id: 'demo', name: 'Демо-заявка на 20 строк',
        run: async ({ user }) => {
          const order = await backboneDesk.createOrder(DEMO_SHOP, {
            client: 'ООО «СтройМонтаж» (демо)', contact: 'snab@example.ru', text: demoRequest(),
          }, actorOf(user));
          return { message: `Заявка №${order.number} создана — отметьте её и нажмите «Разобрать»` };
        },
      },
    ],
  }),

  'lines': Table({
    rows: async () => (await backboneDesk.managerLines(DEMO_SHOP)).map((l) => {
      const item = l.sku ? catalog.bySku(l.sku) : null;
      return {
        id: l.id,
        order: l.number,
        orderTag: `№${l.number}`,
        pos: l.position,
        source: l.source,
        item: itemName(l.sku),
        confidence: l.confidence,
        stateId: l.state,
        state: `${STATES[l.state]}${l.review ? ' · менеджер' : ''}`,
        candidates: l.state === 'accepted' ? null
          : l.candidates.map((c, i) => `${i + 1}) ${c.sku} ${String(c.score).replace('.', ',')}`).join(' · ') || null,
        want: amount(l.qty, l.unit),
        invoice: amount(l.invoice_qty, item && item.unit),
        price: l.price,
        sum: l.invoice_qty != null && l.price != null ? Math.round(l.invoice_qty * l.price * 100) / 100 : null,
        question: l.question,
        origin: `${ORIGINS[l.origin]}${l.verify ? ` · ${l.verify}` : ''}`,
      };
    }),
    idKey: 'id',
    columns: [
      { key: 'order', name: 'Заявка', type: 'num', sortable: true },
      { key: 'pos', name: 'Стр.', type: 'num', sortable: true },
      { key: 'source', name: 'Как написал клиент' },
      { key: 'item', name: 'Позиция' },
      { key: 'confidence', name: 'Уверенность', type: 'num', sortable: true },
      { key: 'state', name: 'Состояние', sortable: true },
      { key: 'candidates', name: 'Кандидаты' },
      { key: 'want', name: 'Просит' },
      { key: 'invoice', name: 'В счёт' },
      { key: 'price', name: 'Цена, ₽', type: 'num' },
      { key: 'sum', name: 'Сумма, ₽', type: 'num', sortable: true },
      { key: 'question', name: 'Вопрос клиенту' },
      { key: 'origin', name: 'Кто разобрал' },
    ],
    search: ['orderTag', 'source', 'item', 'state', 'question'],
    select: {
      presets: [
        { id: 'ask', name: 'Все «выбрать»', where: (r) => r.stateId === 'ask' },
        { id: 'missing', name: 'Все «нет в каталоге»', where: (r) => r.stateId === 'missing' },
        { id: 'questions', name: 'С вопросом', where: (r) => !!r.question },
      ],
    },
    actions: [
      {
        id: 'accept', name: 'Принять', bulk: true, max: 200,
        run: async ({ ids, user }) => {
          const r = await backboneDesk.review(DEMO_SHOP, ids, { verdict: 'accepted' }, actorOf(user));
          return { ...r, message: `Принято строк: ${r.lines}${r.synonyms ? `, новых синонимов: ${r.synonyms}` : ''}` };
        },
      },
      {
        id: 'replace', name: 'Заменить позицию', bulk: true, max: 1,
        fields: [{ key: 'sku', label: 'Артикул или № кандидата', required: true, placeholder: 'SW-3.5x35-YZ или 2' }],
        run: async ({ ids, body, user }) => {
          const r = await backboneDesk.review(DEMO_SHOP, ids, { verdict: 'replaced', sku: body.sku }, actorOf(user));
          return { ...r, message: 'Позиция заменена — синоним записан: в следующей заявке эта фраза найдётся сама' };
        },
      },
      {
        id: 'qty', name: 'Количество', bulk: true, max: 1,
        fields: [{ key: 'qty', label: 'Сколько в счёт (в единице позиции)', required: true, placeholder: '50' }],
        run: async ({ ids, body, user }) => {
          const r = await backboneDesk.review(DEMO_SHOP, ids, { verdict: 'edited', qty: body.qty }, actorOf(user));
          return { ...r, message: 'Количество исправлено, упаковка и остаток пересчитаны' };
        },
      },
    ],
  }),

  // ---------- шаг 3: замеры из журнала ----------

  'summary': Table({
    rows: async () => {
      const { shop, report, decision, days, shadowDays } = await backboneDesk.measures(DEMO_SHOP);
      const b = report.before;
      const a = report.after;
      const silent = report.silence;
      const row = (id, metric, before, after, d = null, note = null) => ({ id, metric, before, after, delta: d, note });
      return [
        row('mode', 'Режим',
          shop.mode === 'shadow' ? `тень с ${day(shop.mode_since)}, ${shadowDays ? `день ${days} из ${shadowDays}` : 'без срока'}` : null,
          shop.mode === 'help' ? `помощь с ${day(shop.mode_since)}` : null, null,
          decision ? `${decision.ok ? 'помощь можно включить' : 'помощь пока нельзя'}: ${decision.reason}` : '«Вернуть тень» — новая база «до»'),
        row('orders', 'Заявок', String(b.orders), String(a.orders)),
        row('reply1h', 'Ответ в течение часа рабочего времени', pct(b.replyWithinHour), pct(a.replyWithinHour), delta(b.replyWithinHour, a.replyWithinHour, 'pct'),
          'ответ — счёт или перенос в «ждём клиента», «готово», «отказ»'),
        row('reply', 'До первого ответа, медиана', mins(b.replyMinutes), mins(a.replyMinutes), delta(b.replyMinutes, a.replyMinutes), 'минуты рабочего времени магазина'),
        row('invoice', 'До счёта, медиана', mins(b.invoiceMinutes), mins(a.invoiceMinutes), delta(b.invoiceMinutes, a.invoiceMinutes), 'главный эффект инструмента'),
        row('manager', 'Минуты менеджера на заявку, медиана', null, mins(a.managerMinutes), null, 'в тени менеджер работает в 1С — видно только время до счёта'),
        row('accuracy', 'Точность черновика', accuracyText(b.shadowAccuracy), accuracyText(a.untouched), null,
          'тень: черновик против счёта из 1С; помощь: строки без правки; порог помощи — 0,8'),
        row('missing', 'Нет в каталоге, доля строк', pct(b.missingShare), pct(a.missingShare), delta(b.missingShare, a.missingShare, 'pct'), 'полнота каталога и синонимов'),
        row('questions', 'Вопросы клиенту, доля строк', pct(b.questionShare), pct(a.questionShare), delta(b.questionShare, a.questionShare, 'pct')),
        row('conversion', 'Конверсия: выдано / (выдано + отказ)', conversionText(b.conversion), conversionText(a.conversion),
          delta(b.conversion.value, a.conversion.value, 'pct')),
        row('b2b', 'B2B-заявки: от 5 строк или от организации', pct(b.b2b), pct(a.b2b), null, 'масштаб q для карточки 08'),
        row('silence', 'Тишина сейчас', null, null, null,
          [silent.inbox.length ? `входящие дольше часа: №${silent.inbox.join(', №')}` : '', silent.waitingClient.length ? `ждём клиента дольше 2 дн.: №${silent.waitingClient.join(', №')}` : '']
            .filter(Boolean).join('; ') || 'нет'),
        row('assistant', 'Ответы ассистента без менеджера', null, null, null, 'ассистент — шаг 5'),
      ];
    },
    idKey: 'id',
    columns: [
      { key: 'metric', name: 'Метрика' },
      { key: 'before', name: 'Тень (до)' },
      { key: 'after', name: 'Помощь (после)' },
      { key: 'delta', name: 'Разница' },
      { key: 'note', name: 'Пояснение' },
    ],
    actions: [
      {
        id: 'help', name: 'Включить помощь',
        run: async ({ user }) => {
          const r = await backboneDesk.switchMode(DEMO_SHOP, 'help', actorOf(user));
          return { message: `Помощь включена: ${r.reason}` };
        },
      },
      {
        id: 'shadow', name: 'Вернуть тень',
        run: async ({ user }) => {
          await backboneDesk.switchMode(DEMO_SHOP, 'shadow', actorOf(user));
          return { message: 'Тень: черновики скрыты, к заявкам прикладывают счёт из 1С' };
        },
      },
    ],
  }),

  'weeks': Table({
    rows: async () => (await backboneDesk.measures(DEMO_SHOP)).report.weeks.map((w) => ({
      id: w.week,
      week: `с ${w.week.slice(8, 10)}.${w.week.slice(5, 7)}.${w.week.slice(0, 4)}`,
      mode: w.modes.map((m) => MODES[m]).join(' + '),
      orders: w.orders,
      reply1h: pct(w.replyWithinHour),
      reply: mins(w.replyMinutes),
      invoice: mins(w.invoiceMinutes),
      manager: mins(w.managerMinutes),
      shadow: accuracyText(w.shadowAccuracy),
      untouched: accuracyText(w.untouched),
      missing: pct(w.missingShare),
      questions: pct(w.questionShare),
      conversion: conversionText(w.conversion),
      b2b: pct(w.b2b),
    })),
    idKey: 'id',
    columns: [
      { key: 'week', name: 'Неделя' },
      { key: 'mode', name: 'Режим' },
      { key: 'orders', name: 'Заявок', type: 'num' },
      { key: 'reply1h', name: 'Ответ ≤ 1 ч' },
      { key: 'reply', name: 'До ответа' },
      { key: 'invoice', name: 'До счёта' },
      { key: 'manager', name: 'Менеджер' },
      { key: 'shadow', name: 'Точность (тень)' },
      { key: 'untouched', name: 'Без правки (помощь)' },
      { key: 'missing', name: 'Нет в каталоге' },
      { key: 'questions', name: 'Вопросы' },
      { key: 'conversion', name: 'Конверсия' },
      { key: 'b2b', name: 'B2B' },
    ],
  }),

  'synonyms': Table({
    rows: async () => (await backboneDesk.synonymsOf(DEMO_SHOP)).map((s) => ({
      phrase: s.phrase,
      item: itemName(s.sku),
      example: s.example,
      hits: s.hits,
      by: s.created_by,
      at: new Date(s.updated_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
    })),
    idKey: 'phrase',
    columns: [
      { key: 'phrase', name: 'Фраза клиента', sortable: true },
      { key: 'item', name: 'Позиция', sortable: true },
      { key: 'example', name: 'Впервые в строке' },
      { key: 'hits', name: 'Подтверждений', type: 'num', sortable: true },
      { key: 'by', name: 'Кто' },
      { key: 'at', name: 'Когда' },
    ],
    search: ['phrase', 'item', 'example'],
  }),

  'catalog': Table({
    rows: () => catalog.items(),
    idKey: 'sku',
    columns: [
      { key: 'sku', name: 'Артикул', sortable: true },
      { key: 'name', name: 'Наименование', sortable: true },
      { key: 'group', name: 'Группа', sortable: true },
      { key: 'unit', name: 'Ед.' },
      { key: 'pack', name: 'Упак.', type: 'num', sortable: true },
      { key: 'price', name: 'Цена, ₽', type: 'num', sortable: true },
      { key: 'stock', name: 'Остаток', type: 'num', sortable: true },
    ],
    search: ['sku', 'name', 'group'],
  }),
});
