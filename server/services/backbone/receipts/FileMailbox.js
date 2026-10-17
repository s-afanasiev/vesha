// Почта квитанций — честный простой узел (О6, §10 шаг 4: «квитанции — на почту»):
// письмо пишется файлом .eml в папку магазина. Настоящая отправка (SMTP) — тот же
// контракт send({ to, subject, body, shop }), подменяется в точке сборки.

const fs = require('node:fs');
const path = require('node:path');

const encode = (s) => `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;

class FileMailbox {
  constructor({ dir, from }) {
    this.dir = dir;
    this.from = from;
  }

  async send({ to, subject, body, shop }) {
    if (!to) throw new Error('нет адреса');
    const folder = path.join(this.dir, shop ? shop.slug : 'shop');
    await fs.promises.mkdir(folder, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(folder, `${stamp}-${Math.random().toString(36).slice(2, 8)}.eml`);
    const letter = [
      `From: ${encode(shop ? shop.name : 'Магазин')} <${this.from}>`,
      `To: <${to}>`,
      `Subject: ${encode(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      body,
      '',
    ].join('\r\n');
    await fs.promises.writeFile(file, letter, 'utf8');
    return { file };
  }
}

module.exports = { FileMailbox };
