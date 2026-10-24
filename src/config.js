// Configuração central. Lê o arquivo .env (se existir) e variáveis de ambiente.
// Nenhum caminho pessoal ou credencial fica escrito no código.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let envLoaded = false;
function loadDotEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const file = path.join(ROOT_DIR, '.env');
  if (process.env.LIFEDASH_SKIP_DOTENV !== '1' && fs.existsSync(file)) {
    process.loadEnvFile(file);
  }
}

function bool(v, def) {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'sim', 'yes', 'on'].includes(String(v).trim().toLowerCase());
}

function resolveDir(v, def) {
  const raw = v && v.trim() ? v.trim() : def;
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT_DIR, raw);
}

export function loadConfig(overrides = {}) {
  loadDotEnv();
  const env = { ...process.env, ...overrides };
  const timezone = env.TIMEZONE || 'America/Sao_Paulo';
  // O fuso precisa valer para todo o processo (datas de "hoje", semanas, prazos).
  process.env.TZ = timezone;
  const port = Number(env.PORT || 4310);
  return {
    port,
    host: env.HOST || '127.0.0.1',
    accessToken: (env.ACCESS_TOKEN || '').trim(),
    timezone,
    dataDir: resolveDir(env.DATA_DIR, './data'),
    backupDir: resolveDir(env.BACKUP_DIR, './backups'),
    autoBackup: bool(env.AUTO_BACKUP, true),
    backupKeep: Math.max(1, Number(env.BACKUP_KEEP || 30)),
    vaultPath: (env.OBSIDIAN_VAULT_PATH || '').trim(),
    jarvisApiUrl: (env.JARVIS_API_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
    jarvisReadonly: bool(env.JARVIS_READONLY, false),
    telegramToken: (env.JARVIS_TELEGRAM_BOT_TOKEN || '').trim(),
    telegramAllowedUsers: (env.JARVIS_TELEGRAM_ALLOWED_USERS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function dbFile(config) {
  return path.join(config.dataDir, 'lifedash.db');
}
