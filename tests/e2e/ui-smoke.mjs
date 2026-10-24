// Teste de interface (opcional): abre o painel num navegador real e executa o fluxo principal.
// Requer Playwright instalado (npm i -D playwright && npx playwright install chromium).
// Uso: node tests/e2e/ui-smoke.mjs [pasta-para-screenshots]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('Playwright não instalado: teste de interface pulado.'); process.exit(0); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shots = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lifedash-ui-'));
fs.mkdirSync(path.join(tmp, 'vault', '.obsidian'), { recursive: true });
const PORT = 4400 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, LIFEDASH_SKIP_DOTENV: '1', PORT: String(PORT), DATA_DIR: path.join(tmp, 'data'), BACKUP_DIR: path.join(tmp, 'backups'), OBSIDIAN_VAULT_PATH: path.join(tmp, 'vault'), AUTO_BACKUP: 'false' };

function startServer() {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/main.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.includes('rodando')) resolve(p); });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (c) => reject(new Error(`servidor saiu (${c}): ${out}`)));
  });
}
const stop = (p) => new Promise((r) => { p.removeAllListeners('exit'); p.on('exit', r); p.kill('SIGINT'); });
const post = (u, b) => fetch(BASE + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const assert = (c, m) => { if (!c) throw new Error('FALHOU: ' + m); console.log('✔ ' + m); };

let server = await startServer();
const health = await fetch(BASE + '/api/health').then((r) => r.json());
const t0 = health.today;
const add = (d) => { const x = new Date(t0 + 'T12:00:00'); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };

// Dados de exemplo
const prova = await post('/api/tasks', { title: 'Estudar para a prova de Matemática Financeira', area: 'faculdade', planned_date: t0, due_date: add(3), is_priority: true, effort: 2 });
await post('/api/tasks', { title: 'Preparar mensagem para a reunião do bispado', area: 'igreja', planned_date: t0, is_priority: true });
await post('/api/tasks', { title: 'Gravar vídeo sobre reserva de emergência', area: 'empresa', planned_date: add(1), effort: 3 });
await post('/api/tasks', { title: 'Consertar a torneira do banheiro', area: 'casa', due_date: add(-1) });
await post('/api/tasks', { title: 'Passeio no parque em família', area: 'familia', planned_date: add(2) });
await post('/api/tasks', { title: 'Organizar ideias do app pessoal', area: 'projetos' });
await post('/api/habits', { title: 'Ler as escrituras', area_id: 1, target_per_week: 7 });
await post('/api/habits', { title: 'Caminhar 30 minutos', area_id: 7, target_per_week: 4 });

const browser = await chromium.launch();
const errors = [];
try {
  for (const vp of [{ name: 'desktop', width: 1366, height: 900 }, { name: 'iphone', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor || 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${vp.name}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${vp.name} console: ${m.text()}`); });
    await page.goto(BASE + '/');
    await page.waitForSelector('.xp-total');
    if (vp.name === 'desktop') {
      assert(await page.locator('text=Estudar para a prova').first().isVisible(), 'tarefa aparece na semana');
      const xpBefore = Number(await page.locator('.xp-total b').textContent());
      await page.locator(`li.task[data-id="${prova.id}"] .check`).first().click();
      await page.waitForFunction((b) => Number(document.querySelector('.xp-total b').textContent) > b, xpBefore);
      const xpAfter = Number(await page.locator('.xp-total b').textContent());
      assert(xpAfter === xpBefore + 20, `concluir tarefa média soma 20 XP na tela (${xpBefore} → ${xpAfter})`);
      // detalhe + dividir em passos
      await page.locator('.task-title', { hasText: 'Gravar vídeo' }).first().click();
      await page.waitForSelector('.modal');
      await page.locator('.modal summary', { hasText: 'Dividir' }).click();
      await page.locator('.modal textarea').last().fill('Escrever roteiro\nGravar\nEditar');
      await page.locator('.modal button', { hasText: 'Criar passos' }).click();
      await page.waitForFunction(() => document.querySelectorAll('.modal .task-list li').length === 3);
      assert(true, 'tarefa dividida em 3 passos pela janela de detalhe');
      if (shots) await page.screenshot({ path: path.join(shots, 'desktop-detalhe.png') });
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { state: 'detached' });
      await page.waitForTimeout(600); // espera a tela recarregar depois de fechar
      // quick add
      await page.fill('.quick-add input[type=text]', 'Responder e-mail da coordenação');
      await page.locator('.quick-add select').selectOption({ label: '🎓 Faculdade' });
      await page.locator('.quick-add button[type=submit]').click();
      await page.waitForSelector('text=Responder e-mail da coordenação');
      assert(true, 'adicionar tarefa rápida pela tela');
      // hábito de hoje
      await page.locator('.habit .dot.today').first().click();
      await page.waitForFunction(() => document.querySelector('.habit .dot.today.on'));
      assert(true, 'marcar hábito de hoje');
      await page.reload();
      await page.waitForSelector('.xp-total');
      if (shots) await page.screenshot({ path: path.join(shots, 'desktop-semana.png'), fullPage: true });
      for (const r of ['areas', 'area/3', 'habitos', 'revisao', 'progresso', 'ajustes']) {
        await page.goto(BASE + '/#/' + r);
        await page.waitForSelector('#app h1');
        if (shots) await page.screenshot({ path: path.join(shots, `desktop-${r.replace('/', '-')}.png`), fullPage: true });
      }
      assert(true, 'todas as telas abrem sem erro');
      // revisão semanal salva no Obsidian
      await page.goto(BASE + '/#/revisao');
      await page.waitForSelector('textarea[name=wins]');
      await page.fill('textarea[name=wins]', 'Estudei para a prova com antecedência.');
      await page.fill('textarea[name=next_focus]', 'Gravar dois vídeos.');
      await page.locator('button', { hasText: 'Concluir revisão' }).click();
      await page.waitForSelector('text=já registrada');
      const notes = fs.readdirSync(path.join(tmp, 'vault', 'desempenho'));
      assert(notes.some((n) => n.startsWith('Revisão semanal')), 'revisão semanal gravada no vault: ' + notes.join(', '));
    } else {
      if (shots) await page.screenshot({ path: path.join(shots, 'iphone-semana.png'), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert(!overflow, 'sem rolagem horizontal na largura de iPhone');
      await page.locator('.task-title').first().click();
      await page.waitForSelector('.modal');
      if (shots) await page.screenshot({ path: path.join(shots, 'iphone-detalhe.png') });
    }
    await ctx.close();
  }

  // Persistência: reinicia o servidor e confere que tudo continua lá.
  const before = await fetch(BASE + '/api/overview').then((r) => r.json());
  await stop(server);
  server = await startServer();
  const after = await fetch(BASE + '/api/overview').then((r) => r.json());
  assert(after.xp.total_xp === before.xp.total_xp && after.counts.done === before.counts.done && after.counts.planned === before.counts.planned,
    `dados e XP iguais depois de reiniciar (XP ${after.xp.total_xp}, ${after.counts.planned} tarefas na semana)`);
  assert(errors.length === 0, 'nenhum erro de JavaScript no navegador' + (errors.length ? ': ' + errors.join(' | ') : ''));
} finally {
  await browser.close();
  await stop(server);
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('\nTeste de interface concluído.');
