// Признаки главной страницы сайта места — что видно без JS: каталог, цены, заказ,
// чат, мессенджеры, наличие, движок. Чистая функция над HTML (П15); перенесена из
// опытного аудита 11.10.2026 (niche-audit.mjs). Только текст страницы, без LLM.

function siteSignals(html) {
  const raw = String(html || '').slice(0, 1_500_000);
  // Текст без скриптов и тегов: цена и «₽» на Битриксе часто стоят в разных тегах.
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ');
  const has = (re) => re.test(raw) || re.test(text);
  const priceMarkup = /itemprop=["']price["']|class=["'][^"']*\bprice\b|data-price/i.test(raw);
  return {
    cart: has(/в корзину|корзин[аеуы]|оформить заказ|add-to-cart|basket|\/cart/i),
    catalog: has(/каталог/i),
    prices: priceMarkup || (text.match(/\d[\d\s ]{0,8}(?:[.,]\d{1,2})?\s?(?:₽|руб\.?|р\.)/gi) || []).length >= 3,
    leadForm: has(/обратный звонок|заказать звонок|оставить заявку|отправить заявку|получить консультацию/i),
    chat: has(/jivosite|jivo\.ru|code\.jivo|b24-widget|bitrix24\.ru\/b\d|envybox|carrotquest|talk-me|livetex|callbackhunter|marquiz|streamwood/i),
    messengers: has(/wa\.me|api\.whatsapp|whatsapp\.com\/send|t\.me\/|viber:\/\//i),
    stock: has(/в наличии|нет в наличии|под заказ/i),
    platform:
      (has(/tilda\.ws|tildacdn/i) && 'Tilda') ||
      (has(/\/bitrix\/|bx-core|BX\.setJSList/i) && '1С-Битрикс') ||
      (has(/wp-content|wp-includes/i) && 'WordPress') ||
      (has(/insales/i) && 'InSales') ||
      (has(/nethouse/i) && 'Nethouse') ||
      (has(/ukit|umi\.ru|umi-cms/i) && 'uKit/UMI') ||
      (has(/wix\.com|wixstatic/i) && 'Wix') ||
      null,
    bytes: raw.length,
  };
}

module.exports = { siteSignals };
