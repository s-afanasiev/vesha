// Почта квитанций — честный простой узел (О6, §10 шаг 4: «квитанции — на почту»):
// письмо пишется файлом .eml в папку магазина. Настоящая отправка — SmtpMailbox
// с тем же контрактом send({ to, subject, body, shop, replyTo }), выбор — в точке сборки.

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
}

module.exports = { FileMailbox };
