// Testa a API HTTP de ponta a ponta (servidor real numa porta livre),
// o servidor MCP do Jarvis falando com essa API, e as proteções de acesso.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import http from 'node:http';
import { tmpDir, makeVault } from './helpers.js';
import { openDatabase } from '../src/core/db.js';
import { createCore } from '../src/core/service.js';
import { Vault } from '../src/obsidian/vault.js';
import { createServer } from '../src/dashboard/server.js';

function start(extraConfig = {}) {
  const dir = tmpDir();
  const vaultDir = makeVault();
  const config = { timezone: 'America/Sao_Paulo', accessToken: '', backupDir: path.join(dir, 'backups'), dataDir: dir, ...extraConfig };
  const core = createCore(openDatabase(path.join(dir, 'lifedash.db')));
  const server = createServer({ config, core, vault: new Vault(vaultDir) });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://localhost:${server.address().port}`;
    resolve({ server, base, core, vaultDir, config });
  }));
}

function client(base, token) {
  return (method, url, body, headers = {}) => fetch(base + url, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
}

let app;
let call;
before(async () => { app = await start(); call = client(app.base); });
after(() => app.server.close());

test('interface e saúde respondem', async () => {
  const html = await fetch(app.base + '/').then((r) => r.text());
  assert.match(html, /Life Dashboard/);
  const h = await call('GET', '/api/health');
  assert.equal(h.data.ok, true);
  assert.equal(h.data.vault.ok, true);
  assert.equal((await fetch(app.base + '/../package.json')).status, 404);
});

test('fluxo de tarefa pela API: criar por nome de área, concluir, XP, visão semanal', async () => {
  const c = await call('POST', '/api/tasks', { title: 'Preparar aula', area: 'igreja', planned_date: (await call('GET', '/api/health')).data.today, effort: 2 });
  assert.equal(c.status, 200);
  assert.equal(c.data.area_name, 'Igreja e chamado');
  const done = await call('POST', `/api/tasks/${c.data.id}/complete`, {});
  assert.equal(done.data.xp.amount, 20);
  const again = await call('POST', `/api/tasks/${c.data.id}/complete`, {});
  assert.equal(again.data.already_done, true);
  const ov = await call('GET', '/api/overview');
  assert.equal(ov.data.xp.total_xp, 20);
  assert.ok(ov.data.week.days.some((d) => d.tasks.some((t) => t.id === c.data.id && t.status === 'done')));
});

test('erros de validação voltam como mensagens claras', async () => {
  assert.equal((await call('POST', '/api/tasks', { title: '' })).status, 400);
  assert.equal((await call('POST', '/api/tasks', { title: 'x', due_date: 'amanhã' })).status, 400);
  assert.equal((await call('GET', '/api/tasks/99999')).status, 404);
  const amb = await call('POST', '/api/tasks', { title: 'x', area: 'a' });
  assert.equal(amb.status, 400);
  assert.match(amb.data.error, /ambígua/);
});

test('proteções: exige JSON, bloqueia outra origem e outro host', async () => {
  const r1 = await fetch(app.base + '/api/tasks', { method: 'POST', body: '{"title":"x"}', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(r1.status, 415);
  const r2 = await call('POST', '/api/tasks', { title: 'x' }, { Origin: 'http://site-malicioso.com' });
  assert.equal(r2.status, 403);
  // fetch não deixa trocar o Host; http.request deixa (simula "DNS rebinding")
  const status = await new Promise((resolve, reject) => {
    const u = new URL(app.base);
    http.get({ host: '127.0.0.1', port: u.port, path: '/api/overview', headers: { Host: 'malicioso.com' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(status, 403);
});

test('com ACCESS_TOKEN, a API exige a senha', async () => {
  const secured = await start({ accessToken: 'senha-longa-de-teste' });
  try {
    assert.equal((await client(secured.base)('GET', '/api/overview')).status, 401);
    assert.equal((await client(secured.base, 'errada')('GET', '/api/overview')).status, 401);
    assert.equal((await client(secured.base, 'senha-longa-de-teste')('GET', '/api/overview')).status, 200);
    assert.equal((await client(secured.base)('GET', '/api/health')).status, 200, 'health continua aberto para a tela de login');
  } finally { secured.server.close(); }
});

test('notas pela API e revisão semanal salva no Obsidian', async () => {
  const n = await call('POST', '/api/notes', { type: 'ideia', title: 'Ideia via API', body: 'texto' });
  assert.equal(n.status, 200);
  assert.ok(fs.existsSync(path.join(app.vaultDir, 'ideias', 'Ideia via API.md')));
  const s = await call('GET', '/api/notes/search?q=ideia%20api');
  assert.equal(s.data[0].path, 'ideias/Ideia via API.md');
  const rev = await call('POST', '/api/reviews', { wins: 'Consegui', save_to_obsidian: true });
  assert.equal(rev.status, 200);
  assert.match(rev.data.note.path, /^desempenho\/Revisão semanal \d{4}-W\d{2}\.md$/);
  const rev2 = await call('POST', '/api/reviews', { wins: 'Atualizado', save_to_obsidian: true });
  assert.equal(rev2.data.xp, null, 'revisão atualizada não dá XP de novo');
  assert.equal(fs.readdirSync(path.join(app.vaultDir, 'desempenho')).length, 1, 'não duplica a nota da revisão');
});

test('backup pela API cria arquivo verificado', async () => {
  const r = await call('POST', '/api/backups', {});
  assert.equal(r.data.integrity, 'ok');
  assert.ok(fs.existsSync(r.data.path));
});

// ---------- servidor MCP (Jarvis) ----------
function mcp(base, env = {}) {
  const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/jarvis/mcp-server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, LIFEDASH_SKIP_DOTENV: '1', JARVIS_API_URL: base, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  readline.createInterface({ input: proc.stdout }).on('line', (l) => {
    const m = JSON.parse(l);
    pending.get(m.id)?.(m);
  });
  let id = 0;
  const req = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
  });
  const tool = async (name, args) => {
    const r = await req('tools/call', { name, arguments: args });
    return { error: r.result.isError, text: r.result.content[0].text, json: (() => { try { return JSON.parse(r.result.content[0].text); } catch { return null; } })() };
  };
  return { req, tool, close: () => proc.kill() };
}

test('Jarvis (MCP): protocolo, ferramentas e ações reais no painel', async () => {
  const j = mcp(app.base);
  try {
    const init = await j.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.match(init.result.instructions, /Nunca invente/);
    const tools = (await j.req('tools/list', {})).result.tools.map((t) => t.name);
    for (const t of ['painel_semana', 'criar_tarefa', 'concluir_tarefa', 'notas_criar', 'notas_buscar', 'revisao_semanal', 'contexto_projeto']) assert.ok(tools.includes(t), t);
    assert.ok(!tools.some((t) => /apagar|excluir|delete/.test(t)), 'não existe ferramenta de exclusão');

    const created = await j.tool('criar_tarefa', { titulo: 'Tarefa do Jarvis', area: 'Saúde', prioridade: true });
    assert.equal(created.json.criada.area, 'Saúde');
    const id = created.json.criada.id;
    const week = await j.tool('painel_semana', {});
    assert.ok(week.json.prioridades.some((t) => t.id === id), 'consulta dados reais do painel');
    const done = await j.tool('concluir_tarefa', { id });
    assert.equal(done.json.xp_ganho, 10);
    const again = await j.tool('concluir_tarefa', { id });
    assert.match(again.json.aviso, /já estava concluída/);
    const task = app.core.getTask(id);
    assert.equal(task.source, 'jarvis');
    assert.equal(task.history.find((h) => h.action === 'completed').source, 'jarvis');

    const note = await j.tool('notas_criar', { tipo: 'decisao', titulo: 'Decisão do Jarvis', conteudo: 'Usar MCP.' });
    assert.equal(note.json.criada, 'decisoes/Decisão do Jarvis.md');
    const dup = await j.tool('notas_criar', { tipo: 'decisao', titulo: 'Decisão do Jarvis', conteudo: 'x' });
    assert.equal(dup.error, true);
    assert.match(dup.text, /Já existe/);
    const found = await j.tool('notas_buscar', { termos: 'decisao jarvis' });
    assert.equal(found.json[0].path, 'decisoes/Decisão do Jarvis.md');

    const bad = await j.tool('criar_tarefa', { titulo: 'x', data_planejada: 'quinta' });
    assert.equal(bad.error, true, 'data fora do formato é recusada pela validação do painel');
  } finally { j.close(); }
});

test('Jarvis (MCP): modo somente leitura esconde e bloqueia gravações', async () => {
  const j = mcp(app.base, { JARVIS_READONLY: 'true' });
  try {
    await j.req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    const tools = (await j.req('tools/list', {})).result.tools.map((t) => t.name);
    assert.ok(!tools.includes('criar_tarefa'));
    const r = await j.tool('criar_tarefa', { titulo: 'x' });
    assert.equal(r.error, true);
    assert.match(r.text, /somente leitura/);
  } finally { j.close(); }
});

test('Jarvis (MCP): painel fechado gera erro claro, não dado inventado', async () => {
  const j = mcp('http://127.0.0.1:1');
  try {
    const r = await j.tool('painel_semana', {});
    assert.equal(r.error, true);
    assert.match(r.text, /não está respondendo/);
  } finally { j.close(); }
});
