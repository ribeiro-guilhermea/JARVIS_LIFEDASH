import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TZ = 'America/Sao_Paulo';
process.env.LIFEDASH_SKIP_DOTENV = '1';

export function tmpDir(prefix = 'lifedash-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function makeVault() {
  const dir = tmpDir('lifedash-vault-');
  fs.mkdirSync(path.join(dir, '.obsidian'));
  return dir;
}
