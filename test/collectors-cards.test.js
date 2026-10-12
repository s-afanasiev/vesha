const test = require('node:test');
const assert = require('node:assert/strict');
const { Patience } = require('../server/services/collectors/patience');
const { SourceHttpError } = require('../server/services/collectors/http');
const { assertPublicHost, isBlockedIp } = require('../server/services/collectors/netGuard');
const { parseInitialState, placesOf, cardOf } = require('../server/services/collectors/twogis');
const { NeedCatalog } = require('../server/services/radar/needCatalog');
const { parseBatch, batchesOf, systemPrompt } = require('../server/services/radar/reviewMarking');
const { siteSignals } = require('../server/services/automation-leads/siteSignals');

function fakeTime() {
  const t = { now: 1000, waits: [] };
  t.clock = () => t.now;
  t.wait = async (ms) => { t.waits.push(ms); t.now += ms; };
  return t;
}

test('patience keeps the gap between calls and stops the resource after 403 until it cools down', async () => {
  const t = fakeTime();
  let calls = 0;
  const target = {
    methods: ['get'],
    get: async (n) => {
      calls += 1;
      t.now += 100;
      if (n === 'bad') throw new SourceHttpError('http_403', 'Источник ответил 403', 403);
      return n;
    },
  };
  const source = new Patience(target, { gapMs: 1600, cooldownMs: 60000, clock: t.clock, wait: t.wait });
  assert.equal(await source.get('a'), 'a');
  assert.equal(await source.get('b'), 'b');
  assert.deepEqual(t.waits, [1600]);
  await assert.rejects(source.get('bad'), (err) => err.code === 'refused' && err.status === 403);
  await assert.rejects(source.get('c'), /остываем/);
  assert.equal(calls, 3);
  assert.equal(source.status().refused.status, 403);
  t.now += 60000;
  assert.equal(await source.get('d'), 'd');
  assert.equal(source.status().refused, null);
});

test('net guard lets only public http(s) addresses through', async () => {
  const lookup = async (host) => (host === 'shop.example' ? [{ address: '93.184.216.34' }] : [{ address: '127.0.0.1' }]);
  assert.equal((await assertPublicHost('https://shop.example/', { lookup })).hostname, 'shop.example');
  await assert.rejects(assertPublicHost('http://localhost/', { lookup }), /внутреннюю сеть/);
  await assert.rejects(assertPublicHost('http://192.168.1.10/', { lookup }), /внутреннюю сеть/);
  await assert.rejects(assertPublicHost('ftp://shop.example/', { lookup }), /протокол/);
  await assert.rejects(assertPublicHost('https://user:pw@shop.example/', { lookup }), /логин/);
  assert.equal(isBlockedIp('10.0.0.1'), true);
  assert.equal(isBlockedIp('8.8.8.8'), false);
});

test('2gis pages are parsed in the adapter into normalized places and cards', () => {
  const state = {
    data: {
      entity: {
        profile: {
          '701': {
            data: {
              name: 'Метизы у дома',
              address_name: 'ул. Ленина, 1',
              rubrics: [{ name: 'Крепёж' }],
              contact_groups: [{ contacts: [{ type: 'phone', text: '+7 000' }, { type: 'website', url: 'metiz.example' }, { type: 'telegram', value: '@metiz' }] }],
              attribute_groups: [{ attributes: [{ name: 'Актуальность данных не подтверждена' }] }],
              schedule: { Mon: {} },
              org: { branch_count: 2 },
              reviews: { general_rating: 4.6, general_review_count: 31 },
            },
          },
        },
      },
    },
  };
  const json = JSON.stringify(state).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const html = `<script>var initialState = JSON.parse('${json}');</script>`;
  const parsed = parseInitialState(html);
  assert.deepEqual(placesOf(parsed), [{ branch_id: '701', name: 'Метизы у дома', address: 'ул. Ленина, 1', rubrics: ['Крепёж'] }]);
  const card = cardOf('701', parsed.data.entity.profile['701'].data);
  assert.deepEqual(
    [card.phones, card.websites, card.messengers, card.unconfirmed, card.schedule, card.branches, card.rating],
    [['+7 000'], ['metiz.example'], ['@metiz'], true, true, 2, 4.6],
  );
  assert.equal(parseInitialState('<html>без состояния</html>'), null);
});

test('review marking keeps verified quotes and rejects with a reason, never silently', () => {
  const catalog = new NeedCatalog({ pack: 'hardware' });
  const reviews = [
    { review_id: '1', rating: 1, text: 'Сказали, что есть, приехал — нет нужных прокладок.' },
    { review_id: '2', rating: 5, text: 'Всё отлично.' },
  ];
  const answer = JSON.stringify({
    reviews: [
      { id: '1', author: 'client', signals: [
        { need: 'offer.stock', polarity: 'missing', service: 'plumbing', quote: 'нет нужных прокладок' },
        { need: 'made.up', polarity: 'missing', quote: '…' },
        { need: 'price.level', polarity: 'maybe', quote: '…' },
      ] },
      { id: '99', author: 'client', signals: [] },
    ],
  });
  const parsed = parseBatch('```json\n' + answer + '\n```', reviews, catalog);
  assert.deepEqual(parsed.rejected, ['код вне справочника', 'полярность', 'чужой id']);
  assert.deepEqual(parsed.missing, ['2']);
  assert.equal(parsed.results[0].signals[0].quoteVerified, true);
  assert.equal(parsed.results[0].signals[0].service, 'plumbing');
  assert.deepEqual(batchesOf(reviews).map((b) => [b.group, b.reviews.length]), [['negative', 1], ['positive', 1]]);
  assert.match(systemPrompt(catalog), /Потребности ниши:\n- niche\.by_piece/);
  assert.doesNotMatch(systemPrompt(new NeedCatalog()), /Потребности ниши/);
});

test('site signals see catalog, prices, order and engine without running JS', () => {
  const html = '<link href="/bitrix/x.css"><a>Каталог</a><span class="price">1 200 ₽</span><button>В корзину</button><a href="https://wa.me/7">wa</a>';
  const s = siteSignals(html);
  assert.deepEqual([s.catalog, s.prices, s.cart, s.messengers, s.platform], [true, true, true, true, '1С-Битрикс']);
  assert.deepEqual([siteSignals('<p>Мы работаем</p>').prices, siteSignals('<p>Мы работаем</p>').platform], [false, null]);
});
