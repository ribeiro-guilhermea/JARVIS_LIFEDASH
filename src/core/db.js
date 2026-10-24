// Banco de dados SQLite (arquivo único em DATA_DIR/lifedash.db), usando o
// módulo node:sqlite que já vem com o Node.js. Nenhuma dependência externa.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nowISO } from './dates.js';
import { DEFAULT_RULES } from './rules.js';

export const SCHEMA_VERSION = 1;

const MIGRATIONS = {
  1: `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE areas (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#6b7280',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE objectives (
    id INTEGER PRIMARY KEY,
    area_id INTEGER NOT NULL REFERENCES areas(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done','dropped')),
    note_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE goals (
    id INTEGER PRIMARY KEY,
    area_id INTEGER NOT NULL REFERENCES areas(id),
    objective_id INTEGER REFERENCES objectives(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    target_date TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done','dropped')),
    note_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    area_id INTEGER NOT NULL REFERENCES areas(id),
    goal_id INTEGER REFERENCES goals(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','done','dropped')),
    note_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Tarefas, subtarefas e microtarefas são a mesma entidade (parent_id + granularity).
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER REFERENCES tasks(id),
    area_id INTEGER REFERENCES areas(id),
    goal_id INTEGER REFERENCES goals(id),
    project_id INTEGER REFERENCES projects(id),
    title TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    granularity TEXT NOT NULL DEFAULT 'task' CHECK (granularity IN ('task','subtask','micro')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
    is_priority INTEGER NOT NULL DEFAULT 0 CHECK (is_priority IN (0,1)),
    effort INTEGER NOT NULL DEFAULT 1 CHECK (effort IN (1,2,3)),
    planned_date TEXT,
    due_date TEXT,
    completed_at TEXT,
    source TEXT NOT NULL DEFAULT 'dashboard',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_tasks_status ON tasks(status);
  CREATE INDEX idx_tasks_planned ON tasks(planned_date);
  CREATE INDEX idx_tasks_due ON tasks(due_date);
  CREATE INDEX idx_tasks_parent ON tasks(parent_id);

  CREATE TABLE habits (
    id INTEGER PRIMARY KEY,
    area_id INTEGER REFERENCES areas(id),
    title TEXT NOT NULL,
    target_per_week INTEGER NOT NULL DEFAULT 7 CHECK (target_per_week BETWEEN 1 AND 7),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE habit_checks (
    id INTEGER PRIMARY KEY,
    habit_id INTEGER NOT NULL REFERENCES habits(id),
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (habit_id, date)
  );

  -- Livro-razão de XP: somente inclusão. Correções são novos lançamentos.
  CREATE TABLE xp_ledger (
    id INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    amount INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('task_completed','task_reopened','habit_checked','habit_unchecked','review_completed','adjustment')),
    category TEXT NOT NULL CHECK (category IN ('task','granular','habit','review','adjustment')),
    task_id INTEGER REFERENCES tasks(id),
    habit_id INTEGER REFERENCES habits(id),
    habit_date TEXT,
    review_id INTEGER REFERENCES weekly_reviews(id),
    reverses_id INTEGER UNIQUE REFERENCES xp_ledger(id),
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_xp_task ON xp_ledger(task_id);
  CREATE INDEX idx_xp_created ON xp_ledger(created_at);

  CREATE TRIGGER xp_ledger_no_update BEFORE UPDATE ON xp_ledger
  BEGIN SELECT RAISE(ABORT, 'xp_ledger é somente-inclusão: registre um ajuste em vez de alterar'); END;
  CREATE TRIGGER xp_ledger_no_delete BEFORE DELETE ON xp_ledger
  BEGIN SELECT RAISE(ABORT, 'xp_ledger é somente-inclusão: registre um ajuste em vez de apagar'); END;

  CREATE TABLE weekly_reviews (
    id INTEGER PRIMARY KEY,
    week_start TEXT NOT NULL UNIQUE,
    wins TEXT NOT NULL DEFAULT '',
    difficulties TEXT NOT NULL DEFAULT '',
    lessons TEXT NOT NULL DEFAULT '',
    next_focus TEXT NOT NULL DEFAULT '',
    snapshot TEXT NOT NULL DEFAULT '{}',
    note_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE seasons (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    xp_goal INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  -- Histórico de alterações (quem/quando/o quê) para auditoria.
  CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id INTEGER,
    action TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'dashboard',
    details TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX idx_activity_entity ON activity_log(entity, entity_id);
  `,
};

export const DEFAULT_AREAS = [
  { slug: 'igreja', name: 'Igreja e chamado', icon: '⛪', color: '#7c6fd6' },
  { slug: 'familia', name: 'Família', icon: '🏡', color: '#e07a5f' },
  { slug: 'faculdade', name: 'Faculdade', icon: '🎓', color: '#3d85c6' },
  { slug: 'empresa', name: 'Empresa e trabalho', icon: '💼', color: '#2a9d8f' },
  { slug: 'projetos', name: 'Projetos pessoais', icon: '🚀', color: '#d4a017' },
  { slug: 'casa', name: 'Casa', icon: '🛠️', color: '#8d6e63' },
  { slug: 'saude', name: 'Saúde', icon: '💪', color: '#4caf50' },
];

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
  const current = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v || 0;
  for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(v, nowISO());
      if (v === 1) seed(db);
    });
  }
}

function seed(db) {
  const now = nowISO();
  const ins = db.prepare(
    'INSERT INTO areas (slug, name, icon, color, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
  );
  DEFAULT_AREAS.forEach((a, i) => ins.run(a.slug, a.name, a.icon, a.color, i + 1, now, now));
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('rules', JSON.stringify(DEFAULT_RULES));
}

// Executa fn dentro de uma transação. Suporta chamadas aninhadas (savepoints).
let depth = new WeakMap();
export function transaction(db, fn) {
  const d = depth.get(db) || 0;
  const sp = `sp_${d}`;
  db.exec(d === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth.set(db, d + 1);
  try {
    const result = fn();
    db.exec(d === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return result;
  } catch (err) {
    db.exec(d === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw err;
  } finally {
    depth.set(db, d);
  }
}

// node:sqlite devolve objetos sem protótipo; convertemos para objetos comuns.
export const plain = (row) => (row ? { ...row } : row);
export const plainAll = (rows) => rows.map((r) => ({ ...r }));
