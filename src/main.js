// Ponto de entrada: `npm start`.
// Sobe o Life Dashboard (interface + API), o backup automático e, se configurado,
// o modo básico do Jarvis no Telegram. Tudo num único processo.
import os from 'node:os';
import { loadConfig, dbFile } from './config.js';
import { openDatabase } from './core/db.js';
import { createCore } from './core/service.js';
import { Vault } from './obsidian/vault.js';
import { createServer, isLoopback, VERSION } from './dashboard/server.js';
import { createBackup, pruneAutoBackups, lastAutoBackupAge, writeLock, clearLock, serverRunning } from './backup/backup.js';
import { startTelegramBot } from './jarvis/telegram-bot.js';

const config = loadConfig();

if (!isLoopback(config.host) && !config.accessToken) {
  console.error('✖ HOST está aberto para a rede, mas ACCESS_TOKEN está vazio.');
  console.error('  Defina uma senha longa em ACCESS_TOKEN no arquivo .env, ou use HOST=127.0.0.1.');
  process.exit(1);
}
const running = serverRunning(config.dataDir);
if (running) {
  console.error(`✖ O painel já parece estar aberto (processo ${running}). Feche-o antes de abrir outro.`);
  process.exit(1);
}

const db = openDatabase(dbFile(config));
const core = createCore(db);
const vault = new Vault(config.vaultPath);
const server = createServer({ config, core, vault });

function autoBackup() {
  if (!config.autoBackup) return;
  try {
    if (lastAutoBackupAge(config.backupDir) < 20 * 3600 * 1000) return;
    const r = createBackup({ dbFile: dbFile(config), backupDir: config.backupDir, db, kind: 'auto' });
    pruneAutoBackups(config.backupDir, config.backupKeep);
    console.log(`[backup] automático criado: ${r.file}`);
  } catch (err) {
    console.error(`[backup] falhou: ${err.message}`);
  }
}

server.listen(config.port, config.host, () => {
  writeLock(config.dataDir);
  console.log(`\nLife Dashboard ${VERSION} rodando.`);
  console.log(`  Neste computador: http://localhost:${config.port}`);
  if (!isLoopback(config.host)) {
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    for (const ip of ips) console.log(`  Na rede de casa:  http://${ip}:${config.port}  (pede a senha ACCESS_TOKEN)`);
  } else {
    console.log('  Acesso restrito a este computador (HOST=127.0.0.1).');
  }
  console.log(`  Banco de dados:   ${dbFile(config)}`);
  const vs = vault.status();
  console.log(`  Obsidian:         ${vs.ok ? vs.path : `não conectado (${vs.reason})`}`);
  autoBackup();
  setInterval(autoBackup, 3600 * 1000).unref();
  if (config.telegramToken) {
    startTelegramBot({ config, core, vault }).catch((err) => console.error(`[telegram] ${err.message}`));
  }
  console.log('\nPara encerrar: Ctrl+C\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`✖ A porta ${config.port} já está em uso. Feche o outro programa ou mude PORT no .env.`);
  else console.error(err);
  process.exit(1);
});

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  console.log('\nEncerrando...');
  server.close();
  try { db.close(); } catch { /* já fechado */ }
  clearLock(config.dataDir);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
