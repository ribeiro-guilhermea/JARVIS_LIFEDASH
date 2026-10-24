// Datas sempre no formato AAAA-MM-DD, no fuso configurado (process.env.TZ).
// A semana começa na segunda-feira.

export const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const pad = (n) => String(n).padStart(2, '0');

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today() {
  return toISODate(new Date());
}

export function nowISO() {
  return new Date().toISOString();
}

export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISODate(s);
  return toISODate(d) === s;
}

export function parseISODate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // meio-dia evita problemas de horário de verão
}

export function addDays(iso, n) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function weekStart(iso) {
  const d = parseISODate(iso);
  const dow = (d.getDay() + 6) % 7; // segunda = 0
  d.setDate(d.getDate() - dow);
  return toISODate(d);
}

export function weekDays(iso) {
  const start = weekStart(iso);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function weekdayName(iso) {
  return WEEKDAYS[parseISODate(iso).getDay()];
}

export function daysBetween(a, b) {
  return Math.round((parseISODate(b) - parseISODate(a)) / 86400000);
}

// Converte um instante ISO (UTC) para a data local AAAA-MM-DD.
export function localDateOf(isoInstant) {
  return toISODate(new Date(isoInstant));
}

// Semana ISO (ex.: 2026-W43), usada no nome das notas de revisão.
export function isoWeekLabel(iso) {
  const d = parseISODate(iso);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + 3);
  const firstThursday = new Date(d.getFullYear(), 0, 4, 12);
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${pad(week)}`;
}
