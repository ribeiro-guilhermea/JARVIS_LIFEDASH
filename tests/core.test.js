import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpDir } from './helpers.js';
import { openDatabase } from '../src/core/db.js';
import { createCore } from '../src/core/service.js';
import { levelInfo, DEFAULT_RULES, normalizeRules } from '../src/core/rules.js';
import { today, addDays, weekStart } from '../src/core/dates.js';

const fresh = () => createCore(openDatabase(':memory:'));

test('cria as sete áreas iniciais', () => {
  const c = fresh();
  assert.deepEqual(c.listAreas().map((a) => a.slug), ['igreja', 'familia', 'faculdade', 'empresa', 'projetos', 'casa', 'saude']);
});

test('tarefa simples existe sem área, meta ou projeto', () => {
  const c = fresh();
  const t = c.createTask({ title: 'Comprar pão' });
  assert.equal(t.area_id, null);
  assert.equal(t.granularity, 'task');
});

test('hierarquia: tarefa → subtarefa → microtarefa, herdando a área', () => {
  const c = fresh();
  const t = c.createTask({ title: 'Estudar para a prova', area_id: 3 });
  const s = c.createTask({ title: 'Revisar capítulo 1', parent_id: t.id });
  const m = c.createTask({ title: 'Abrir o PDF', parent_id: s.id });
  assert.equal(s.granularity, 'subtask');
  assert.equal(m.granularity, 'micro');
  assert.equal(m.area_id, 3);
  assert.throws(() => c.createTask({ title: 'nível demais', parent_id: m.id }), /Microtarefas/);
  assert.deepEqual(c.getTask(m.id).ancestors.map((a) => a.id), [t.id, s.id]);
});

test('data planejada e prazo são independentes e validados', () => {
  const c = fresh();
  const t = c.createTask({ title: 'Trabalho', planned_date: '2026-10-27', due_date: '2026-10-30' });
  assert.equal(t.planned_date, '2026-10-27');
  assert.equal(t.due_date, '2026-10-30');
  assert.throws(() => c.createTask({ title: 'x', due_date: '30/10/2026' }), /AAAA-MM-DD/);
  assert.throws(() => c.createTask({ title: 'x', planned_date: '2026-02-30' }), /AAAA-MM-DD/);
});

test('concluir dá XP uma vez só; concluir de novo não duplica', () => {
  const c = fresh();
  const t = c.createTask({ title: 'Tarefa média', effort: 2 });
  const r1 = c.completeTask(t.id);
  assert.equal(r1.xp.amount, DEFAULT_RULES.xp_by_effort[2]);
  const r2 = c.completeTask(t.id);
  assert.equal(r2.already_done, true);
  assert.equal(r2.xp, null);
  assert.equal(c.totalXp(), 20);
  assert.equal(c.listLedger().length, 1);
});

test('reabrir estorna com lançamento explícito; concluir de novo volta ao mesmo saldo', () => {
  const c = fresh();
  const t = c.createTask({ title: 'T', effort: 3 });
  c.completeTask(t.id);
  const r = c.reopenTask(t.id);
  assert.equal(r.reversal.amount, -40);
  assert.equal(c.totalXp(), 0);
  assert.equal(c.reopenTask(t.id).already_pending, true); // reabrir de novo não estorna de novo
  c.completeTask(t.id);
  assert.equal(c.totalXp(), 40);
  const ledger = c.listLedger();
  assert.equal(ledger.length, 3);
  // mais recente primeiro: [nova conclusão, estorno, conclusão original]
  assert.deepEqual(ledger.map((e) => e.kind), ['task_completed', 'task_reopened', 'task_completed']);
  assert.equal(ledger[1].reverses_id, ledger[2].id);
});

test('livro de XP é somente-inclusão (banco recusa alterar ou apagar)', () => {
  const c = fresh();
  c.completeTask(c.createTask({ title: 'T' }).id);
  assert.throws(() => c.db.exec('UPDATE xp_ledger SET amount = 999'), /somente-inclusão/);
  assert.throws(() => c.db.exec('DELETE FROM xp_ledger'), /somente-inclusão/);
  assert.equal(c.totalXp(), 10);
});

test('subdivisões valem pouco e têm teto diário (anti "farm" de XP)', () => {
  const c = fresh();
  const parent = c.createTask({ title: 'Grande' });
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const s = c.createTask({ title: `passo ${i}`, parent_id: parent.id });
    total += c.completeTask(s.id).xp.amount;
  }
  assert.equal(total, DEFAULT_RULES.granular_daily_cap);
  const last = c.listLedger()[0];
  assert.equal(last.amount, 0);
  assert.match(last.note, /limite diário/);
});

test('tarefa com subdivisões pendentes exige confirmação; em cascata, filhos não ganham XP extra', () => {
  const c = fresh();
  const t = c.createTask({ title: 'Mãe', effort: 2 });
  c.createTask({ title: 'filho 1', parent_id: t.id });
  c.createTask({ title: 'filho 2', parent_id: t.id });
  assert.throws(() => c.completeTask(t.id), (e) => e.status === 409 && e.details.pending.length === 2);
  const r = c.completeTask(t.id, { cascade: true });
  assert.equal(r.xp.amount, 20);
  assert.equal(c.totalXp(), 20);
  assert.ok(r.task.children.every((ch) => ch.status === 'done'));
});

test('não é possível alterar status pela edição comum', () => {
  const c = fresh();
  const t = c.createTask({ title: 'T' });
  assert.throws(() => c.updateTask(t.id, { status: 'done' }), /ações próprias/);
});

test('cancelar não apaga e não dá XP; histórico registra tudo', () => {
  const c = fresh();
  const t = c.createTask({ title: 'Talvez' });
  c.updateTask(t.id, { title: 'Talvez não' });
  c.cancelTask(t.id);
  const full = c.getTask(t.id);
  assert.equal(full.status, 'cancelled');
  assert.deepEqual(full.history.map((h) => h.action), ['created', 'updated', 'cancelled']);
  assert.equal(full.history[1].details.title.de, 'Talvez');
  assert.equal(c.totalXp(), 0);
});

test('hábitos: marcar é idempotente; desmarcar estorna; futuro é recusado', () => {
  const c = fresh();
  const h = c.createHabit({ title: 'Ler as escrituras', area_id: 1 });
  c.checkHabit(h.id, today());
  assert.equal(c.checkHabit(h.id, today()).already, true);
  assert.equal(c.totalXp(), 5);
  c.uncheckHabit(h.id, today());
  assert.equal(c.totalXp(), 0);
  assert.throws(() => c.checkHabit(h.id, addDays(today(), 1)), /futuro/);
});

test('revisão semanal dá XP só na primeira vez', () => {
  const c = fresh();
  const a = c.saveReview({ wins: 'a' });
  const b = c.saveReview({ wins: 'b' });
  assert.equal(a.xp.amount, 30);
  assert.equal(b.xp, null);
  assert.equal(b.review.wins, 'b');
  assert.equal(c.totalXp(), 30);
});

test('ajuste manual exige motivo e fica no histórico', () => {
  const c = fresh();
  assert.throws(() => c.addAdjustment({ amount: -5 }), /motivo/);
  c.addAdjustment({ amount: -5, note: 'corrigindo teste' });
  assert.equal(c.totalXp(), -5);
});

test('níveis e títulos seguem a regra configurada', () => {
  const r = normalizeRules({});
  assert.equal(levelInfo(0, r).level, 1);
  assert.equal(levelInfo(99, r).level, 1);
  assert.equal(levelInfo(100, r).level, 2);
  assert.equal(levelInfo(300, r).level, 3);
  assert.equal(levelInfo(300, r).title, 'Praticante');
  assert.equal(levelInfo(250, r).xp_to_next, 50);
  assert.throws(() => normalizeRules({ xp_habit: -1 }));
});

test('alterar regras vale para os próximos lançamentos, sem mexer nos antigos', () => {
  const c = fresh();
  c.completeTask(c.createTask({ title: 'antes' }).id);
  c.setRules({ xp_by_effort: { 1: 15 } });
  c.completeTask(c.createTask({ title: 'depois' }).id);
  assert.deepEqual(c.listLedger().map((e) => e.amount), [15, 10]);
});

test('visão semanal: tarefas no dia certo, prioridades, atrasos e áreas', () => {
  const c = fresh();
  const t0 = today();
  const ws = weekStart(t0);
  c.createTask({ title: 'Hoje', planned_date: t0, area_id: 2, is_priority: true });
  c.createTask({ title: 'Só prazo', due_date: addDays(ws, 6) });
  c.createTask({ title: 'Atrasada', due_date: addDays(ws, -3) });
  c.createTask({ title: 'Semana passada', planned_date: addDays(ws, -2) });
  c.createTask({ title: 'Sem data' });
  const parent = c.createTask({ title: 'Com filhos', planned_date: t0 });
  c.createTask({ title: 'filho sem data', parent_id: parent.id });
  const o = c.overview(t0);
  const dayTitles = (d) => o.week.days.find((x) => x.date === d).tasks.map((t) => t.title);
  assert.ok(dayTitles(t0).includes('Hoje'));
  assert.ok(!o.week.days.some((d) => d.tasks.some((t) => t.title === 'filho sem data')), 'subdivisão sem data não aparece solta');
  assert.ok(dayTitles(addDays(ws, 6)).includes('Só prazo'));
  assert.deepEqual(o.priorities.map((t) => t.title), ['Hoje']);
  assert.deepEqual(o.overdue.map((t) => t.title), ['Atrasada']);
  assert.deepEqual(o.carried_over.map((t) => t.title), ['Semana passada']);
  assert.deepEqual(o.unscheduled.map((t) => t.title), ['Sem data']);
  assert.equal(o.areas.length, 7);
  assert.equal(o.week.days.find((d) => d.date === t0).tasks.find((t) => t.title === 'Com filhos').subtasks.total, 1);
});

test('áreas podem ser renomeadas sem mexer no código', () => {
  const c = fresh();
  c.updateArea(1, { name: 'Chamado no bispado' });
  assert.equal(c.getArea(1).name, 'Chamado no bispado');
  assert.equal(c.findArea('bispado').id, 1);
});

test('persistência: dados sobrevivem a fechar e reabrir o banco', () => {
  const file = path.join(tmpDir(), 'lifedash.db');
  let db = openDatabase(file);
  let c = createCore(db);
  const t = c.createTask({ title: 'Persistente', effort: 2 });
  c.completeTask(t.id);
  db.close();
  db = openDatabase(file);
  c = createCore(db);
  assert.equal(c.getTask(t.id).status, 'done');
  assert.equal(c.totalXp(), 20);
  assert.equal(c.listAreas().length, 7, 'reabrir não recria áreas');
  db.close();
});
