// «До и после» простыми словами для владельца магазина (18.10.2026,
// docs/backbone-architecture.md §6.6): те же замеры из журнала, что в таблице «Цифры
// замера», но фразами — «за 2 недели вы тратили на счёт 34 мин, с помощником — 9;
// точность черновика 82 %» — и кнопка к следующему положению тумблера. Чисел здесь
// не придумываем: нет замера — так и пишем, чего не хватает.
//
// Вход — ответ BackboneDesk.measures: { shop, report, current, decision, days,
// shadowDays, switched }. Выход — { lines: [фраза], cta: { value, name } | null }.

const plural = (n, [one, few, many]) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

// «за первый день», «за 5 дней», «за 2 недели» — неделями, когда делится ровно
function period(days) {
  if (days == null) return null;
  if (days < 1) return 'за первый день';
  if (days % 7 === 0) return `за ${days / 7} ${plural(days / 7, ['неделю', 'недели', 'недель'])}`;
  return `за ${days} ${plural(days, ['день', 'дня', 'дней'])}`;
}

function minutes(m) {
  if (m == null) return null;
  if (m < 1) return 'меньше минуты';
  const total = Math.round(m);
  if (total < 60) return `${total} мин`;
  const rest = total % 60;
  return `${Math.floor(total / 60)} ч${rest ? ` ${rest} мин` : ''}`;
}

function seconds(ms) {
  if (ms == null) return null;
  if (ms < 1000) return 'меньше чем за секунду';
  return `за ${String(Math.round(ms / 100) / 10).replace('.', ',')} с`;
}

const pct = (x) => (x == null ? null : `${Math.round(x * 100)} %`);
const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);

class OwnerBrief {
  of(m) {
    if (m.shop.mode === 'off') return this.off(m);
    if (m.shop.mode === 'shadow') return this.shadow(m);
    return this.help(m);
  }

  off({ report, shadowDays }) {
    const days = shadowDays || 14;
    const before = report.before;
    return {
      lines: [
        'Разбор выключен: заявки идут только на доску, помощник их не читает.',
        `Включите «Сравнение» — помощник будет тихо готовить черновик к каждой заявке, а вы работаете как обычно и прикладываете свой счёт из 1С. Через ${days} ${plural(days, ['день', 'дня', 'дней'])} здесь будет видно, сколько минут он экономит и насколько точен.`,
        ...(before.invoiceMinutes != null
          ? [`По прошлому сравнению вы тратили на счёт ${minutes(before.invoiceMinutes)}${before.shadowAccuracy.value != null ? `; точность черновика ${pct(before.shadowAccuracy.value)}` : ''}.`]
          : []),
      ],
      cta: { value: 'shadow', name: 'Включить «Сравнение»' },
    };
  }

  shadow({ current: c, decision, days }) {
    const acc = c.shadowAccuracy;
    return {
      lines: [
        `Сравнение идёт ${period(days).replace(/^за /, '')}: заявок — ${c.orders}, ваших счетов приложено — ${acc.orders}.`,
        c.invoiceMinutes != null
          ? `Вы тратите на счёт в среднем ${minutes(c.invoiceMinutes)} рабочего времени — от заявки до счёта.`
          : 'Сколько времени уходит на счёт, станет видно после первого «Мой счёт готов».',
        ...(c.helperMs != null ? [`Помощник готовит черновик ${seconds(c.helperMs)}.`] : []),
        acc.base
          ? `Точность черновика — ${pct(acc.value)}: совпало ${acc.right} из ${acc.base} строк с вашими счетами.`
          : 'Точность черновика появится после первого вашего счёта.',
        ...(c.modelAccuracy && c.modelAccuracy.base
          ? [`Нейросеть по кнопке совпала с вашими счетами на ${pct(c.modelAccuracy.value)} (${c.modelAccuracy.right} из ${c.modelAccuracy.base} строк, заявок — ${c.modelAccuracy.orders}).`]
          : []),
        decision.ok
          ? 'Мера набрана — можно переходить в «Помощь».'
          : `Мера для «Помощи» ещё не набрана: ${decision.reason}. Перейти можно и сейчас — замер «до» останется неполным.`,
      ],
      cta: { value: 'help', name: 'Перейти в «Помощь»' },
    };
  }

  help({ report, switched }) {
    const before = report.before;
    const after = report.after;
    const toHelp = switched && switched.data.to === 'help' ? switched.data : null;
    const when = toHelp && toHelp.snapshot ? `${upper(period(toHelp.snapshot.days))} сравнения` : 'В сравнении';
    const accuracy = before.shadowAccuracy.value != null ? `; точность черновика ${pct(before.shadowAccuracy.value)}` : '';
    const lines = [];
    if (before.invoiceMinutes != null && after.invoiceMinutes != null) {
      lines.push(`${when} вы тратили на счёт ${minutes(before.invoiceMinutes)}, с помощником — ${minutes(after.invoiceMinutes)}${accuracy}.`);
      const saved = Math.round(before.invoiceMinutes - after.invoiceMinutes);
      if (saved > 0) lines.push(`Экономия — ${minutes(saved)} на каждой заявке.`);
      else if (saved < 0) lines.push(`Пока быстрее не стало: на заявку уходит на ${minutes(-saved)} больше.`);
      else lines.push('Разницы во времени пока нет.');
    } else if (before.invoiceMinutes != null) {
      lines.push(`${when} вы тратили на счёт ${minutes(before.invoiceMinutes)}${accuracy}. С помощником счетов ещё не отмечали — после «Счёт отправлен» здесь появится «после».`);
    } else if (after.invoiceMinutes != null) {
      lines.push(`С помощником счёт уходит за ${minutes(after.invoiceMinutes)}; замера «до» нет — сравнение не проводили.`);
    } else {
      lines.push('Счетов с помощником ещё не отмечали — после «Счёт отправлен» здесь появится время на счёт.');
    }
    if (after.untouched.base) lines.push(`Без правки уходит ${pct(after.untouched.value)} строк черновика (${after.untouched.right} из ${after.untouched.base}).`);
    if (after.managerMinutes != null) lines.push(`Ваша работа над черновиком — ${minutes(after.managerMinutes)} на заявку.`);
    if (toHelp && toHelp.unmeasured) lines.push(`«Помощь» включили до полной меры (${toHelp.reason}) — цифры «до» неполные.`);
    return { lines, cta: null };
  }
}

module.exports = { OwnerBrief, minutes, seconds };
