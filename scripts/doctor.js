// Diagnóstico: `npm run doctor`. Confere a configuração e diz o que falta, em português.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { loadConfig, dbFile, ROOT_DIR } from '../src/config.js';
import { Vault } from '../src/obsidian/vault.js';
import { isLoopback } from '../src/dashboard/server.js';
import { listBackups, serverRunning } from '../src/backup/backup.js';

const ok = (m) => console.log(`  ✔ ${m}`);
const warn = (m) => console.log(`  ⚠ ${m}`);
const bad = (m) => console.log(`  ✖ ${m}`);

console.log('\nDiagnóstico do Life Dashboard + Jarvis\n');
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj > 22 || (maj === 22 && min >= 13)) ok(`Node.js ${process.versions.node}`);
else bad(`Node.js ${process.versions.node}: é preciso 22.13 ou mais novo (recomendado: a versão LTS em nodejs.org).`);

if (fs.existsSync(path.join(ROOT_DIR, '.env'))) ok('Arquivo .env encontrado');
else warn('Arquivo .env não existe: usando valores padrão. Copie .env.example para .env para configurar.');

const c = loadConfig();
console.log('\nPainel');
ok(`Endereço: http://localhost:${c.port}`);
if (isLoopback(c.host)) ok('Acesso só deste computador (mais seguro).');
else if (c.accessToken.length >= 16) ok(`Acesso pela rede (${c.host}) com senha.`);
else bad('HOST aberto para a rede exige ACCESS_TOKEN com pelo menos 16 caracteres.');
ok(`Fuso: ${c.timezone} (agora: ${new Date().toLocaleString('pt-BR')})`);
fs.existsSync(dbFile(c)) ? ok(`Banco: ${dbFile(c)}`) : warn(`Banco ainda não criado (será criado no primeiro "npm start"): ${dbFile(c)}`);
const pid = serverRunning(c.dataDir);
pid ? ok(`Painel aberto agora (processo ${pid}).`) : warn('Painel não está aberto agora.');

console.log('\nBackup');
const backups = listBackups(c.backupDir);
if (backups.length) ok(`${backups.length} backup(s) em ${c.backupDir}. Mais recente: ${backups[0].modified.toLocaleString('pt-BR')}`);
else warn(`Nenhum backup ainda em ${c.backupDir}. Rode "npm run backup".`);
if (c.backupDir.startsWith(ROOT_DIR)) warn('Os backups estão no mesmo disco do projeto. Para proteger contra perda do computador, aponte BACKUP_DIR para uma pasta sincronizada (OneDrive, Google Drive, iCloud).');

console.log('\nObsidian');
const v = new Vault(c.vaultPath).status();
if (!v.ok) bad(`${v.reason} Veja docs/INTEGRATIONS.md.`);
else {
  ok(`Vault: ${v.path}`);
  v.obsidian_detected ? ok('Pasta .obsidian encontrada (é um vault do Obsidian).') : warn('Não achei .obsidian nesta pasta. Confirme se é o vault certo.');
  const missing = v.folders.filter((f) => !f.exists).map((f) => f.folder);
  missing.length ? warn(`Pastas que serão criadas quando necessário: ${missing.join(', ')}`) : ok('Pastas ideias/, projetos/, decisoes/, desempenho/, rotinas/ existem.');
}

console.log('\nJarvis');
c.jarvisReadonly ? warn('JARVIS_READONLY=true: o Jarvis só consulta, não grava.') : ok('Jarvis pode gravar (tarefas e notas, com validação).');
if (c.telegramToken) {
  c.telegramAllowedUsers.length ? ok(`Modo básico do Telegram configurado (${c.telegramAllowedUsers.length} usuário(s) autorizado(s)).`)
    : bad('JARVIS_TELEGRAM_BOT_TOKEN definido, mas JARVIS_TELEGRAM_ALLOWED_USERS vazio: o bot não vai iniciar.');
} else warn('Modo básico do Telegram desligado (normal se for usar o Hermes Agent).');
let hermes = false;
try { execSync('hermes --version', { stdio: 'pipe', timeout: 10000 }); hermes = true; } catch { /* não instalado */ }
hermes ? ok('Hermes Agent encontrado neste ambiente.') : warn('Hermes Agent não encontrado neste ambiente (opcional; veja docs/INTEGRATIONS.md).');
console.log(`\n  Comando MCP para o Hermes: node --disable-warning=ExperimentalWarning ${path.join(ROOT_DIR, 'src', 'jarvis', 'mcp-server.js')}\n`);
