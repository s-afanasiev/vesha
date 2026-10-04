# Радар болей — план исполнения 1.1: движок парсинга карт (headless-браузеры)

Исполнение пункта 1.1 [глобального плана](pain-radar-global.md): сравнение Puppeteer/Playwright и конкурентов по пяти осям (скорость, удобство, анти-обнаружение, поддержка, конкуренты) и выбор движка. Данные собраны **04.10.2026** — версии, активности репозиториев и звёзды на эту дату. Развилка «HTTP-endpoint'ы или браузер» здесь не решается — она за разведкой источника (1.2, Б11 разбора); движок выбирается **для браузерного пути**, и он нужен в любом случае: разведка рубрик (1.2) — это клики по живой странице, не запросы.

Куда ложится выбор: движок прячется внутри адаптера источника (контракт `ReviewsSource`, Б2 разбора) — каркас сборщиков про браузер не знает ([collectors-architecture.md](../collectors-architecture.md), греп-правило); троттлинг, таймауты страницы и «источник сломался» — у каркаса, поля реестра ресурсов (`throttle_ms`, `page_timeout_ms`, `min_interval_sec`) уже для этого описаны.

## Развилка, к которой привязан выбор

Ни у Яндекса, ни у 2ГИС официального API отзывов нет. Два пути до отзывов:

1. **Разбор внутренних JSON-endpoint'ов веб-версии** — дёшево, но: селективные антибот-проверки без отпечатка браузера; TLS-отпечаток `node-fetch`/`https` легко отличим от браузерного (JA3/JA4) — если источник включит такую проверку, чистый HTTP-путь уязвим целиком, а браузерный — нет (это самостоятельный аргумент за браузер, его разведка Б11 проверит по факту);
2. **Headless-браузер** — дороже по памяти и запуску, но отпечаток настоящий и он же нужен для разведки селекторов и ИИ-агента над браузером (1.2).

Выбор движка не предрешает развилку: даже при HTTP-пути браузер остаётся инструментом разведки и запасным двигателем (фаза 6 архитектуры).

## Кандидаты и активность (04.10.2026)

| Инструмент | Что это | Звёзды | Последний релиз / пуш | Язык |
|---|---|---|---|---|
| [Playwright](https://github.com/microsoft/playwright) | фреймворк автоматизации, Chromium/Firefox/WebKit | ~97 000 | v1.63.0 (04.09.2026), пуш daily | TypeScript (Node) |
| [Puppeteer](https://github.com/puppeteer/puppeteer) | API над Chromium (и Firefox) | ~95 600 | v25.12.0 (23.09.2026, npm), пуш daily | TypeScript (Node) |
| [patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) | патченный недетектируемый форк Playwright, drop-in | ~4 800 | v1.63.0 (08.09.2026, npm) — **синхронизирован с Playwright 1.63.0** | TypeScript (Node) + [patchright-nodejs](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright-nodejs) |
| [camoufox](https://github.com/daijro/camoufox) | антидетект-браузер, форк Firefox | ~12 300 | v156.0.1-beta.34 (03.10.2026) | Python; JS-порт [apify/camoufox-js](https://github.com/apify/camoufox-js) (~270 звёзд, пуш 02.10.2026) — вторичный слой |
| [puppeteer-extra](https://github.com/berstend/puppeteer-extra) (+ plugin-stealth) | плагины над Puppeteer | ~7 400 | **пуш 18.07.2024 — заброшен > 2 лет** | JavaScript |
| [rebrowser-patches](https://github.com/rebrowser/rebrowser-patches) | патчи Runtime.enable для Puppeteer/Playwright | ~1 400 | **пуш 09.05.2025 — заброшен ~1.5 года** | — |
| [nodriver](https://github.com/ultrafunkamsterdam/nodriver) | CDP-минимализм, преемник undetected-chromedriver | ~4 800 | **пуш 13.05.2026 — пауза ~5 мес** | Python |
| [Selenium](https://github.com/SeleniumHQ/selenium) | WebDriver-экосистема | ~34 500 | активен | Java (+байндинги) |
| puppeteer-real-browser (npm) | обёртка Puppeteer + rebrowser-patches + ghost-cursor | — | v1.4.4 (03.09.2025, npm) | JavaScript |

Управляемые браузерные сервисы (Browserless, ZenRows, Bright Data, Scrapfly) — не репозитории, а облачная подписка; см. ось 5.

## Ось 1 — Скорость

- Playwright и Puppeteer для Chromium гоняют **один и тот же протокол CDP**; разница в собственных накладных расходах драйвера. По свежим сравнениям ([Bright Data](https://brightdata.com), [ScraperAPI 2026](https://www.scraperapi.com), [Scrapfly](https://scrapfly.io/blog/posts/puppeteer-vs-playwright)) Playwright чуть выигрывает в E2E-сценариях за счёт auto-waiting и дешёвых контекстов; на одиночных страницах разница в процентах, не в разах.
- Для нашей задачи скорость движка — не узкое место: сбор идёт с троттлингом секундами (`throttle_ms` каркаса), десятки страниц за джобу. Что реально важно для Linux VDS — память: браузер ~250–400 МБ на инстанс; наша схема — один браузер, один контекст, последовательный обход, без пула (пул — условие выноса каркаса в сервис, условие 2 [collectors-architecture.md](../collectors-architecture.md), не сейчас).
- nodriver позиционируется «blazing fast» (прямой CDP без слоя WebDriver), но это Python и не наш стек.
- Вывод: **ось скорости не различает основных кандидатов** — решение принимается по осям 2–3.

## Ось 2 — Удобство и поддерживаемость

| | Playwright | Puppeteer | Selenium |
|---|---|---|---|
| Локаторы и ожидания | locators с auto-wait, `expect`-условия; страница ждёт сама | `waitForSelector`/`waitForXPath`, остальное руками | explicit waits вручную, самый многословный API |
| Отладка | **trace viewer** (запись шагов+скриншотов+сети), codegen-инспектор, `page.pause` | инспектор DevTools-протокола, скриншоты; trace нет | driver-логи, скриншоты |
| Контексты | browser contexts — дешёвые изолированные сессии (куки, гео) | incognito-контексты, тяжелее | отдельные сессии драйвера |
| Стабильность контракта | миноры без ломающих изменений, breaking — с миграционками | аналогично | W3C-стандарт, консервативен |
| Сеть | перехват запросов/ответов из коробки (`page.on('response')`) — **внутренние JSON-endpoint'ы карт снимаются этим напрямую** | то же, чуть более многословно | через DevTools-байндинги — костыль |

Patchright — drop-in замена `playwright` → `patchright`: весь код адаптера идентичен, удобство наследуется. Цена: Console API в браузере отключён (часть патча), init-скрипты идут через роуты, не все тесты Playwright проходят — для нашего сбора влияние маловероятно. JS-порт camoufox — второй слой над Python-проектом: удобство хуже, две зависимости вместо одной.

Вывод: **Playwright впереди** за счёт trace viewer (ремонт плывущих селекторов — прямой сценарий 1.2) и перехвата сети; Puppeteer — близкий второй; Selenium — догоняющий по всем строкам.

## Ось 3 — Анти-обнаружение (решающая ось)

Как антиботы отличают автоматизацию: CDP-утечка `Runtime.enable` (главная — её видно изнутри страницы), включённый Console API, флаги запуска (`--enable-automation`, `navigator.webdriver`), `HeadlessChrome` в UA, TLS/JA3-JA4 отпечаток, поведенческие и IP-факторы.

| Кандидат | Подход | Против современных антиботов |
|---|---|---|
| Puppeteer + plugin-stealth | JS-инъекции поверх браузера | `Runtime.enable` не патчит; проект заброшен с 07.2024 — против актуальных проверок ([IPASIS](https://ipasis.com)) проигрывает |
| **patchright** | патчи в самом драйвере: изоляция ExecutionContext вместо `Runtime.enable`, Console API выключен, чистые флаги запуска, закрытые shadow roots | заявленный проход [Brotector, Cloudflare, Kasada, Akamai, DataDome, Fingerprint.com, CreepJS](https://raw.githubusercontent.com/Kaliiiiiiiiii-Vinyzu/patchright/main/README.md); активная разработка |
| camoufox | сам браузер — антидетект-форк Firefox: подмена отпечатка на уровне ядра, humanize, GeoIP | сильнейший класс защиты (другой семейство отпечатка), но Python-first |
| rebrowser-patches | та же идея, что patchright (Runtime.enable) | заброшен 05.2025, перекрыт patchright |
| nodriver | CDP-минимализм без артефактов | приличный, но Python + пауза разработки с 05.2026 |
| Selenium | протокол WebDriver сам по себе заметен | худший в таблице |
| Playwright/Puppeteer «как есть» | настоящие флаги автоматизации | проходят только мягкую защиту — достаточно ли для 2ГИС, покажет разведка Б11 |

**SmartCaptcha и политика проекта.** Архитектура фиксирует: «низкая частота, кэш, без обхода капчи, без распределённого сбора». Цель стелса здесь — **вежливый сбор, который не триггерит капчу**, а не обход уже показанной. Если SmartCaptcha показалась — джоба по правилу «источник сломался» (Б5) встаёт на паузу с причиной; сервисы-солверы (2captcha, CapMonster…) не используем: ToS источника, стоимость и наша позиция исследователя. На Яндекс-фазе это означает: stealth-надстройка обязательна, а терпение источника проверяется живой разведкой (открытый вопрос 2 глобального плана).

**2ГИС** исторически мягче Яндекса: вероятно, хватит и чистого Playwright. Решение по факту разведки Б11, надстройка включается при первых тревогах — смена импорта в адаптере, контракт не меняется.

## Ось 4 — Поддержка и экосистема

- **Playwright** — Microsoft: ежедневные пуши, квартальный ритм релизов (v1.63.0 — 09.2026), образцовая документация, крупные сообщество и база рецептов; готовый [Playwright MCP](https://github.com/microsoft/playwright-mcp) — прямая стыковка для ИИ-агента из пункта 1.2.
- **Puppeteer** — Google: та же интенсивность разработки (v25.12.0 — 09.2026), документация хорошая. Минус экосистемы: стелс-слой (puppeteer-extra-stealth) заброшен.
- **patchright** — маленькая команда, но драйвер синхронизируется с релизами Playwright (1.63.0 ↔ 1.63.0), пуш свежий; риск нишевого форка компенсируется drop-in-моделью: если форк остановится, возвращаемся на чистый Playwright без переписывания.
- **camoufox** — активен (beta-релизы браузера еженедельно), основной API Python; JS-порт Apify жив, но вторичен.
- **nodriver** —singleton-проект одного автора, пауза ~5 месяцев; **rebrowser-patches** — заброшен; **puppeteer-extra** — заброшен.

## Ось 5 — Конкуренты и управляемые сервисы

- **Selenium/WebDriver**: единственный плюс — языки и браузеры; для Node-проекта Vesha он длиннее и заметнее двух остальных. Отпадает.
- **nodriver**: Python + пауза разработки. Отпадает как основной, не наш стек.
- **camoufox**: не движок-конкурент, а другая точка защиты (Firefox-отпечаток). Резервный путь, если разведка покажет блокировку по отпечатку Chromium — но тогда это Python-сервис рядом с Node-деплоем; включать только по факту.
- **puppeteer-real-browser**: сборная солянка на заброшенных патчах — не выбираем.
- **Управляемые сервисы** (Browserless, ZenRows, Bright Data, Scrapfly): готовые антибот-облака, но чужая инфраструктура между нами и источником, подписка и передать им наш сценарий сбора — вне ориентира **self-hosted**, зафиксированного для локального проекта. Помнить как аварийный запасной путь, если свой сбор станет невозможен.

## Вердикт: выбор движка

| Ось | Победитель |
|---|---|
| Скорость | ничья (не решает) |
| Удобство и отладка | **Playwright** |
| Анти-обнаружение | **patchright** (drop-in над Playwright); camoufox — резерв другого класса |
| Поддержка и экосистема | **Playwright** (Microsoft); стелс-экосистема Puppeteer заброшена |
| Конкуренты | не превзошли пару Playwright + patchright |

**Выбор: Playwright как базовый движок браузерного пути, patchright — антидетект-надстройка того же API.** Почему не Puppeteer при равных скорости и активности: у него нет живой стелс-надстройки (stealth-плагин заброшен против заброшенного же rebrowser — у Playwright есть действующий drop-in форк), нет trace viewer для ремонта плывущих селекторов (прямой сценарий 1.2), и архитектура уже смотрела в эту сторону (фаза 6: «headless при необходимости (Playwright)»). Firefox/WebKit у Playwright в плюс не идут (patchright — только Chromium), но и не требуются.

## Предложения (статус: предложено 04.10.2026; метки Д1–Д4)

| # | Предложение | Суть | Куда |
|---|---|---|---|
| Д1 | Базовый движок — Playwright (Node) | Единый API-слой всего браузерного пути: разведка рубрик (1.2), парсинг 2ГИС/Яндекс, перехват JSON-endpoint'ов (`page.on('response')`). Движок живёт в адаптере источника (Б2); каркас сборщиков про браузер не знает — таймауты и троттлинг приходят настройками ресурса | архитектура (фазы 2 и 6), `sources/*.js` |
| Д2 | Стелс-надстройка — patchright | Drop-in замена `playwright` → `patchright` (включая `patchright-core` + системный Chromium): обязательна на Яндекс-фазе, для 2ГИС — при первых признаках проверки. Включается импортом внутри адаптера, контракт `ReviewsSource` не меняется; если форк отстанет — возврат на чистый Playwright той же версией API | `sources/yandex.js` (фаза 6), разведка Б11 |
| Д3 | Браузер и ресурсный режим | Chromium, headless; один последовательный браузер-воркер без пула на старте; город/регион — параметр запроса (открытый вопрос 1.2). Пул браузеров с арендой и здоровьем — не строить: это условие выноса каркаса в отдельный сервис | `collector_resources` (настройки), колектор |
| Д4 | Капча: политика без обхода | Подтверждаем правило архитектуры: цель стелса — не триггерить SmartCaptcha вежливым сбором; при показанной капче джоба встаёт на паузу с причиной (Б5, «источник сломался»), солверы не используем. Частоту блокировок мерит разведка 1.2 — она же отвечает на открытый вопрос «граница терпения источников» | архитектура (раздел сбора), колектор |

## Чего это исследование не проверяет (передать 1.2)

1. **Реальную детекцию нашими источниками**: проходят ли 2ГИС и Яндекс чистый Playwright / patchright в нашем режиме частоты — только живая разведка селекторов.
2. **TLS/JA3**: при браузерном пути отпечаток настоящий, но если разведка выберет HTTP-путь — провернуть, как источники относятся к небраузерному TLS-отпечатку Node.
3. **Ресурсы на VDS**: память и старт браузера на нашем железе, рендер тяжёлых страниц карт в headless — замерить на прототипе «сферы → рубрики».
4. **Playwright MCP vs собственный API над движком** для агента 1.2 — отдельная проработка этого пункта.

## Источники

- Репозитории и релизы (GitHub API, 04.10.2026): [microsoft/playwright](https://github.com/microsoft/playwright), [puppeteer/puppeteer](https://github.com/puppeteer/puppeteer), [Kaliiiiiiiiii-Vinyzu/patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright), [daijro/camoufox](https://github.com/daijro/camoufox), [apify/camoufox-js](https://github.com/apify/camoufox-js), [ultrafunkamsterdam/nodriver](https://github.com/ultrafunkamsterdam/nodriver), [berstend/puppeteer-extra](https://github.com/berstend/puppeteer-extra), [rebrowser/rebrowser-patches](https://github.com/rebrowser/rebrowser-patches), [SeleniumHQ/selenium](https://github.com/SeleniumHQ/selenium)
- npm (04.10.2026): [patchright](https://www.npmjs.com/package/patchright) (1.63.0), [puppeteer](https://www.npmjs.com/package/puppeteer) (25.12.0), [camoufox](https://www.npmjs.com/package/camoufox) (JS-порт, 0.1.19), [puppeteer-real-browser](https://www.npmjs.com/package/puppeteer-real-browser) (1.4.4)
- [README patchright](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright) — состав патчей (Runtime.enable, Console API, флаги, закрытые shadow roots), заявленные антиботы, ограничения, patchright-nodejs
- Сравнения движков: [Scrapfly — Puppeteer vs Playwright](https://scrapfly.io/blog/posts/puppeteer-vs-playwright), [Bright Data — Puppeteer vs Playwright](https://brightdata.com), [ScraperAPI 2026](https://www.scraperapi.com), [BrowserCat](https://www.browsercat.com/post/playwright-vs-puppeteer-web-scraping-comparison)
- Практика антибота и капч: [IPASIS — детект headless](https://ipasis.com) (слабость JS-инъекций stealth-плагинов), [Bright Data — Puppeteer Real Browser](https://brightdata.com/blog/web-data/puppeteer-real-browser), [Browserless — captcha solving](https://www.browserless.io/blog/captcha-solving), [обзор инструментов парсинга Яндекс Карт](https://resize-web.ru), [рецепт A-Parser по 2GIS](https://a-parser.com)
- Stealth-ландшафт 2026: [ProxyCove — браузеры для агентов](https://proxycove.com) (Camoufox, nodriver, patchright как stealth-сборки)

## Статус

- Сравнение и выбор — **сделаны 04.10.2026**: Playwright (+ patchright как надстройка), предложения Д1–Д4.
- Д1–Д4 ждут решения по обычному правилу разбора; после принятия — пункт 1.1 глобального плана закрывается, выбор переносится в [pain-radar-architecture.md](pain-radar-architecture.md) (фазы 2 и 6) и настройки ресурса каркаса сборщиков.
