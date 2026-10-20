// Пароль своего ящика магазина в базе — только зашифрованным (docs/backbone-handover.md §4.9):
// AES-256-GCM ключом сервера из .env (BACKBONE_MAIL_KEY). Утечка базы или бэкапа пароль не
// выдаёт, подмену шифра выдаёт тег. Шифр привязан к магазину (AAD — id магазина): строку
// одного магазина в чужую не переложить. Ключа нет — точка сборки этот узел не строит, и
// своя почта магазина выключена: письма идут с общего ящика сервера.

const crypto = require('node:crypto');

const VERSION = 'v1';
const b64 = (buf) => buf.toString('base64url');

class MailSecret {
  constructor({ key }) {
    const raw = String(key ?? '');
    if (raw.length < 32) throw new Error('BACKBONE_MAIL_KEY: от 32 знаков — openssl rand -hex 32');
    // ключ шифра — из строки .env любого вида, с назначением в имени: другой узел из той же строки получит другой ключ
    this.key = Buffer.from(crypto.hkdfSync('sha256', raw, Buffer.alloc(0), 'backbone-shop-mail', 32));
  }

  seal(text, shopId) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(String(shopId)));
    const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(data)].join(':');
  }

  // Сменили ключ, подменили строку или взяли её у другого магазина — отказ, а не мусор.
  open(sealed, shopId) {
    const [version, iv, tag, data] = String(sealed ?? '').split(':');
    try {
      if (version !== VERSION) throw new Error(version);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(String(shopId)));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('пароль ящика не расшифровывается ключом сервера (BACKBONE_MAIL_KEY сменился?) — сохраните настройки ящика заново');
    }
  }
}

module.exports = { MailSecret };
