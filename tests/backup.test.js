import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tmpDir, makeVault } from './helpers.js';
import { openDatabase } from '../src/core/db.js';
import { createCore } from '../src/core/service.js';
import { createBackup, restoreBackup, verifyBackup, pruneAutoBackups, listBackups, backupVault, writeLock, lockFile } from '../src/backup/backup.js';

function setup() {
  const dataDir = tmpDir();
  const backupDir = path.join(dataDir, 'backups');
  const dbFile = path.join(dataDir, 'lifedash.db');
  return { dataDir, backupDir, dbFile };
}

test('restauração real: backup → alterações → restaura → volta exatamente ao estado do backup', () => {
  const { dataDir, backupDir, dbFile } = setup();
  let db = openDatabase(dbFile);
  let core = createCore(db);
  const t = core.createTask({ title: 'Antes do backup', effort: 2 });
  core.completeTask(t.id);
  const b = createBackup({ dbFile, backupDir, db });
  assert.equal(b.integrity, 'ok');
  assert.equal(b.xp_total, 20);
  assert.equal(b.counts.tasks, 1);

  // "desastre": mais dados e XP depois do backup
  core.createTask({ title: 'Depois do backup' });
  core.addAdjustment({ amount: 100, note: 'depois' });
  db.close();

  const r = restoreBackup({ file: b.path, dbFile, dataDir, backupDir });
  assert.equal(r.after.xp_total, 20);
  assert.ok(r.safety_copy && fs.existsSync(r.safety_copy), 'banco anterior guardado antes de restaurar');
  assert.equal(verifyBackup(r.safety_copy).xp_total, 120);

  db = openDatabase(dbFile);
  core = createCore(db);
  assert.deepEqual(core.listTasks({ status: 'all' }).map((x) => x.title), ['Antes do backup']);
  assert.equal(core.totalXp(), 20);
  db.close();
});

test('restauração é recusada com o painel aberto', () => {
  const { dataDir, backupDir, dbFile } = setup();
  const db = openDatabase(dbFile);
  const b = createBackup({ dbFile, backupDir, db });
  db.close();
  // simula outro processo vivo segurando a trava
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)']);
  fs.writeFileSync(lockFile(dataDir), String(child.pid));
  try {
    assert.throws(() => restoreBackup({ file: b.path, dbFile, dataDir, backupDir }), /painel está aberto/);
  } finally { child.kill(); }
  writeLock(dataDir); // trava do próprio processo não bloqueia
  assert.doesNotThrow(() => restoreBackup({ file: b.path, dbFile, dataDir, backupDir }));
});

test('arquivo corrompido é rejeitado antes de restaurar', () => {
  const { dataDir, backupDir, dbFile } = setup();
  const bad = path.join(dataDir, 'ruim.db');
  fs.writeFileSync(bad, 'isto não é um banco');
  assert.throws(() => restoreBackup({ file: bad, dbFile, dataDir, backupDir }));
  assert.ok(!fs.existsSync(dbFile), 'nada foi sobrescrito');
});

test('limpeza remove só backups automáticos antigos', () => {
  const { backupDir, dbFile } = setup();
  const db = openDatabase(dbFile);
  for (let i = 0; i < 4; i++) createBackup({ dbFile, backupDir, db, kind: 'auto' });
  createBackup({ dbFile, backupDir, db, kind: 'manual' });
  db.close();
  pruneAutoBackups(backupDir, 2);
  const files = listBackups(backupDir).map((b) => b.file);
  assert.equal(files.filter((f) => f.includes('-auto-')).length, 2);
  assert.equal(files.filter((f) => f.includes('-manual-')).length, 1);
});

test('cópia do vault inclui as notas', () => {
  const vault = makeVault();
  fs.mkdirSync(path.join(vault, 'ideias'));
  fs.writeFileSync(path.join(vault, 'ideias', 'A.md'), '# A');
  const { backupDir } = setup();
  const r = backupVault({ vaultPath: vault, backupDir });
  assert.ok(fs.existsSync(path.join(r.path, 'ideias', 'A.md')));
});
