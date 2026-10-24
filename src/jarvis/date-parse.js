// Interpreta expressões de data em português de forma determinística.
// Quando a expressão é ambígua, devolve ambiguous: true em vez de chutar.
import { today, addDays, parseISODate, toISODate, isISODate, weekdayName } from '../core/dates.js';
import { fold } from '../core/service.js';

const WD = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
const MONTHS = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

export function parseDatePt(input, ref = today()) {
  const raw = String(input || '').trim();
  const s = fold(raw).replace(/-feira/g, '').replace(/\s+/g, ' ').replace(/[.,!?]$/, '');
  const ok = (date, note) => ({ ok: true, date, weekday: weekdayName(date), input: raw, note });
  const bad = (reason, extra = {}) => ({ ok: false, input: raw, reason, ...extra });
  if (!s) return bad('vazio');

  if (isISODate(s)) return ok(s);
  if (s === 'hoje') return ok(ref);
  if (s === 'amanha') return ok(addDays(ref, 1));
  if (s === 'depois de amanha') return ok(addDays(ref, 2));
  if (s === 'ontem') return ok(addDays(ref, -1));

  let m = /^(?:daqui a|em) (\d{1,3}) dias?$/.exec(s);
  if (m) return ok(addDays(ref, Number(m[1])));

  // dia da semana: "quinta", "na quinta", "proxima quinta", "quinta que vem"
  m = /^(?:(?:na|no|nesta|neste|nessa|nesse|esta|este|essa|esse) )?(proxima |proximo )?(domingo|segunda|terca|quarta|quinta|sexta|sabado)( que vem)?$/.exec(s);
  if (m) {
    const target = WD[m[2]];
    const cur = parseISODate(ref).getDay();
    let diff = (target - cur + 7) % 7;
    const explicitNext = Boolean(m[1] || m[3]);
    if (diff === 0) {
      if (!explicitNext) {
        return bad('ambíguo', {
          ambiguous: true,
          options: [ref, addDays(ref, 7)],
          question: `Hoje já é ${weekdayName(ref)}. Você quer dizer hoje (${ref}) ou a próxima (${addDays(ref, 7)})?`,
        });
      }
      diff = 7;
    }
    return ok(addDays(ref, diff));
  }

  // 25/10, 25/10/2026, 25-10-26
  m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(s);
  if (m) return fromParts(Number(m[1]), Number(m[2]), m[3], ref, raw);

  // "25 de outubro", "dia 25 de outubro de 2026"
  m = /^(?:dia )?(\d{1,2}) de ([a-z]+)(?: de (\d{4}))?$/.exec(s);
  if (m && MONTHS[m[2]]) return fromParts(Number(m[1]), MONTHS[m[2]], m[3], ref, raw);

  // "dia 25": próximo dia 25 (este mês ou o seguinte)
  m = /^dia (\d{1,2})$/.exec(s);
  if (m) {
    const d = parseISODate(ref);
    const day = Number(m[1]);
    let cand = new Date(d.getFullYear(), d.getMonth(), day, 12);
    if (cand.getDate() !== day) return bad('data inexistente');
    if (toISODate(cand) < ref) cand = new Date(d.getFullYear(), d.getMonth() + 1, day, 12);
    if (cand.getDate() !== day) return bad('data inexistente');
    return ok(toISODate(cand));
  }

  return bad('não reconhecida');
}

function fromParts(day, month, yearStr, ref, raw) {
  const refD = parseISODate(ref);
  let year;
  let note;
  if (yearStr) {
    year = Number(yearStr.length === 2 ? `20${yearStr}` : yearStr);
  } else {
    year = refD.getFullYear();
    const cand = new Date(year, month - 1, day, 12);
    // sem ano e já passou há mais de 2 meses: provavelmente é do ano que vem
    if ((refD - cand) / 86400000 > 60) { year += 1; note = 'Assumi o próximo ano.'; }
  }
  const d = new Date(year, month - 1, day, 12);
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return { ok: false, input: raw, reason: 'data inexistente' };
  const iso = toISODate(d);
  return { ok: true, date: iso, weekday: weekdayName(iso), input: raw, note };
}
