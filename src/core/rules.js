// Regras de gamificação. Os valores ficam salvos no banco (tabela settings,
// chave "rules") e podem ser alterados pela tela de Ajustes, sem mexer no código.

export const DEFAULT_RULES = {
  // XP de uma tarefa conforme o esforço: 1 = pequena, 2 = média, 3 = grande.
  xp_by_effort: { 1: 10, 2: 20, 3: 40 },
  // Subtarefas e microtarefas valem pouco e têm teto diário somado,
  // para não compensar quebrar tudo em dezenas de pedacinhos.
  xp_subtask: 4,
  xp_micro: 2,
  granular_daily_cap: 30,
  xp_habit: 5,
  xp_weekly_review: 30,
  // XP total para chegar ao nível N = level_base * (N-1) * N / 2
  // Nível 2 = 100, nível 3 = 300, nível 4 = 600, nível 5 = 1000...
  level_base: 100,
  titles: [
    { min_level: 1, title: 'Aprendiz' },
    { min_level: 3, title: 'Praticante' },
    { min_level: 5, title: 'Disciplinado' },
    { min_level: 8, title: 'Construtor' },
    { min_level: 12, title: 'Estrategista' },
    { min_level: 17, title: 'Mestre de si' },
    { min_level: 25, title: 'Lenda' },
  ],
};

const int = (v, min, max) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`valor inválido: ${v}`);
  return n;
};

// Valida e completa as regras (o que faltar vem do padrão).
export function normalizeRules(input = {}) {
  const r = { ...DEFAULT_RULES, ...input };
  const effort = { ...DEFAULT_RULES.xp_by_effort, ...(input.xp_by_effort || {}) };
  const out = {
    xp_by_effort: { 1: int(effort[1], 0, 1000), 2: int(effort[2], 0, 1000), 3: int(effort[3], 0, 1000) },
    xp_subtask: int(r.xp_subtask, 0, 1000),
    xp_micro: int(r.xp_micro, 0, 1000),
    granular_daily_cap: int(r.granular_daily_cap, 0, 10000),
    xp_habit: int(r.xp_habit, 0, 1000),
    xp_weekly_review: int(r.xp_weekly_review, 0, 1000),
    level_base: int(r.level_base, 10, 100000),
    titles: Array.isArray(r.titles) && r.titles.length ? r.titles : DEFAULT_RULES.titles,
  };
  out.titles = out.titles
    .map((t) => ({ min_level: int(t.min_level, 1, 1000), title: String(t.title || '').trim() || 'Sem título' }))
    .sort((a, b) => a.min_level - b.min_level);
  return out;
}

export function xpForLevel(level, rules) {
  return (rules.level_base * (level - 1) * level) / 2;
}

export function levelInfo(totalXp, rules) {
  const xp = Math.max(0, totalXp);
  let level = 1;
  while (xpForLevel(level + 1, rules) <= xp) level++;
  const floor = xpForLevel(level, rules);
  const next = xpForLevel(level + 1, rules);
  const title = rules.titles.filter((t) => t.min_level <= level).pop()?.title || '';
  const nextTitle = rules.titles.find((t) => t.min_level > level) || null;
  return {
    total_xp: totalXp,
    level,
    title,
    level_floor_xp: floor,
    next_level_xp: next,
    xp_into_level: xp - floor,
    xp_to_next: next - xp,
    progress: next > floor ? (xp - floor) / (next - floor) : 0,
    next_title: nextTitle ? { level: nextTitle.min_level, title: nextTitle.title } : null,
  };
}
