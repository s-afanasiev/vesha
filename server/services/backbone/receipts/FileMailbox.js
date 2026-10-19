// Почта квитанций — честный простой узел (О6, §10 шаг 4: «квитанции — на почту»):
// письмо пишется файлом .eml в папку магазина. Настоящая отправка — SmtpMailbox
// с тем же контрактом send({ to, subject, body, shop, replyTo }), выбор — в точке сборки.
// Файлы хранят адрес и тело письма — при удалении данных покупателя их стирает forget.

const fs = require('node:fs');
const path = require('node:path');
const { letterOf } = require('./letter');

class FileMailbox {
  constructor({ dir, from }) {
    this.dir = dir;
    this.from = from;
  }

  async send({ to, subject, body, shop, replyTo = null }) {
    if (!to) throw new Error('нет адреса');
    const folder = path.join(this.dir, shop ? shop.slug : 'shop');
    await fs.promises.mkdir(folder, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(folder, `${stamp}-${Math.random().toString(36).slice(2, 8)}.eml`);
    const letter = letterOf({ from: this.from, to, subject, body, shop, replyTo });
    await fs.promises.writeFile(file, letter.text, 'utf8');
    return { file, messageId: letter.messageId };
  }

  // Удаление данных покупателя: файлы писем магазина, где есть его контакт и номер его
  // заявки («№5», не «№51»), — другие заявки того же контакта не трогаем. → сколько удалено.
  async forget({ shop, contacts = [], numbers = [] }) {
    if (!contacts.length || !numbers.length) return 0;
    const folder = path.join(this.dir, shop ? shop.slug : 'shop');
    let names;
    try {
      names = await fs.promises.readdir(folder);
    } catch (err) {
      if (err.code === 'ENOENT') return 0;
      throw err;
    }
    const marks = numbers.map((n) => new RegExp(`№${Number(n)}(?![0-9])`));
    let removed = 0;
    for (const name of names.filter((n) => n.endsWith('.eml'))) {
      const file = path.join(folder, name);
      const text = await fs.promises.readFile(file, 'utf8');
      if (contacts.some((c) => text.includes(c)) && marks.some((m) => m.test(text))) {
        await fs.promises.unlink(file);
        removed++;
      }
    }
    return removed;
  }
}

module.exports = { FileMailbox };
