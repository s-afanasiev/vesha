// Почта магазинов (решение пользователя 20.10.2026; docs/backbone-handover.md §4.9) — тот же
// контракт send({ to, subject, body, shop, replyTo }) и forget(), что у SmtpMailbox и
// FileMailbox (П8, П19): квитанции и письмо менеджеру не знают, чей ящик. Ящик — по магазину:
//   свой ящик магазина (вариант А) — админ сохранил настройки, пароль расшифрован ключом
//     сервера, и с этими настройками ушло тестовое письмо («Проверить отправку»);
//   иначе — общий ящик сервера (вариант Б, по умолчанию): наш домен для рассылки из .env,
//     From — «Магазин X» <noreply@…>, Reply-To — почта магазина.
// Сохранённые, но не проверенные настройки письма не ломают: до проверки — общий ящик.
// Свой ящик недоступен на сервере (нет ключа, ключ сменился) — тоже общий, с записью в лог.
// А свой ящик, который отказал при отправке, — сбой с повтором (Receipts), не тихий уход на
// общий: адрес отправителя покупателю не меняется за спиной у админа.
// След отправки: send отвечает, с какого адреса ушло письмо (from) — Receipts хранит его.

class ShopMailboxes {
  constructor({ shared, settingsOf, secret = null, open, log = console }) {
    this.shared = shared;         // общий ящик сервера: SMTP из .env или файлы .eml
    this.settingsOf = settingsOf; // id магазина → строка backbone_shop_mail | null
    this.secret = secret;         // MailSecret | null — без ключа свой ящик магазина выключен
    this.open = open;             // { host, port, user, pass, from } → почтальон (SmtpMailbox)
    this.log = log;
  }

  // Свой ящик магазина на этом сервере возможен: задан ключ шифра паролей.
  get ownAllowed() {
    return Boolean(this.secret);
  }

  // Пароль — в базу только шифром, привязанным к магазину.
  seal(password, shopId) {
    if (!this.secret) throw new Error('свой ящик магазина выключен: на сервере не задан BACKBONE_MAIL_KEY');
    return this.secret.seal(password, shopId);
  }

  // Почтальон по сохранённым настройкам — для проверки и для писем; пароль не расшифровался — отказ.
  mailboxOf(shop, row) {
    if (!this.secret) throw new Error('свой ящик магазина выключен: на сервере не задан BACKBONE_MAIL_KEY');
    return this.open({ host: row.host, port: row.port, user: row.username, pass: this.secret.open(row.secret, shop.id), from: row.sender });
  }

  // Чем пойдут письма магазина по его строке настроек — без отправки: { own, from, reason }.
  routeOf(shop, row) {
    const shared = (reason) => ({ own: false, from: this.shared.from, reason });
    if (!row) return shared(null);
    if (!this.secret) return shared('на сервере не задан BACKBONE_MAIL_KEY — свой ящик выключен');
    if (!row.checked_at) return shared(row.check_error ? `проверка не прошла: ${row.check_error}` : 'ящик не проверен — «Проверить отправку»');
    try {
      this.secret.open(row.secret, shop.id);
    } catch (err) {
      return shared(err.message);
    }
    return { own: true, from: row.sender, reason: null };
  }

  // С какого адреса уходят письма магазина — для политики ПДн и кабинета.
  async senderOf(shop) {
    return this.routeOf(shop, await this.settingsOf(shop.id));
  }

  // Почтальон письма: свой проверенный ящик магазина — или общий.
  async mailboxFor(shop) {
    const row = shop ? await this.settingsOf(shop.id) : null;
    const route = row ? this.routeOf(shop, row) : { own: false };
    if (route.own) return this.mailboxOf(shop, row);
    if (row && row.checked_at) this.log.error(`backbone: ящик магазина ${shop.slug} — ${route.reason}; письма — с общего ящика`);
    return this.shared;
  }

  async send(letter) {
    const via = await this.mailboxFor(letter.shop);
    const sent = await via.send(letter);
    return { ...(sent || {}), from: via.from };
  }

  // «Проверить отправку»: тестовое письмо на почту магазина тем ящиком, что сохранил админ.
  async check(shop, row, to) {
    return this.mailboxOf(shop, row).send({
      to,
      shop,
      subject: `Проверка почты магазина — ${shop.name}`,
      body: [
        `Это проверочное письмо сайта магазина «${shop.name}»: оно ушло с ящика ${row.sender} через ${row.host}:${row.port}.`,
        'Дошло — значит, квитанции покупателям и письма о новых заявках пойдут с этого ящика. Отвечать на него не нужно.',
      ].join('\n\n'),
    });
  }

  // Удаление данных покупателя: копии писем у сайта хранит только общий ящик без SMTP (файлы .eml).
  async forget(args) {
    return this.shared.forget ? this.shared.forget(args) : 0;
  }
}

module.exports = { ShopMailboxes };
