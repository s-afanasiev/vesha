// Письмо квитанции — одно на оба почтальона (файл .eml и SMTP): заголовки в
// encoded-word, ответ клиента — на почту магазина (Reply-To), тело — текст.

const crypto = require('node:crypto');

// Заголовок в UTF-8 кусками до 39 байт: «Subject: » + слово — не длиннее 78 знаков (RFC 2047).
function encodeWords(text) {
  const words = [];
  let chunk = '';
  for (const ch of String(text)) {
    if (Buffer.byteLength(chunk + ch) > 39) { words.push(chunk); chunk = ''; }
    chunk += ch;
  }
  if (chunk || !words.length) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

// Адрес в заголовок и конверт: перевод строки или угловая скобка — попытка вставить заголовок.
function address(value) {
  const a = String(value ?? '').trim();
  if (!a || /[\r\n<>,;\s]/.test(a) || !a.includes('@')) throw new Error(`плохой адрес: «${a}»`);
  return a;
}

// transfer: '8bit' — тело как есть (файл), 'base64' — строками по 76 (SMTP без 8BITMIME).
function letterOf({ from, to, subject, body, shop, transfer = '8bit', date = new Date() }) {
  const domain = from.split('@')[1] || 'localhost';
  const replyTo = shop && shop.reply_to ? address(shop.reply_to) : null;
  const text = String(body ?? '').replace(/\r?\n/g, '\r\n');
  const encoded = transfer === 'base64'
    ? Buffer.from(text, 'utf8').toString('base64').replace(/.{76}(?=.)/g, '$&\r\n')
    : text;
  const messageId = `<${crypto.randomUUID()}@${domain}>`;
  return {
    messageId,
    text: [
      `From: ${encodeWords(shop ? shop.name : 'Магазин')} <${address(from)}>`,
      `To: <${address(to)}>`,
      ...(replyTo ? [`Reply-To: <${replyTo}>`] : []),
      `Subject: ${encodeWords(subject)}`,
      `Date: ${date.toUTCString()}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      `Content-Transfer-Encoding: ${transfer}`,
      '',
      encoded,
      '',
    ].join('\r\n'),
  };
}

module.exports = { letterOf, encodeWords, address };
