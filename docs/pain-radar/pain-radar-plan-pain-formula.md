# Радар болей — план исполнения 1.4: формула боли

Исполнение пункта 1.4 [глобального плана](pain-radar-global.md): расследование «выжимали ли кто-то смысл из отзывов людей» и что это говорит о нашей формуле боли. Шаги 1–2 сделаны 04.10.2026 (формулировка запроса, поиск и реферат — ниже); шаг 3 (синтез) даёт вердикт «формула подтверждается» и четыре предложения Ф1–Ф4 на принятие. Канва текущей формулы: вес сигнала $W = \sum \text{Score}_i \cdot e^{-\lambda \Delta t_i}$ в [pain-radar-architecture.md](pain-radar-architecture.md), знаменатель А1 и `RankPains` Б7 в [pain-radar-review.md](pain-radar-review.md).

## Шаг 1 — выбор формулировки

| № | Формулировка | Какая литература отвечает | Роль в поиске |
|---|---|---|---|
| 1 | «Насколько отзывы отражают реальную ситуацию в сервисе» | валидность eWOM: корреляции рейтингов с объективными мерами, фейки, смещения | дополнительная линза: можно ли верить сигналу |
| 2 | «Извлечение потребностей и спроса из негативных отзывов» | review mining, voice of customer, ABSA, ODI, майнинг отзывов приложений | **основная**: повторяет наш пайплайн «жалоба → боль → спрос» |
| 3 | «Как определить востребованные услуги региона по отзывам» | практика gap-анализа; академического слоя почти нет | дополнительная линза: от болей к нишам |

Выбор: основная — №2, поиск исполнялся по всем трём углам (запросы: mining online reviews unmet needs · ABSA complaints · app review mining classification · reviews vs objective quality · unhappy customers complain · Kano must-be · market gaps from reviews · анализ жалоб рус.). Поисковые формулировки уточнялись на ходу — как и предполагал пункт 1.4, точная фраза родилась только после первой волны результатов.

## Шаг 2 — реферат находок

### Блок 1. «Жалобы → потребности» — зрелое направление, а не наша выдумка

Самая близкая к радару работа: **Joung et al., «Customer Complaints Analysis Using Text Mining and Outcome-Driven Innovation Method for Market-Oriented Product Development»** (Sustainability, 2019; [MDPI](https://www.mdpi.com/2071-1050/11/1/40), прочитан полный текст):

- 2362 жалобы клиентов южнокорейского сервиса → text mining (извлечение фич) → отбор фич по «job map» ODI (8 универсальных шагов любой работы: define, locate, prepare, confirm, execute, monitor, modify, conclude) → кластеризация → эксперты ODI формулируют структурированные потребности (22 штуки).
- Правила формулировки потребности: направление («minimize» ~90% / «increase» ~10%) + метрика (время, число, частота, вероятность). Пример: «minimize the time to confirm the reservation». Потребность = желаемый результат работы (outcome), не решение.
- Главный результат: латентные потребности нашлись в **подготовительных и завершающих** шагах (prepare/confirm) — то, что эксперты пропустили. Люди жалуются не только на «основную» услугу, но и на обвязку — ровно наш тезис «поломка коммуникации и учёта».
- Честное признание авторов: маленькая и смещённая выборка жалоб «may not clearly identify the latent needs, so the reliability of the result is not guaranteed» — прямая поддержка нашему пункту про знаменатель (см. блок 3).

Рядом стоят: **Ko et al. 2020** (Applied Sciences, [MDPI](https://www.mdpi.com/2076-3417/10/23/8473)) — фреймворк выявления unmet needs из отзывов в связке с традиционными методами; **Kumar et al. 2021** (обзор text mining в сервис-менеджменте, 445+ цитирований, [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S266709682100001X)); обзор майнинга пользовательских потребностей по тональности (ACM, 2024, [dl.acm.org](https://dl.acm.org/doi/10.1145/3696952.3696987)). Подход Ulwick (ODI, «Outcome-Driven Innovation»): важность и удовлетворённость каждого outcome измеряются, невыполненная потребность = «важно и неудовлетворено»; [Strategyn](https://strategyn.com/quantify-your-customers-unmet-needs) прямо рекомендует жалобы и обращения как сырьё для квантификации.

Вывод блока: наш пайплайн «негатив → боль → спрос» — мейнстрим-метод, а не эксперимент. Новизна радара не в методе, а в объекте: регион × ниша, агрегат по организациям и выход на ниши для предпринимателя.

### Блок 2. Фиксированная таксономия жалоб — проверенная практика

**Reader et al., «Patient complaints in healthcare systems: a systematic review and coding taxonomy»** (BMJ Quality & Safety, 2014, 624+ цитирований, [qualitysafety.bmj.com](https://qualitysafety.bmj.com/content/23/8/678)) — систематический обзор жалоб в здравоохранении; верхний уровень таксономии — три домена: **clinical** (качество лечения) · **management** (организация: ожидание, доступ, процессы, помещения) · **relationship** (уважение, коммуникация). Таксы ревизуются, применяются десятками исследований.

Наша таксономия v1 ложится в эту схему почти идеально: `booking_access`, `inventory_truth`, `communication`, `queue_speed`, `delivery_time`, `price_deception`, `info_presence` — это домен «management»; `staff_rudeness` — «relationship»; `quality`, `cleanliness` — «clinical». То есть интуиция первоначального списка подтверждается внешним эталоном.

Дополнительно: **SERVQUAL** (Parasuraman et al.) — пять измерений качества сервиса (tangibles, reliability, responsiveness, assurance, empathy) и модель разрывов (gaps model); наш тезис «~90% негатива — поломка коммуникации и учёта» — по сути утверждение, что доминируют разрывы доставки и понимания ожиданий. Аспектная тональность (ABSA — например, [обзор по e-commerce](https://link.springer.com/article/10.1007/s10660-025-09948-4), [жалобы электросети](https://ieeexplore.ieee.org/document/10808802)) — отработанная техника под наш `pain_category`: текст → аспект → знак.

### Блок 3. Отражают ли отзывы реальность: сигнал есть, но он занижен и смещён

- **Сигнал реален:** Greaves et al. 2012 (JAMA) — веб-рейтинги больниц значимо связаны с объективными мерами качества (летальность, показатели процессов). Рейтинги несут информацию, а не только шум.
- **Но систематические искажения:** психология оценивающего и культура (из индивидуалистических культур пишут чаще и длиннее), фейковые отзывы, самовыбор авторов.
- **Главная поправка для формулы — норма жалования занижена на порядок:** классическая оценка TARP — жалобу в сам бизнес оставляют лишь **~4% недовольных** (цифра старая и гуляет по учебникам, но порядок устойчив; [CustomerThink](https://customerthink.com), [Lavi](https://www.lavi.com)). Остальные молча уходят или жалуются «в сторону» — в отзывы на картах, что нам и нужно. Следствие: счёт жалоб по организации — **нижняя граница** боли, а не её измерение; абсолютные числа несопоставимы между нишами и организациями.
- Свежесть: в практике eWOM свежие отзывы считаются более диагностичными для текущего состояния сервиса — наш полураспад $e^{-\lambda\Delta t}$ согласуется, хотя точных оценок $\lambda$ в литературе мы не нашли (наш параметр останется калибруемым по данным).

### Блок 4. Майнинг отзывов приложений: «bug report vs feature request»

Направление стартовало работой **«Bug report, feature request, or simply praise?»** (2015, IEEE; [ACM DL](https://dl.acm.org)) и выросло в целую дисциплину извлечения требований из отзывов (STARE 2023, LLM-генерация user stories из отзывов, 2026). Прямая параллель для нас:

- наш «боль» = **bug report** (сломано то, что должно работать);
- «пожелание» из 4–5★ отзывов («жаль, что нет онлайн-записи», «почему нет доставки») = **feature request** — сигнал спроса на новое, который фильтр «рейтинг ≤ 3» теряет целиком.

Это независимо подтверждает замечание из [radar-projects-evaluation.md](../radar-projects-evaluation.md) (п. 2 про «wishful thinking» в 4★) и наш пункт А2: позитив с маркерами — отдельный класс сигнала.

### Блок 5. Kano: какие боли важнее для ниш

Модель Кано: **must-be** потребности не упоминаются, пока исполнены, но их провал даёт мгновенный диссатисфайзер — жалобу; **performance**-потребности жаловобно-линейны; **delighters** в жалобах не звучат ([обзорно: SurveySparrow](https://surveysparrow.com/blog/kano-model/), [Vernon Research](https://www.vernonresearch.com/kano-key-to-knowing-what-drives-customer-satisfaction/)).

Следствие для радара: отзывы с карт по построению концентрируются на must-be и performance. Хронический провал must-be (запись, наличие, цена, информация) — самый «софтуемый» сигнал (сценарий А), провалы performance (скорость, вежливость) — сервисные ниши (сценарий Б). Это теоретическая опора маппинга «боль → тип софта» из архитектуры.

### Блок 6. Рыночный угол и русскоязычный слой

Практика gap-анализа единодушна: повторяющиеся жалобы, wish-list («I wish this had…») и стабильные 3★ — признаки unmet needs ([Feefo](https://business.feefo.com/resources/guides/market-opportunities), [Melo](https://melo.co.uk/blog/how-to-spot-a-gap-in-the-market)). Академического слоя «регион по отзывам» не нашлось — ниша расследования свободна. Русскоязычный слой — вендоры и агентства (text mining отзывов, речевая аналитика: [Megaputer](https://www.megaputer.ru/en/ttext-mining-kak-analiz-teksta-pomogaet-biznesu-i-nauke), [Apexberg](https://www.apexberg.ru/kb/articles/analiz-zhalob-kak-instrument-uluchsheniya-biznesa)) — тот же метод для одного бизнеса; регионального агрегатора, как в нашем замысле, не видно.

## Шаг 3 — синтез: что это значит для формулы боли

### Что подтверждается (правок не требуется)

| Наше решение | Чем подтверждается |
|---|---|
| Отбор негатива + классификация по фиксированной таксономии | блоки 1–2: review mining и ABSA — мейнстрим; Reader 2014 — эталонная таксономия с тем же устройством |
| Затухание веса по времени | блок 3: свежесть диагностичнее объёма; λ остаётся нашим калибруемым параметром |
| Кумулятивный вес от «гипотезы» (W=1) до «подтверждённой дыры» (W≥10) | блок 1: ODI — сила потребности из повторяемости и важности; Kano — хроника must-be провалов как сильный сигнал |
| Маппинг «боль → тип софта» | блок 5: Kano — must-be провалы автоматизируются в первую очередь |
| «Носители боли — база первых клиентов» | блок 1: ODI/Strategyn — жалобы как готовое сырьё для приоритизации продукта |

### Предложения (статус: предложено 04.10.2026; метки Ф1–Ф4)

| # | Предложение | Суть | Куда |
|---|---|---|---|
| Ф1 | Нижняя граница | Счёт жалоб — нижняя оценка боли (жалуются ~4% недовольных). Не обещать абсолютную «величину боли»; сравнивать организации и ниши только долями (А1) и повторяемостью (≥ N организаций, Б7). W оставляем как внутреннюю метрику ранжирования, в UI — доля и счёт носителей | архитектура (раздел статистики), `RankPains`, дашборд |
| Ф2 | Пожелание — класс сигнала | По образцу app mining ввести класс `wish` (feature request): отзывы 4–5★ с маркерами «жаль, что нет», «почему нет», «единственное — нет…». На старте — правило по маркерам без LLM (как А2), разметка — позже. Складывать в `missing_service` | `NegativeReviewRule` → новое `WishRule`, сбор, счётчики |
| Ф3 | Таксономия v2 по внешнему эталону | При ревизии таксономии (критерий: `other` > ~20%, как И8 у idea-radar) сверить список с тремя доменами Reader (управление / отношения / качество) и пятью измерениями SERVQUAL; верхний уровень домена — колонка в таблице категорий | `PainTaxonomy`, миграция разметки |
| Ф4 | Формулировка боли по ODI | `pain_summary` в промпте v2 — структурированная форма «минимизировать/увеличить <метрику> <объекта>» (например, «минимизировать время ожидания подтверждения записи») вместо свободного предложения: боли становятся сопоставимыми и склеиваемыми — аналог канона предметов у idea-radar | промпт разметки, `VerifiedQuotes` |

Ф1 усиливает уже предложенные А1/Б7 (не меняет их), Ф2 расширяет А2, Ф3 готовит будущую ревизию, Ф4 — качество разметки фазы 3. Принятые пункты переносятся в [pain-radar-review.md](pain-radar-review.md) / [pain-radar-architecture.md](pain-radar-architecture.md) по обычному правилу, здесь меняется статус.

### Чего в литературе нет (и что остаётся нашим вкладом)

1. Региональный срез: все найденные работы — про одну компанию или один продукт; агрегат «ниша × город» из отзывов с карт не встретился.
2. Выход на предпринимателя: у literature потребитель анализа — сам владелец; цепочка «боль чужого бизнеса → идея для нового дела» — наша.
3. Оценка λ (скорость забвения боли) — не нашлось; калибруем по своим данным (динамика повторных сборов одной ниши).

## Источники

- Joung et al., 2019 — [Customer Complaints Analysis Using Text Mining and ODI (MDPI, полный текст)](https://www.mdpi.com/2071-1050/11/1/40)
- Ko et al., 2020 — [A Novel Framework for Identifying Customers' Unmet Needs (MDPI)](https://www.mdpi.com/2076-3417/10/23/8473)
- Kumar et al., 2021 — [Applications of text mining in services management (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S266709682100001X)
- [A Review of Mining User Needs Based on Text Sentiment (ACM, 2024)](https://dl.acm.org/doi/10.1145/3696952.3696987)
- Reader et al., 2014 — [Patient complaints in healthcare systems: systematic review and coding taxonomy (BMJ Qual Saf)](https://qualitysafety.bmj.com/content/23/8/678)
- [Bug report, feature request, or simply praise? (IEEE, 2015; ACM DL)](https://dl.acm.org)
- [Aspect-Based Sentiment Classification of User Reviews (Springer, 2025)](https://link.springer.com/article/10.1007/s10660-025-09948-4) · [ABSA жалоб клиентов электросети (IEEE, 2024)](https://ieeexplore.ieee.org/document/10808802)
- Greaves et al., 2012 — Associations Between Web-Based Patient Ratings and Objective Measures of Quality (JAMA)
- Норма жалования ~4% (TARP): [CustomerThink](https://customerthink.com), [Lavi](https://www.lavi.com)
- Kano: [SurveySparrow](https://surveysparrow.com/blog/kano-model/), [Vernon Research](https://www.vernonresearch.com/kano-key-to-knowing-what-drives-customer-satisfaction/)
- ODI/Strategyn: [Quantify Your Customers' Unmet Needs](https://strategyn.com/quantify-your-customers-unmet-needs)
- Практика gap-анализа: [Feefo](https://business.feefo.com/resources/guides/market-opportunities), [Melo](https://melo.co.uk/blog/how-to-spot-a-gap-in-the-market)
- Русскоязычная практика: [Megaputer](https://www.megaputer.ru/en/ttext-mining-kak-analiz-teksta-pomogaet-biznesu-i-nauke), [Apexberg](https://www.apexberg.ru/kb/articles/analiz-zhalob-kak-instrument-uluchsheniya-biznesa)

## Статус

- Шаг 1 (формулировка) — сделан 04.10.2026: основная №2, линзы №1 и №3.
- Шаг 2 (поиск и реферат) — сделан 04.10.2026.
- Шаг 3 (синтез) — вердикт: **формула подтверждается**; Ф1–Ф4 предложены, ждут решения. После принятия (или отклонения) каждого — пункт 1.4 глобального плана закрывается.
