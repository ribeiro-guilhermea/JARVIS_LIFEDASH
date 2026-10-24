// Linha de comando de backup:
//   npm run backup                 -> backup do banco
//   npm run backup:vault           -> backup do banco + cópia do vault
//   npm run backups                -> lista backups
//   npm run restore -- <arquivo>   -> restaura (pede confirmação)
import path from 'node:path';
import readline from 'node:readline/promises';
import { loadConfig, dbFile } from '../config.js';
import { createBackup, listBackups, restoreBackup, backupVault, verifyBackup } from './backup.js';

const config = loadConfig();
const [cmd, ...args] = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));

function fmtCounts(c) {
  return `${c.tasks} tarefas, ${c.xp_ledger} lançamentos de XP, ${c.habits} hábitos, ${c.weekly_reviews} revisões`;
}

try {
  if (cmd === 'backup') {
    const r = createBackup({ dbFile: dbFile(config), backupDir: config.backupDir });
    console.log(`✔ Backup criado: ${r.path}`);
    console.log(`  Integridade: ${r.integrity} | ${fmtCounts(r.counts)} | XP total: ${r.xp_total}`);
    if (flags.has('--with-vault')) {
      const v = backupVault({ vaultPath: config.vaultPath, backupDir: config.backupDir });
      console.log(`✔ Vault copiado: ${v.path} (${v.files} arquivos)`);
    }
  } else if (cmd === 'list') {
    const list = listBackups(config.backupDir);
    if (!list.length) console.log(`Nenhum backup em ${config.backupDir}`);
    for (const b of list) console.log(`${b.modified.toLocaleString('pt-BR')}  ${(b.size / 1024).toFixed(0).padStart(6)} KB  ${b.file}`);
  } else if (cmd === 'verify') {
    const r = verifyBackup(path.resolve(positional[0] || ''));
    console.log(`✔ Integridade: ${r.integrity} | versão ${r.schema_version} | ${fmtCounts(r.counts)} | XP total: ${r.xp_total}`);
  } else if (cmd === 'restore') {
    if (!positional[0]) throw new Error('Informe o arquivo: npm run restore -- backups/lifedash-manual-AAAA-MM-DD_HHMMSS.db');
    const file = path.resolve(positional[0].includes(path.sep) || positional[0].includes('/') ? positional[0] : path.join(config.backupDir, positional[0]));
    const info = verifyBackup(file);
    console.log(`Backup: ${file}\n  ${fmtCounts(info.counts)} | XP total: ${info.xp_total}`);
    console.log('O banco atual será substituído (uma cópia de segurança "pre-restore" é feita antes).');
    if (!flags.has('--yes')) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = await rl.question('Digite RESTAURAR para continuar: ');
      rl.close();
      if (ans.trim().toUpperCase() !== 'RESTAURAR') { console.log('Cancelado.'); process.exit(1); }
    }
    const r = restoreBackup({ file, dbFile: dbFile(config), dataDir: config.dataDir, backupDir: config.backupDir });
    console.log(`✔ Restaurado. ${fmtCounts(r.after.counts)} | XP total: ${r.after.xp_total}`);
    if (r.safety_copy) console.log(`  Banco anterior guardado em: ${r.safety_copy}`);
  } else {
    console.log('Uso: backup [--with-vault] | list | verify <arquivo> | restore <arquivo> [--yes]');
    process.exit(1);
  }
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exit(1);
}
