// Regras de negócio do Life Dashboard. Toda gravação (painel, Jarvis, Telegram)
// passa por aqui: é o único lugar que valida dados e lança XP.
import { transaction, plain, plainAll } from './db.js';
import { invalid, notFound, conflict } from './errors.js';
import { normalizeRules, levelInfo } from './rules.js';
import {
  today, nowISO, isISODate, addDays, weekStart, weekDays, weekdayName,
  daysBetween, localDateOf, parseISODate, isoWeekLabel,
} from './dates.js';

const STATUS_PLAN = ['active', 'paused', 'done', 'dropped'];
const SOURCES = ['dashboard', 'jarvis', 'telegram', 'system'];

// ---------- validação ----------
function text(v, field, { required = false, max = 300 } = {}) {
  if (v === undefined || v === null) {
    if (required) throw invalid(`O campo "${field}" é obrigatório.`);
    return undefined;
  }
  const s = String(v).trim();
  if (required && !s) throw invalid(`O campo "${field}" é obrigatório.`);
  if (s.length > max) throw invalid(`O campo "${field}" passa de ${max} caracteres.`);
  return s;
}
function optDate(v, field) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!isISODate(v)) throw invalid(`"${field}" deve estar no formato AAAA-MM-DD (recebido: ${v}).`);
  return v;
}
function optId(v, field) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw invalid(`"${field}" inválido.`);
  return n;
}
function oneOf(v, list, field) {
  if (v === undefined) return undefined;
  if (!list.includes(v)) throw invalid(`"${field}" deve ser um destes: ${list.join(', ')}.`);
  return v;
}
function src(s) {
  return SOURCES.includes(s) ? s : 'dashboard';
}

// Intervalo [início, fim) em UTC correspondente a um dia local.
function dayRangeUTC(isoDate) {
  const start = parseISODate(isoDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

export function createCore(db) {
  const q = (sql) => db.prepare(sql);

  function log(entity, entityId, action, source, details = {}) {
    q('INSERT INTO activity_log (at, entity, entity_id, action, source, details) VALUES (?, ?, ?, ?, ?, ?)')
      .run(nowISO(), entity, entityId ?? null, action, src(source), JSON.stringify(details));
  }

  // ---------- configurações / regras ----------
  function getRules() {
    const row = q("SELECT value FROM settings WHERE key = 'rules'").get();
    return normalizeRules(row ? JSON.parse(row.value) : {});
  }
  function setRules(input, source) {
    let rules;
    try {
      rules = normalizeRules({ ...getRules(), ...input });
    } catch (e) {
      throw invalid(`Regras inválidas: ${e.message}`);
    }
    q("INSERT INTO settings (key, value) VALUES ('rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(rules));
    log('settings', null, 'rules_updated', source, rules);
    return rules;
  }

  // ---------- áreas ----------
  function listAreas({ includeInactive = false } = {}) {
    return plainAll(q(`SELECT * FROM areas ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY sort_order, id`).all());
  }
  function getArea(id) {
    const a = plain(q('SELECT * FROM areas WHERE id = ?').get(id));
    if (!a) throw notFound(`Área ${id} não encontrada.`);
    return a;
  }
  function findArea(ref) {
    if (ref === undefined || ref === null || ref === '') return null;
    if (/^\d+$/.test(String(ref))) return getArea(Number(ref));
    const norm = fold(String(ref));
    const areas = listAreas({ includeInactive: true });
    const hit = areas.find((a) => a.slug === norm || fold(a.name) === norm)
      || areas.filter((a) => fold(a.name).includes(norm) || a.slug.includes(norm));
    if (Array.isArray(hit)) {
      if (hit.length === 1) return hit[0];
      throw invalid(`Área "${ref}" não encontrada ou ambígua. Áreas: ${areas.map((a) => a.name).join(', ')}.`);
    }
    return hit;
  }
  function createArea(input, source) {
    const name = text(input.name, 'nome', { required: true, max: 60 });
    const slug = slugify(input.slug || name);
    if (q('SELECT 1 FROM areas WHERE slug = ?').get(slug)) throw conflict(`Já existe uma área com o identificador "${slug}".`);
    const now = nowISO();
    const order = (q('SELECT MAX(sort_order) AS m FROM areas').get().m || 0) + 1;
    const r = q('INSERT INTO areas (slug, name, icon, color, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
      .run(slug, name, text(input.icon, 'ícone', { max: 8 }) || '', input.color || '#6b7280', order, now, now);
    log('area', Number(r.lastInsertRowid), 'created', source, { name });
    return getArea(Number(r.lastInsertRowid));
  }
  function updateArea(id, input, source) {
    const a = getArea(id);
    const patch = {
      name: text(input.name, 'nome', { max: 60 }),
      icon: text(input.icon, 'ícone', { max: 8 }),
      color: input.color !== undefined ? (/^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : (() => { throw invalid('Cor deve ser #RRGGBB.'); })()) : undefined,
      sort_order: input.sort_order !== undefined ? Number(input.sort_order) : undefined,
      active: input.active !== undefined ? (input.active ? 1 : 0) : undefined,
    };
    if (patch.name === '') throw invalid('O nome da área não pode ficar vazio.');
    applyUpdate('areas', a, patch);
    log('area', id, 'updated', source, diff(a, patch));
    return getArea(id);
  }

  function applyUpdate(table, before, patch) {
    const fields = Object.keys(patch).filter((k) => patch[k] !== undefined && patch[k] !== before[k]);
    if (!fields.length) return false;
    const sql = `UPDATE ${table} SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`;
    q(sql).run(...fields.map((f) => patch[f]), nowISO(), before.id);
    return true;
  }
  function diff(before, patch) {
    const d = {};
    for (const k of Object.keys(patch)) if (patch[k] !== undefined && patch[k] !== before[k]) d[k] = { de: before[k], para: patch[k] };
    return d;
  }

  // ---------- objetivos, metas, projetos ----------
  const PLAN = {
    objective: { table: 'objectives', label: 'Objetivo' },
    goal: { table: 'goals', label: 'Meta' },
    project: { table: 'projects', label: 'Projeto' },
  };
  function getPlanItem(kind, id) {
    const p = PLAN[kind];
    const row = plain(q(`SELECT * FROM ${p.table} WHERE id = ?`).get(id));
    if (!row) throw notFound(`${p.label} ${id} não encontrado(a).`);
    return row;
  }
  function planFields(kind, input, isCreate) {
    const f = {
      title: text(input.title, 'título', { required: isCreate, max: 200 }),
      description: text(input.description, 'descrição', { max: 5000 }),
      status: oneOf(input.status, STATUS_PLAN, 'status'),
      note_path: input.note_path === undefined ? undefined : (input.note_path ? text(input.note_path, 'nota', { max: 500 }) : null),
    };
    if (isCreate || input.area_id !== undefined) f.area_id = getArea(optId(input.area_id, 'área')).id;
    if (kind === 'goal') {
      f.objective_id = optId(input.objective_id, 'objetivo');
      if (f.objective_id) getPlanItem('objective', f.objective_id);
      f.target_date = optDate(input.target_date, 'data-alvo');
    }
    if (kind === 'project') {
      f.goal_id = optId(input.goal_id, 'meta');
      if (f.goal_id) getPlanItem('goal', f.goal_id);
    }
    return f;
  }
  function createPlanItem(kind, input, source) {
    const p = PLAN[kind];
    if (!p) throw invalid('Tipo inválido.');
    const f = planFields(kind, input, true);
    const now = nowISO();
    const cols = Object.keys(f).filter((k) => f[k] !== undefined);
    const r = q(`INSERT INTO ${p.table} (${cols.join(', ')}, created_at, updated_at) VALUES (${cols.map(() => '?').join(', ')}, ?, ?)`)
      .run(...cols.map((c) => f[c]), now, now);
    const id = Number(r.lastInsertRowid);
    log(kind, id, 'created', source, { title: f.title });
    return getPlanItem(kind, id);
  }
  function updatePlanItem(kind, id, input, source) {
    const before = getPlanItem(kind, id);
    const f = planFields(kind, input, false);
    if (f.title === '') throw invalid('O título não pode ficar vazio.');
    applyUpdate(PLAN[kind].table, before, f);
    log(kind, id, 'updated', source, diff(before, f));
    return getPlanItem(kind, id);
  }
  function listPlanItems(kind, { area_id, status } = {}) {
    const p = PLAN[kind];
    const where = [];
    const args = [];
    if (area_id) { where.push('area_id = ?'); args.push(Number(area_id)); }
    if (status) { where.push('status = ?'); args.push(status); }
    return plainAll(q(`SELECT * FROM ${p.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY status = 'active' DESC, id`).all(...args));
  }

  // ---------- tarefas ----------
  function getTaskRow(id) {
    const t = plain(q('SELECT * FROM tasks WHERE id = ?').get(id));
    if (!t) throw notFound(`Tarefa ${id} não encontrada.`);
    return t;
  }
  function decorate(t, areasById) {
    const area = t.area_id ? areasById.get(t.area_id) : null;
    return {
      ...t,
      is_priority: !!t.is_priority,
      area_name: area ? area.name : null,
      area_icon: area ? area.icon : null,
      area_color: area ? area.color : null,
    };
  }
  function areaMap() {
    return new Map(listAreas({ includeInactive: true }).map((a) => [a.id, a]));
  }
  function getTask(id) {
    const t = decorate(getTaskRow(id), areaMap());
    const am = areaMap();
    t.children = plainAll(q('SELECT * FROM tasks WHERE parent_id = ? ORDER BY status = \'pending\' DESC, id').all(id)).map((c) => decorate(c, am));
    t.ancestors = [];
    let p = t.parent_id;
    while (p) {
      const a = getTaskRow(p);
      t.ancestors.unshift({ id: a.id, title: a.title, granularity: a.granularity });
      p = a.parent_id;
    }
    t.xp_entries = plainAll(q('SELECT * FROM xp_ledger WHERE task_id = ? ORDER BY id').all(id));
    t.history = plainAll(q("SELECT * FROM activity_log WHERE entity = 'task' AND entity_id = ? ORDER BY id").all(id))
      .map((h) => ({ ...h, details: JSON.parse(h.details) }));
    if (t.project_id) t.project = getPlanItem('project', t.project_id);
    if (t.goal_id) t.goal = getPlanItem('goal', t.goal_id);
    return t;
  }

  function taskFields(input, isCreate) {
    const f = {
      title: text(input.title, 'título', { required: isCreate, max: 300 }),
      notes: text(input.notes, 'observações', { max: 10000 }),
      area_id: optId(input.area_id, 'área'),
      goal_id: optId(input.goal_id, 'meta'),
      project_id: optId(input.project_id, 'projeto'),
      planned_date: optDate(input.planned_date, 'data planejada'),
      due_date: optDate(input.due_date, 'prazo'),
      is_priority: input.is_priority === undefined ? undefined : (input.is_priority ? 1 : 0),
      effort: input.effort === undefined ? undefined : Number(input.effort),
    };
    if (f.effort !== undefined && ![1, 2, 3].includes(f.effort)) throw invalid('Esforço deve ser 1 (pequeno), 2 (médio) ou 3 (grande).');
    if (f.area_id) getArea(f.area_id);
    if (f.goal_id) getPlanItem('goal', f.goal_id);
    if (f.project_id) {
      const p = getPlanItem('project', f.project_id);
      if (f.area_id === undefined && isCreate) f.area_id = p.area_id;
    }
    return f;
  }

  function createTask(input, source = 'dashboard') {
    return transaction(db, () => {
      const f = taskFields(input, true);
      let granularity = 'task';
      if (input.parent_id) {
        const parent = getTaskRow(optId(input.parent_id, 'tarefa-mãe'));
        if (parent.granularity === 'micro') throw invalid('Microtarefas não podem ter subdivisões.');
        if (parent.status !== 'pending') throw invalid('Só é possível dividir tarefas pendentes.');
        granularity = parent.granularity === 'task' ? 'subtask' : 'micro';
        f.parent_id = parent.id;
        if (f.area_id === undefined || f.area_id === null) f.area_id = parent.area_id;
        if (f.project_id === undefined) f.project_id = parent.project_id;
        if (f.goal_id === undefined) f.goal_id = parent.goal_id;
      }
      if (input.granularity && input.granularity !== granularity) {
        throw invalid(`Granularidade é definida pela posição: aqui seria "${granularity}".`);
      }
      const now = nowISO();
      const row = {
        parent_id: f.parent_id ?? null,
        area_id: f.area_id ?? null,
        goal_id: f.goal_id ?? null,
        project_id: f.project_id ?? null,
        title: f.title,
        notes: f.notes ?? '',
        granularity,
        is_priority: f.is_priority ?? 0,
        effort: f.effort ?? 1,
        planned_date: f.planned_date ?? null,
        due_date: f.due_date ?? null,
        source: src(source),
      };
      const cols = Object.keys(row);
      const r = q(`INSERT INTO tasks (${cols.join(', ')}, status, created_at, updated_at) VALUES (${cols.map(() => '?').join(', ')}, 'pending', ?, ?)`)
        .run(...cols.map((c) => row[c]), now, now);
      const id = Number(r.lastInsertRowid);
      log('task', id, 'created', source, { title: row.title, planned_date: row.planned_date, due_date: row.due_date });
      return getTask(id);
    });
  }

  function updateTask(id, input, source = 'dashboard') {
    return transaction(db, () => {
      const before = getTaskRow(id);
      if ('status' in input || 'completed_at' in input || 'granularity' in input || 'parent_id' in input) {
        throw invalid('Status, conclusão e hierarquia são alterados por ações próprias (concluir, reabrir, cancelar, dividir).');
      }
      const f = taskFields(input, false);
      if (f.title === '') throw invalid('O título não pode ficar vazio.');
      const d = diff(before, f);
      applyUpdate('tasks', before, f);
      if (Object.keys(d).length) log('task', id, 'updated', source, d);
      return getTask(id);
    });
  }

  function pendingDescendants(id) {
    const out = [];
    const walk = (pid) => {
      for (const c of plainAll(q('SELECT * FROM tasks WHERE parent_id = ?').all(pid))) {
        if (c.status === 'pending') out.push(c);
        walk(c.id);
      }
    };
    walk(id);
    return out;
  }

  function activeAward(where, args) {
    return plain(q(`SELECT * FROM xp_ledger l WHERE ${where}
      AND NOT EXISTS (SELECT 1 FROM xp_ledger r WHERE r.reverses_id = l.id)
      ORDER BY l.id DESC LIMIT 1`).get(...args));
  }

  function insertXp(e) {
    const r = q(`INSERT INTO xp_ledger (created_at, amount, kind, category, task_id, habit_id, habit_date, review_id, reverses_id, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      nowISO(), e.amount, e.kind, e.category, e.task_id ?? null, e.habit_id ?? null,
      e.habit_date ?? null, e.review_id ?? null, e.reverses_id ?? null, e.note ?? ''
    );
    return plain(q('SELECT * FROM xp_ledger WHERE id = ?').get(Number(r.lastInsertRowid)));
  }

  function reverse(entry, kind, note) {
    return insertXp({
      amount: -entry.amount, kind, category: entry.category, task_id: entry.task_id,
      habit_id: entry.habit_id, habit_date: entry.habit_date, review_id: entry.review_id,
      reverses_id: entry.id, note,
    });
  }

  function taskXp(task, rules) {
    if (task.granularity === 'task') {
      return { category: 'task', amount: rules.xp_by_effort[task.effort] ?? 0, note: `tarefa (esforço ${task.effort})` };
    }
    const base = task.granularity === 'subtask' ? rules.xp_subtask : rules.xp_micro;
    const [from, to] = dayRangeUTC(today());
    const used = q("SELECT COALESCE(SUM(amount), 0) AS s FROM xp_ledger WHERE category = 'granular' AND created_at >= ? AND created_at < ?")
      .get(from, to).s;
    const room = Math.max(0, rules.granular_daily_cap - used);
    const amount = Math.min(base, room);
    const label = task.granularity === 'subtask' ? 'subtarefa' : 'microtarefa';
    return {
      category: 'granular',
      amount,
      note: amount < base ? `${label} (limite diário de ${rules.granular_daily_cap} XP para subdivisões atingido)` : label,
    };
  }

  function completeTask(id, { cascade = false } = {}, source = 'dashboard') {
    return transaction(db, () => {
      const task = getTaskRow(id);
      if (task.status === 'done') return { task: getTask(id), xp: null, already_done: true };
      if (task.status === 'cancelled') throw conflict('Tarefa cancelada. Reabra-a antes de concluir.');
      const pending = pendingDescendants(id);
      if (pending.length && !cascade) {
        throw conflict(`Esta tarefa tem ${pending.length} subdivisão(ões) pendente(s). Confirme para concluir tudo junto.`, {
          pending: pending.map((p) => ({ id: p.id, title: p.title })),
        });
      }
      const now = nowISO();
      // Subdivisões concluídas junto com a tarefa-mãe não geram XP próprio
      // (o XP vem da tarefa-mãe), para não premiar duas vezes o mesmo trabalho.
      for (const p of pending) {
        q("UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?").run(now, now, p.id);
        log('task', p.id, 'completed', source, { via_parent: id, xp: 0 });
      }
      q("UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
      const rules = getRules();
      const calc = taskXp(task, rules);
      const xp = insertXp({ amount: calc.amount, kind: 'task_completed', category: calc.category, task_id: id, note: calc.note });
      log('task', id, 'completed', source, { xp: xp.amount, xp_entry: xp.id, cascaded: pending.map((p) => p.id) });
      return { task: getTask(id), xp, already_done: false };
    });
  }

  function reopenTask(id, source = 'dashboard') {
    return transaction(db, () => {
      const task = getTaskRow(id);
      if (task.status === 'pending') return { task: getTask(id), reversal: null, already_pending: true };
      if (task.parent_id && getTaskRow(task.parent_id).status !== 'pending') {
        throw conflict('A tarefa-mãe não está pendente. Reabra a tarefa-mãe primeiro.');
      }
      q("UPDATE tasks SET status = 'pending', completed_at = NULL, updated_at = ? WHERE id = ?").run(nowISO(), id);
      let reversal = null;
      if (task.status === 'done') {
        const award = activeAward("l.task_id = ? AND l.kind = 'task_completed'", [id]);
        if (award) reversal = reverse(award, 'task_reopened', `estorno do lançamento #${award.id} (tarefa reaberta)`);
      }
      log('task', id, 'reopened', source, { from: task.status, xp_reversal: reversal ? reversal.amount : 0 });
      return { task: getTask(id), reversal, already_pending: false };
    });
  }

  function cancelTask(id, source = 'dashboard') {
    return transaction(db, () => {
      const task = getTaskRow(id);
      if (task.status === 'cancelled') return getTask(id);
      if (task.status === 'done') throw conflict('Tarefa concluída. Reabra antes de cancelar.');
      const now = nowISO();
      for (const p of pendingDescendants(id)) {
        q("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, p.id);
        log('task', p.id, 'cancelled', source, { via_parent: id });
      }
      q("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, id);
      log('task', id, 'cancelled', source, {});
      return getTask(id);
    });
  }

  function listTasks(filter = {}) {
    const where = [];
    const args = [];
    const status = filter.status || 'pending';
    if (status !== 'all') { where.push('t.status = ?'); args.push(oneOf(status, ['pending', 'done', 'cancelled'], 'status')); }
    if (filter.area_id) { where.push('t.area_id = ?'); args.push(Number(filter.area_id)); }
    if (filter.project_id) { where.push('t.project_id = ?'); args.push(Number(filter.project_id)); }
    if (filter.goal_id) { where.push('t.goal_id = ?'); args.push(Number(filter.goal_id)); }
    if (filter.parent_id) { where.push('t.parent_id = ?'); args.push(Number(filter.parent_id)); }
    if (filter.root_only) where.push('t.parent_id IS NULL');
    if (filter.priority) where.push('t.is_priority = 1');
    if (filter.from) { where.push('COALESCE(t.planned_date, t.due_date) >= ?'); args.push(optDate(filter.from, 'de')); }
    if (filter.to) { where.push('COALESCE(t.planned_date, t.due_date) <= ?'); args.push(optDate(filter.to, 'até')); }
    let rows = plainAll(q(`SELECT t.* FROM tasks t ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY t.is_priority DESC, COALESCE(t.due_date, t.planned_date, '9999') ASC, t.id ASC`).all(...args));
    if (filter.q) {
      const terms = fold(filter.q).split(/\s+/).filter(Boolean);
      rows = rows.filter((r) => { const h = fold(`${r.title} ${r.notes}`); return terms.every((t) => h.includes(t)); });
    }
    const limit = Math.min(Number(filter.limit) || 200, 500);
    const am = areaMap();
    const childCounts = subtaskCounts();
    return rows.slice(0, limit).map((r) => ({ ...decorate(r, am), subtasks: childCounts.get(r.id) || { total: 0, done: 0 } }));
  }

  function subtaskCounts() {
    return new Map(plainAll(q("SELECT parent_id, COUNT(*) AS n, SUM(status = 'done') AS d FROM tasks WHERE parent_id IS NOT NULL AND status != 'cancelled' GROUP BY parent_id").all())
      .map((r) => [r.parent_id, { total: r.n, done: r.d }]));
  }

  // ---------- hábitos ----------
  function getHabit(id) {
    const h = plain(q('SELECT * FROM habits WHERE id = ?').get(id));
    if (!h) throw notFound(`Hábito ${id} não encontrado.`);
    return h;
  }
  function createHabit(input, source) {
    const title = text(input.title, 'título', { required: true, max: 120 });
    const area_id = optId(input.area_id, 'área') ?? null;
    if (area_id) getArea(area_id);
    const target = input.target_per_week === undefined ? 7 : Number(input.target_per_week);
    if (!Number.isInteger(target) || target < 1 || target > 7) throw invalid('Meta semanal deve ser de 1 a 7 dias.');
    const now = nowISO();
    const r = q('INSERT INTO habits (area_id, title, target_per_week, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(area_id, title, target, now, now);
    log('habit', Number(r.lastInsertRowid), 'created', source, { title });
    return getHabit(Number(r.lastInsertRowid));
  }
  function updateHabit(id, input, source) {
    const before = getHabit(id);
    const patch = {
      title: text(input.title, 'título', { max: 120 }),
      area_id: optId(input.area_id, 'área'),
      target_per_week: input.target_per_week === undefined ? undefined : Number(input.target_per_week),
      active: input.active === undefined ? undefined : (input.active ? 1 : 0),
    };
    if (patch.title === '') throw invalid('O título não pode ficar vazio.');
    if (patch.target_per_week !== undefined && !(patch.target_per_week >= 1 && patch.target_per_week <= 7)) throw invalid('Meta semanal deve ser de 1 a 7 dias.');
    if (patch.area_id) getArea(patch.area_id);
    applyUpdate('habits', before, patch);
    log('habit', id, 'updated', source, diff(before, patch));
    return getHabit(id);
  }
  function listHabits(refDate = today()) {
    const days = weekDays(refDate);
    const am = areaMap();
    return plainAll(q('SELECT * FROM habits WHERE active = 1 ORDER BY id').all()).map((h) => {
      const checks = plainAll(q('SELECT date FROM habit_checks WHERE habit_id = ? AND date BETWEEN ? AND ?').all(h.id, days[0], days[6])).map((c) => c.date);
      const area = h.area_id ? am.get(h.area_id) : null;
      return { ...h, area_name: area?.name ?? null, area_icon: area?.icon ?? null, week: days.map((d) => ({ date: d, done: checks.includes(d) })), week_count: checks.length };
    });
  }
  function checkHabit(id, date = today(), source = 'dashboard') {
    return transaction(db, () => {
      const h = getHabit(id);
      if (!h.active) throw conflict('Hábito inativo.');
      if (!isISODate(date)) throw invalid('Data inválida.');
      if (date > today()) throw invalid('Não é possível marcar um hábito no futuro.');
      const r = q('INSERT OR IGNORE INTO habit_checks (habit_id, date, created_at) VALUES (?, ?, ?)').run(id, date, nowISO());
      if (!r.changes) return { checked: true, xp: null, already: true };
      const xp = insertXp({ amount: getRules().xp_habit, kind: 'habit_checked', category: 'habit', habit_id: id, habit_date: date, note: `hábito: ${h.title} (${date})` });
      log('habit', id, 'checked', source, { date, xp: xp.amount });
      return { checked: true, xp, already: false };
    });
  }
  function uncheckHabit(id, date = today(), source = 'dashboard') {
    return transaction(db, () => {
      getHabit(id);
      const r = q('DELETE FROM habit_checks WHERE habit_id = ? AND date = ?').run(id, date);
      if (!r.changes) return { checked: false, reversal: null, already: true };
      const award = activeAward("l.habit_id = ? AND l.habit_date = ? AND l.kind = 'habit_checked'", [id, date]);
      const reversal = award ? reverse(award, 'habit_unchecked', `estorno do lançamento #${award.id} (hábito desmarcado)`) : null;
      log('habit', id, 'unchecked', source, { date });
      return { checked: false, reversal, already: false };
    });
  }

  // ---------- XP ----------
  function totalXp() {
    return q('SELECT COALESCE(SUM(amount), 0) AS s FROM xp_ledger').get().s;
  }
  function xpBetween(fromDate, toDate) {
    const [from] = dayRangeUTC(fromDate);
    const [, to] = dayRangeUTC(toDate);
    return q('SELECT COALESCE(SUM(amount), 0) AS s FROM xp_ledger WHERE created_at >= ? AND created_at < ?').get(from, to).s;
  }
  function xpStatus() {
    return levelInfo(totalXp(), getRules());
  }
  function listLedger({ limit = 100, offset = 0 } = {}) {
    return plainAll(q(`SELECT l.*, t.title AS task_title, h.title AS habit_title FROM xp_ledger l
      LEFT JOIN tasks t ON t.id = l.task_id LEFT JOIN habits h ON h.id = l.habit_id
      ORDER BY l.id DESC LIMIT ? OFFSET ?`).all(Math.min(Number(limit) || 100, 500), Number(offset) || 0));
  }
  function addAdjustment({ amount, note }, source = 'dashboard') {
    const n = Number(amount);
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 10000) throw invalid('Ajuste deve ser um número inteiro diferente de zero.');
    const why = text(note, 'motivo', { required: true, max: 300 });
    const e = insertXp({ amount: n, kind: 'adjustment', category: 'adjustment', note: why });
    log('xp', e.id, 'adjustment', source, { amount: n, note: why });
    return e;
  }
  function xpHistory(weeks = 12) {
    const end = weekStart(today());
    const starts = Array.from({ length: weeks }, (_, i) => addDays(end, -7 * (weeks - 1 - i)));
    const rows = plainAll(q('SELECT amount, created_at FROM xp_ledger WHERE created_at >= ?').all(dayRangeUTC(starts[0])[0]));
    const byWeek = new Map(starts.map((s) => [s, 0]));
    for (const r of rows) {
      const ws = weekStart(localDateOf(r.created_at));
      if (byWeek.has(ws)) byWeek.set(ws, byWeek.get(ws) + r.amount);
    }
    let running = totalXp() - [...byWeek.values()].reduce((a, b) => a + b, 0);
    return starts.map((s) => { running += byWeek.get(s); return { week_start: s, xp: byWeek.get(s), total_after: running }; });
  }

  // ---------- temporadas ----------
  function createSeason(input, source) {
    const name = text(input.name, 'nome', { required: true, max: 80 });
    const start = optDate(input.start_date, 'início');
    const end = optDate(input.end_date, 'fim');
    if (!start || !end || end < start) throw invalid('Informe início e fim válidos (fim depois do início).');
    const goal = Number(input.xp_goal || 0);
    if (!Number.isInteger(goal) || goal < 0) throw invalid('Meta de XP inválida.');
    const r = q('INSERT INTO seasons (name, start_date, end_date, xp_goal, created_at) VALUES (?, ?, ?, ?, ?)').run(name, start, end, goal, nowISO());
    log('season', Number(r.lastInsertRowid), 'created', source, { name, start, end, goal });
    return plain(q('SELECT * FROM seasons WHERE id = ?').get(Number(r.lastInsertRowid)));
  }
  function currentSeason(date = today()) {
    const s = plain(q('SELECT * FROM seasons WHERE start_date <= ? AND end_date >= ? ORDER BY id DESC LIMIT 1').get(date, date));
    if (!s) return null;
    const xp = xpBetween(s.start_date, date);
    return { ...s, xp, progress: s.xp_goal ? Math.min(1, xp / s.xp_goal) : null, days_left: daysBetween(date, s.end_date) };
  }
  function listSeasons() {
    return plainAll(q('SELECT * FROM seasons ORDER BY start_date DESC').all());
  }

  // ---------- visão semanal ----------
  function overview(refDate = today()) {
    if (!isISODate(refDate)) throw invalid('Data inválida.');
    const now = today();
    const days = weekDays(refDate);
    const [ws, we] = [days[0], days[6]];
    const am = areaMap();
    const all = plainAll(q(`SELECT * FROM tasks WHERE status != 'cancelled' AND (
        (status = 'pending') OR (completed_at IS NOT NULL AND completed_at >= ?)
      )`).all(dayRangeUTC(ws)[0])).map((t) => decorate(t, am));
    const counts = subtaskCounts();
    for (const t of all) t.subtasks = counts.get(t.id) || { total: 0, done: 0 };

    const inWeek = (t) => {
      // Subdivisões sem data própria aparecem dentro da tarefa-mãe, não soltas na semana.
      if (t.parent_id && !t.planned_date && !t.due_date) return false;
      if (t.status === 'done') { const cd = localDateOf(t.completed_at); return cd >= ws && cd <= we; }
      const d = t.planned_date || t.due_date;
      return d && d >= ws && d <= we;
    };
    const dayOf = (t) => {
      if (t.status === 'done') {
        const cd = localDateOf(t.completed_at);
        return t.planned_date && t.planned_date >= ws && t.planned_date <= we ? t.planned_date : cd;
      }
      return t.planned_date && t.planned_date >= ws && t.planned_date <= we ? t.planned_date : t.due_date;
    };
    const weekTasks = all.filter(inWeek);
    const byDay = days.map((d) => ({
      date: d,
      weekday: weekdayName(d),
      is_today: d === now,
      tasks: weekTasks.filter((t) => dayOf(t) === d).sort((a, b) => (a.status === 'done') - (b.status === 'done') || b.is_priority - a.is_priority),
    }));
    const pending = all.filter((t) => t.status === 'pending');
    const overdue = pending.filter((t) => t.due_date && t.due_date < now);
    const carried = pending.filter((t) => !(t.due_date && t.due_date < now) && t.planned_date && t.planned_date < ws);
    const unscheduled = pending.filter((t) => !t.planned_date && !t.due_date && !t.parent_id);
    const priorities = pending.filter((t) => t.is_priority)
      .sort((a, b) => (a.due_date || a.planned_date || '9999').localeCompare(b.due_date || b.planned_date || '9999'));

    const doneWeek = weekTasks.filter((t) => t.status === 'done');

    // Atenção por área: atividade (tarefas e hábitos) dos últimos dias, sem julgamento.
    const lastDone = new Map(plainAll(q("SELECT area_id, MAX(completed_at) AS last FROM tasks WHERE status = 'done' AND area_id IS NOT NULL GROUP BY area_id").all()).map((r) => [r.area_id, r.last]));
    const lastHabit = new Map(plainAll(q('SELECT h.area_id, MAX(c.date) AS last FROM habit_checks c JOIN habits h ON h.id = c.habit_id WHERE h.area_id IS NOT NULL GROUP BY h.area_id').all()).map((r) => [r.area_id, r.last]));
    const areas = listAreas().map((a) => {
      const dates = [lastDone.get(a.id) && localDateOf(lastDone.get(a.id)), lastHabit.get(a.id)].filter(Boolean).sort();
      const last = dates.pop() || null;
      return {
        id: a.id, name: a.name, icon: a.icon, color: a.color,
        done_week: doneWeek.filter((t) => t.area_id === a.id).length,
        pending_week: weekTasks.filter((t) => t.area_id === a.id && t.status === 'pending').length,
        pending_total: pending.filter((t) => t.area_id === a.id).length,
        last_activity: last,
        days_since_activity: last ? daysBetween(last, now) : null,
      };
    });

    return {
      today: now,
      today_weekday: weekdayName(now),
      week: { start: ws, end: we, label: isoWeekLabel(ws), is_current: weekStart(now) === ws, days: byDay },
      counts: {
        // "na semana" = tudo que pertence à semana (pendente ou concluído nela)
        planned: weekTasks.length,
        done: doneWeek.length,
        pending: weekTasks.filter((t) => t.status === 'pending').length,
        overdue: overdue.length,
      },
      xp: { ...xpStatus(), week: xpBetween(ws, we), today: xpBetween(now, now) },
      season: currentSeason(now),
      priorities,
      overdue,
      carried_over: carried,
      unscheduled,
      areas,
      habits: listHabits(refDate),
    };
  }

  // ---------- revisão semanal ----------
  function reviewDraft(refDate = today()) {
    const ov = overview(refDate);
    const ws = ov.week.start;
    const existing = plain(q('SELECT * FROM weekly_reviews WHERE week_start = ?').get(ws));
    const done = ov.week.days.flatMap((d) => d.tasks.filter((t) => t.status === 'done'));
    const pendingWeek = ov.week.days.flatMap((d) => d.tasks.filter((t) => t.status === 'pending'));
    const nextWeek = listTasks({ status: 'pending', from: addDays(ws, 7), to: addDays(ws, 13) });
    return {
      week: { start: ws, end: ov.week.end, label: ov.week.label },
      xp_week: ov.xp.week,
      level: { level: ov.xp.level, title: ov.xp.title, total_xp: ov.xp.total_xp },
      done: done.map((t) => ({ id: t.id, title: t.title, area: t.area_name })),
      done_by_area: ov.areas.map((a) => ({ area: a.name, done: a.done_week })),
      still_pending: pendingWeek.map((t) => ({ id: t.id, title: t.title, area: t.area_name, planned_date: t.planned_date, due_date: t.due_date })),
      overdue: ov.overdue.map((t) => ({ id: t.id, title: t.title, due_date: t.due_date })),
      habits: ov.habits.map((h) => ({ title: h.title, done: h.week_count, target: h.target_per_week })),
      quiet_areas: ov.areas.filter((a) => a.done_week === 0).map((a) => ({ area: a.name, days_since_activity: a.days_since_activity })),
      next_week_planned: nextWeek.map((t) => ({ id: t.id, title: t.title, planned_date: t.planned_date, due_date: t.due_date })),
      saved_review: existing ? { ...existing, snapshot: JSON.parse(existing.snapshot) } : null,
    };
  }

  function saveReview(input, source = 'dashboard') {
    return transaction(db, () => {
      const ws = weekStart(optDate(input.week_start, 'semana') || today());
      const fields = {
        wins: text(input.wins, 'conquistas', { max: 5000 }) ?? '',
        difficulties: text(input.difficulties, 'dificuldades', { max: 5000 }) ?? '',
        lessons: text(input.lessons, 'aprendizados', { max: 5000 }) ?? '',
        next_focus: text(input.next_focus, 'foco da próxima semana', { max: 5000 }) ?? '',
      };
      const snapshot = JSON.stringify(reviewDraft(ws));
      const now = nowISO();
      const existing = plain(q('SELECT * FROM weekly_reviews WHERE week_start = ?').get(ws));
      let id;
      if (existing) {
        q('UPDATE weekly_reviews SET wins = ?, difficulties = ?, lessons = ?, next_focus = ?, snapshot = ?, updated_at = ? WHERE id = ?')
          .run(fields.wins, fields.difficulties, fields.lessons, fields.next_focus, snapshot, now, existing.id);
        id = existing.id;
      } else {
        id = Number(q('INSERT INTO weekly_reviews (week_start, wins, difficulties, lessons, next_focus, snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(ws, fields.wins, fields.difficulties, fields.lessons, fields.next_focus, snapshot, now, now).lastInsertRowid);
      }
      if (input.note_path !== undefined) q('UPDATE weekly_reviews SET note_path = ? WHERE id = ?').run(input.note_path, id);
      let xp = null;
      if (!activeAward("l.review_id = ? AND l.kind = 'review_completed'", [id])) {
        xp = insertXp({ amount: getRules().xp_weekly_review, kind: 'review_completed', category: 'review', review_id: id, note: `revisão semanal ${isoWeekLabel(ws)}` });
      }
      log('review', id, existing ? 'updated' : 'created', source, { week_start: ws });
      const row = plain(q('SELECT * FROM weekly_reviews WHERE id = ?').get(id));
      return { review: { ...row, snapshot: JSON.parse(row.snapshot) }, xp };
    });
  }
  function listReviews() {
    return plainAll(q('SELECT id, week_start, wins, next_focus, note_path, created_at, updated_at FROM weekly_reviews ORDER BY week_start DESC').all());
  }

  function activity({ limit = 50 } = {}) {
    return plainAll(q('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?').all(Math.min(Number(limit) || 50, 500)))
      .map((r) => ({ ...r, details: JSON.parse(r.details) }));
  }

  function areaDetail(id) {
    const area = getArea(id);
    return {
      area,
      objectives: listPlanItems('objective', { area_id: id }),
      goals: listPlanItems('goal', { area_id: id }),
      projects: listPlanItems('project', { area_id: id }),
      tasks: listTasks({ area_id: id, status: 'pending', root_only: true }),
      done_recent: listTasks({ area_id: id, status: 'done', limit: 15 }).sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || '')),
      habits: listHabits().filter((h) => h.area_id === id),
    };
  }

  // Contexto de um projeto (para o Jarvis retomar de onde parou).
  function projectContext(ref) {
    let projects = listPlanItems('project');
    if (/^\d+$/.test(String(ref))) projects = projects.filter((p) => p.id === Number(ref));
    else { const n = fold(String(ref)); projects = projects.filter((p) => fold(p.title).includes(n)); }
    return projects.slice(0, 5).map((p) => ({
      project: p,
      area: getArea(p.area_id).name,
      goal: p.goal_id ? getPlanItem('goal', p.goal_id) : null,
      pending_tasks: listTasks({ project_id: p.id, status: 'pending' }).map((t) => ({ id: t.id, title: t.title, planned_date: t.planned_date, due_date: t.due_date, is_priority: t.is_priority })),
      recently_done: listTasks({ project_id: p.id, status: 'done', limit: 10 }).map((t) => ({ id: t.id, title: t.title, completed_at: t.completed_at })),
      history: plainAll(q("SELECT at, action, details FROM activity_log WHERE entity = 'project' AND entity_id = ? ORDER BY id DESC LIMIT 10").all(p.id)),
    }));
  }

  return {
    db, getRules, setRules,
    listAreas, getArea, findArea, createArea, updateArea, areaDetail,
    createPlanItem, updatePlanItem, listPlanItems, getPlanItem, projectContext,
    createTask, updateTask, completeTask, reopenTask, cancelTask, listTasks, getTask,
    createHabit, updateHabit, listHabits, checkHabit, uncheckHabit,
    totalXp, xpStatus, listLedger, addAdjustment, xpHistory, xpBetween,
    createSeason, currentSeason, listSeasons,
    overview, reviewDraft, saveReview, listReviews, activity,
  };
}

// Remove acentos e caixa, para buscas tolerantes ("Saude" encontra "Saúde").
export function fold(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
export function slugify(s) {
  return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}
