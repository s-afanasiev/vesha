// Квитанции настоящим письмом (§10, шаг 6): тот же контракт send({ to, subject,
// body, shop, replyTo }), что у FileMailbox, — точка сборки берёт его, когда в .env задан
// BACKBONE_SMTP_HOST. SMTP без библиотек — столько, сколько нужно одному письму
// (как zip у xlsx): EHLO, STARTTLS (587) или TLS сразу (465), AUTH PLAIN / LOGIN,
// MAIL FROM, RCPT TO, DATA. Тело — base64: ни 8BITMIME, ни длинные строки не нужны.
// Пароль без TLS уходит только на localhost (проверочный ящик на своей машине).
//
// Сбой — исключение: Receipts помечает квитанцию failed и повторяет до maxAttempts.

const net = require('node:net');
const tls = require('node:tls');
const os = require('node:os');
const { letterOf, address } = require('./letter');

const LOCAL = new Set(['localhost', '127.0.0.1', '::1']);

// Диалог с сервером: строго «команда → ответ», ответ — строки «250-…» до «250 …».
class Session {
  constructor(socket, timeoutMs) {
    this.timeoutMs = timeoutMs;
    this.buffer = '';
    this.waiting = null;
    this.failure = null;
    this.attach(socket);
  }

  attach(socket) {
    this.socket = socket;
    this.onData = (chunk) => { this.buffer += chunk.toString('utf8'); this.drain(); };
    socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error(`SMTP: нет ответа ${this.timeoutMs / 1000} с`)));
    socket.on('data', this.onData);
    socket.on('error', (err) => this.fail(err));
    socket.on('close', () => this.fail(new Error('SMTP: сервер закрыл соединение')));
  }

  // Перед STARTTLS: сырой сокет отдаётся TLS целиком — без чтения и без таймера.
  detach() {
    this.socket.removeListener('data', this.onData);
    this.socket.setTimeout(0);
    return this.socket;
  }

  fail(err) {
    this.failure ??= err;
    if (this.waiting) { const { reject } = this.waiting; this.waiting = null; reject(this.failure); }
  }

  drain() {
    if (!this.waiting) return;
    const lines = this.buffer.split('\r\n');
    let end = -1;
    for (let i = 0; i < lines.length - 1; i++) if (/^\d{3}(?: |$)/.test(lines[i])) { end = i; break; }
    if (end < 0) return;
    const reply = lines.slice(0, end + 1);
    this.buffer = lines.slice(end + 1).join('\r\n');
    const { resolve } = this.waiting;
    this.waiting = null;
    resolve({ code: Number(reply[end].slice(0, 3)), lines: reply.map((l) => l.slice(4)) });
  }

  reply() {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => { this.waiting = { resolve, reject }; this.drain(); });
  }

  async expect(codes, what) {
    const r = await this.reply();
    if (!codes.includes(r.code)) throw new Error(`SMTP ${what}: ${r.code} ${r.lines.join(' ')}`.trim());
    return r;
  }

  async command(line, codes, what = line.split(' ')[0]) {
    this.socket.write(`${line}\r\n`);
    return this.expect(codes, what);
  }
}

class SmtpMailbox {
  constructor({ host, port = 587, secure = port === 465, user = '', pass = '', from, name = os.hostname(), timeoutMs = 20_000, tlsOptions = {} }) {
    this.host = host;
    this.port = port;
    this.secure = secure;     // true — TLS с первого байта (465), false — STARTTLS, если сервер умеет
    this.user = user;
    this.pass = pass;
    this.from = from;         // адрес конверта и From — ящик, от имени которого разрешено слать
    this.name = name;         // имя для EHLO
    this.timeoutMs = timeoutMs;
    this.tlsOptions = tlsOptions;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = this.secure
        ? tls.connect({ host: this.host, port: this.port, servername: this.host, ...this.tlsOptions }, () => resolve(socket))
        : net.connect({ host: this.host, port: this.port }, () => resolve(socket));
      socket.once('error', reject);
      socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error(`SMTP: ${this.host}:${this.port} не отвечает`)));
    });
  }

  startTls(session) {
    return new Promise((resolve, reject) => {
      const secure = tls.connect({ socket: session.detach(), servername: this.host, ...this.tlsOptions }, () => resolve(secure));
      secure.once('error', reject);
    });
  }

  async send({ to, subject, body, shop, replyTo = null }) {
    if (!to) throw new Error('нет адреса');
    const rcpt = address(to);
    const letter = letterOf({ from: this.from, to: rcpt, subject, body, shop, replyTo, transfer: 'base64' });
    const socket = await this.connect();
    const session = new Session(socket, this.timeoutMs);
    try {
      await session.expect([220], 'приветствие');
      let ehlo = await session.command(`EHLO ${this.name}`, [250]);
      let encrypted = this.secure;
      if (!encrypted && ehlo.lines.some((l) => /^STARTTLS\b/i.test(l))) {
        await session.command('STARTTLS', [220]);
        session.attach(await this.startTls(session));
        encrypted = true;
        ehlo = await session.command(`EHLO ${this.name}`, [250]);
      }
      if (this.user) {
        if (!encrypted && !LOCAL.has(this.host)) throw new Error(`SMTP: ${this.host} не предлагает TLS — пароль открытым текстом не отправляем`);
        const auth = ehlo.lines.find((l) => /^AUTH\b/i.test(l)) || '';
        const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
        if (/\bLOGIN\b/i.test(auth) && !/\bPLAIN\b/i.test(auth)) {
          await session.command('AUTH LOGIN', [334]);
          await session.command(b64(this.user), [334], 'AUTH LOGIN (логин)');
          await session.command(b64(this.pass), [235], 'AUTH LOGIN (пароль)');
        } else {
          await session.command(`AUTH PLAIN ${b64(`\0${this.user}\0${this.pass}`)}`, [235], 'AUTH PLAIN');
        }
      }
      await session.command(`MAIL FROM:<${address(this.from)}>`, [250]);
      await session.command(`RCPT TO:<${rcpt}>`, [250, 251]);
      await session.command('DATA', [354]);
      // точка в начале строки — конец письма; у base64-тела её нет, но заголовок мог бы
      const data = letter.text.replace(/(^|\r\n)\./g, '$1..');
      const accepted = await session.command(`${data}\r\n.`, [250], 'письмо');
      await session.command('QUIT', [221]).catch(() => {});
      return { messageId: letter.messageId, reply: accepted.lines.join(' ') };
    } finally {
      session.socket.destroy();
    }
  }
}

module.exports = { SmtpMailbox };
