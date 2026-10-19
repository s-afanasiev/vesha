// Черновик ответа менеджеру (docs/backbone-architecture.md §6.4: «остальное — черновик
// менеджеру, как сейчас в chat-engine»): ReplySuggester ядра chat-engine работает без
// правки, через свой же контракт репозитория (dialogueById, messagesOf, persona,
// createDraft).
//
// ShopPersona — тот же DialogueRepository, но персона — магазина: персона территории
// магазинов (ключ backbone.persona, демо chat-engine её не правит) плюс название, ниша,
// часы и правило «цены, наличие и статус называет ассистент по фактам, а не черновик» (О18).
// replyModel — модель черновика: та же, что у разбора заявки (GuardedLlm: шлюз, квота
// того, кто нажал, П37), и телефоны с почтой вырезаны из всего, что ей уходит (§6.4).

const { hoursText } = require('../shops/ShopForm');
const { NICHE_NAMES } = require('../board/templates');

const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-zа-я]{2,}/gi;
const PHONE = /(?<![\d\p{L}])\+?\d(?:[\s()-]{0,2}\d){9,14}(?!\d)/gu; // 10–15 цифр с разделителями

function withoutContacts(text) {
  return String(text ?? '').replace(EMAIL, '[почта]').replace(PHONE, '[телефон]');
}

class ShopPersona {
  constructor(dialogues, shop) {
    this.dialogues = dialogues; // DialogueRepository ядра chat-engine
    this.shop = shop;
  }

  dialogueById(id) {
    return this.dialogues.dialogueById(id);
  }

  messagesOf(id, options) {
    return this.dialogues.messagesOf(id, options);
  }

  createDraft(id, text) {
    return this.dialogues.createDraft(id, text);
  }

  async persona() {
    const s = this.shop;
    return [
      await this.dialogues.persona(),
      `Ты отвечаешь от имени магазина «${s.name}» (${NICHE_NAMES[s.niche] || s.niche}) в чате на его сайте.`,
      `Часы работы: ${hoursText(s.hours)}.`,
      'Цены, наличие и статус заявок не называй: их клиенту даёт ассистент по каталогу и журналу заявок. Если спрашивают о них — попроси точное наименование с размером или номер заявки.',
      'Список товаров клиент может прислать сюда же строками «наименование — количество» — его оформят заявкой.',
    ].join('\n');
  }
}

// GuardedLlm | RecordedLlm → completeChat для ReplySuggester: { messages } → { text }.
function replyModel(llm, user) {
  return ({ messages }) => llm.forActor(user).complete(
    messages.map((m) => ({ ...m, content: withoutContacts(m.content) })),
  );
}

module.exports = { ShopPersona, replyModel, withoutContacts };
