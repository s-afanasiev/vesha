// Сетевая граница чужого адреса: запрос по адресу, который пришёл извне (сайт из
// карточки, пользовательский LLM-endpoint), не должен уйти во внутреннюю сеть
// сервера. Два потребителя — LLM-шлюз и аудит сайтов, поэтому правило одно.

const dns = require('node:dns').promises;
const net = require('node:net');

function isBlockedIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

function isBlockedIp(address) {
  const value = String(address || '').toLowerCase();
  const version = net.isIP(value);
  if (version === 4) return isBlockedIpv4(value);
  if (version !== 6) return true;
  if (value.startsWith('::ffff:')) return isBlockedIpv4(value.slice(7));
  const firstGroup = Number.parseInt(value.split(':')[0], 16);
  return !Number.isFinite(firstGroup) || firstGroup < 0x2000 || firstGroup > 0x3fff;
}

class BlockedAddress extends Error {
  constructor(message) {
    super(message);
    this.code = 'blocked_address';
  }
}

// http(s), без логина в адресе, все адреса хоста — публичные. Вердикт — исключение
// с кодом: вызывающий превращает его в именованный исход шага.
async function assertPublicHost(rawUrl, { lookup = dns.lookup } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedAddress(`некорректный адрес: ${String(rawUrl).slice(0, 80)}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new BlockedAddress(`протокол ${url.protocol} не разрешён`);
  if (url.username || url.password) throw new BlockedAddress('логин и пароль в адресе не разрешены');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  let addresses;
  if (net.isIP(hostname)) {
    addresses = [{ address: hostname }];
  } else {
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch (err) {
      throw new BlockedAddress(`адрес ${hostname} не определился: ${err.code || err.message}`);
    }
  }
  if (!addresses.length || addresses.some(({ address }) => isBlockedIp(address))) {
    throw new BlockedAddress(`${hostname} указывает во внутреннюю сеть`);
  }
  return url;
}

module.exports = { isBlockedIp, assertPublicHost, BlockedAddress };
