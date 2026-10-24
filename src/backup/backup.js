// Backup e restauração do banco do Life Dashboard (e cópia opcional do vault).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION } from '../core/db.js';

const TABLES = ['areas', 'objectives', 'goals', 'projects', 'tasks', 'habits', 'habit_checks', 'xp_ledger', 'weekly_reviews', 'seasons', 'activity_log'];

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Cria um backup consistente. Funciona com o painel aberto (usa VACUUM INTO,
// que tira uma "foto" do banco sem interromper quem está usando).
export function createBackup({ dbFile, backupDir, db = null, kind = 'manual' }) {
  if (!db && !fs.existsSync(dbFile)) throw new Error(`Banco não encontrado: ${dbFile}`);
  fs.mkdirSync(backupDir, { recursive: true });
  let name = `lifedash-${kind}-${stamp()}.db`;
  let n = 1;
  while (fs.existsSync(path.join(backupDir, name))) name = `lifedash-${kind}-${stamp()}-${n++}.db`;
  const dest = path.join(backupDir, name);
  const conn = db || new DatabaseSync(dbFile);
  try {
    conn.prepare('VACUUM INTO ?').run(dest);
  } finally {
    if (!db) conn.close();
  }
  const info = verifyBackup(dest);
  const manifest = { file: name, created_at: new Date().toISOString(), kind, sha256: sha256(dest), ...info };
  fs.writeFileSync(dest.replace(/\.db$/, '.json'), JSON.stringify(manifest, null, 2));
  return { path: dest, ...manifest };
}

// Abre o arquivo em modo leitura e confere integridade, versão e contagens.
export function verifyBackup(file) {
  if (!fs.existsSync(file)) throw new Error(`Arquivo não encontrado: ${file}`);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') throw new Error(`Backup corrompido: ${integrity}`);
    const version = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;
    if (!version || version > SCHEMA_VERSION) throw new Error(`Versão do backup (${version}) incompatível com este programa (${SCHEMA_VERSION}).`);
    const counts = {};
    for (const t of TABLES) counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    const xp_total = db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM xp_ledger').get().s;
    return { schema_version: version, integrity, counts, xp_total };
  } finally {
    db.close();
  }
}

export function listBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((f) => /^lifedash-.*\.db$/.test(f))
    .map((f) => {
      const full = path.join(backupDir, f);
      return { file: f, path: full, size: fs.statSync(full).size, modified: fs.statSync(full).mtime };
    })
    .sort((a, b) => b.modified - a.modified);
}

// Remove só backups automáticos antigos; manuais e pré-restauração ficam.
export function pruneAutoBackups(backupDir, keep) {
  const autos = listBackups(backupDir).filter((b) => b.file.startsWith('lifedash-auto-'));
  const removed = [];
  for (const b of autos.slice(keep)) {
    fs.rmSync(b.path, { force: true });
    fs.rmSync(b.path.replace(/\.db$/, '.json'), { force: true });
    removed.push(b.file);
  }
  return removed;
}

export function lastAutoBackupAge(backupDir) {
  const last = listBackups(backupDir).find((b) => b.file.startsWith('lifedash-auto-'));
  return last ? Date.now() - last.modified.getTime() : Infinity;
}

// ---------- trava: impede restaurar com o painel aberto ----------
export function lockFile(dataDir) {
  return path.join(dataDir, 'server.pid');
}
export function writeLock(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(lockFile(dataDir), String(process.pid));
}
export function clearLock(dataDir) {
  try {
    if (fs.readFileSync(lockFile(dataDir), 'utf8').trim() === String(process.pid)) fs.rmSync(lockFile(dataDir));
  } catch { /* sem trava */ }
}
export function serverRunning(dataDir) {
  try {
    const pid = Number(fs.readFileSync(lockFile(dataDir), 'utf8').trim());
    if (!pid || pid === process.pid) return false;
    process.kill(pid, 0);
    return pid;
  } catch {
    return false;
  }
}

// Restaura um backup. Antes, guarda o banco atual como "pre-restore" para
// que a restauração também possa ser desfeita.
export function restoreBackup({ file, dbFile, dataDir, backupDir }) {
  const pid = serverRunning(dataDir);
  if (pid) throw new Error(`O painel está aberto (processo ${pid}). Feche-o (Ctrl+C no terminal) antes de restaurar.`);
  const info = verifyBackup(file);
  let safety = null;
  if (fs.existsSync(dbFile)) safety = createBackup({ dbFile, backupDir, kind: 'pre-restore' });
  for (const ext of ['-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const tmp = `${dbFile}.restoring`;
  fs.copyFileSync(file, tmp);
  fs.renameSync(tmp, dbFile);
  const after = verifyBackup(dbFile);
  return { restored_from: file, safety_copy: safety ? safety.path : null, before: info, after };
}

// Cópia simples do vault (arquivos Markdown e configurações do Obsidian).
export function backupVault({ vaultPath, backupDir }) {
  if (!vaultPath || !fs.existsSync(vaultPath)) throw new Error('Vault não configurado ou não encontrado (OBSIDIAN_VAULT_PATH).');
  const dest = path.join(backupDir, `vault-${stamp()}`);
  fs.cpSync(vaultPath, dest, {
    recursive: true,
    filter: (src) => !/[\\/](\.git|\.trash|node_modules)([\\/]|$)/.test(src),
  });
  let files = 0;
  const count = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) count(path.join(d, e.name)); else files++; } };
  count(dest);
  return { path: dest, files };
}
