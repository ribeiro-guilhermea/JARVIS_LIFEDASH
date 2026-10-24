import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeVault } from './helpers.js';
import { Vault, parseNote } from '../src/obsidian/vault.js';

test('vault não configurado informa o motivo, sem fingir que funciona', () => {
  assert.equal(new Vault('').status().ok, false);
  const st = new Vault('/caminho/que/nao/existe').status();
  assert.equal(st.ok, false);
  assert.throws(() => new Vault('').search('x'), (e) => e.status === 503);
});

test('cria nota com frontmatter na pasta certa e lê de volta', () => {
  const dir = makeVault();
  const v = new Vault(dir);
  const n = v.createNote({ type: 'ideia', title: 'Curso de orçamento familiar', body: 'Minicurso para casais.', tags: ['sterling', '#finanças'] });
  assert.equal(n.path, 'ideias/Curso de orçamento familiar.md');
  assert.ok(fs.existsSync(path.join(dir, 'ideias', 'Curso de orçamento familiar.md')));
  assert.equal(n.meta.tipo, 'ideia');
  assert.equal(n.meta.status, 'aberta');
  assert.deepEqual(n.meta.tags, ['sterling', 'finanças']);
  assert.match(n.body, /Minicurso para casais/);
});

test('recusa duplicar nota com o mesmo título e aponta a existente', () => {
  const v = new Vault(makeVault());
  v.createNote({ type: 'decisao', title: 'Usar SQLite', body: 'x' });
  assert.throws(() => v.createNote({ type: 'decisao', title: 'usar sqlite', body: 'y' }),
    (e) => e.status === 409 && e.details.existing_path === 'decisoes/Usar SQLite.md');
});

test('busca ignora acentos, aceita partes de palavras e ordena por relevância', () => {
  const v = new Vault(makeVault());
  v.createNote({ type: 'decisao', title: 'Decisão sobre o banco de dados', body: 'Escolhemos SQLite pela simplicidade.' });
  v.createNote({ type: 'ideia', title: 'Ideia de vídeo', body: 'Falar sobre decisões financeiras do casal.' });
  v.createNote({ type: 'ideia', title: 'Receita de bolo', body: 'Farinha e ovos.' });
  const r = v.search('decisoes');
  assert.equal(r.length, 2);
  assert.equal(r[0].title, 'Decisão sobre o banco de dados');
  assert.equal(v.search('sqlite simplicidade')[0].path, 'decisoes/Decisão sobre o banco de dados.md');
  assert.equal(v.search('decis', { type: 'ideia' }).length, 1);
  assert.equal(v.search('inexistente').length, 0);
});

test('acrescentar nunca apaga: guarda versão anterior e adiciona seção datada', () => {
  const dir = makeVault();
  const v = new Vault(dir);
  const n = v.createNote({ type: 'projeto', title: 'App pessoal', body: 'Primeira versão.' });
  const after = v.appendToNote(n.path, { text: 'Decidi usar Node.', status: 'em andamento', tags: ['dev'] });
  assert.match(after.body, /Primeira versão\./);
  assert.match(after.body, /## Atualização \d{4}-\d{2}-\d{2} \d{2}:\d{2}\n\nDecidi usar Node\./);
  assert.equal(after.meta.status, 'em andamento');
  assert.deepEqual(after.meta.tags, ['dev']);
  const hist = fs.readdirSync(path.join(dir, '.jarvis', 'historico', 'projetos'));
  assert.equal(hist.length, 1);
  assert.ok(!v.search('Decidi').some((r) => r.path.startsWith('.jarvis')), 'histórico oculto não aparece nas buscas');
});

test('relacionar notas é bidirecional e idempotente', () => {
  const v = new Vault(makeVault());
  const a = v.createNote({ type: 'ideia', title: 'Ideia A', body: 'a' });
  const b = v.createNote({ type: 'projeto', title: 'Projeto B', body: 'b' });
  const r1 = v.linkNotes(a.path, b.path);
  assert.deepEqual(r1.changed.sort(), [a.path, b.path].sort());
  assert.deepEqual(v.linkNotes(a.path, b.path).changed, []);
  assert.deepEqual(v.readNote(a.path).links, ['Projeto B']);
  assert.deepEqual(v.readNote(a.path).backlinks.map((x) => x.path), [b.path]);
  const c = v.createNote({ type: 'ideia', title: 'Ideia C', body: 'c' });
  v.linkNotes(a.path, c.path);
  const body = v.readNote(a.path).body;
  assert.equal((body.match(/## Relacionadas/g) || []).length, 1, 'reaproveita a seção existente');
  assert.match(body, /- \[\[Projeto B\]\]\n- \[\[Ideia C\]\]/);
});

test('bloqueia caminhos fora do vault e gravação fora das pastas permitidas', () => {
  const dir = makeVault();
  const v = new Vault(dir);
  fs.writeFileSync(path.join(dir, 'Diário.md'), '# Diário\nprivado');
  assert.throws(() => v.readNote('../segredo'), /inválido/);
  assert.throws(() => v.readNote('.obsidian/app'), /inválido/);
  assert.equal(v.readNote('Diário').title, 'Diário', 'pode ler notas do vault');
  assert.throws(() => v.appendToNote('Diário.md', { text: 'x' }), /só grava/);
  assert.throws(() => v.createNote({ type: 'diario', title: 'x' }), /Tipo/);
});

test('notas escritas à mão com YAML complexo não têm o cabeçalho reescrito', () => {
  const dir = makeVault();
  const v = new Vault(dir);
  fs.mkdirSync(path.join(dir, 'ideias'));
  const raw = '---\ntitulo: Manual\nextra:\n  aninhado: valor\n---\n# Manual\n\ntexto\n';
  fs.writeFileSync(path.join(dir, 'ideias', 'Manual.md'), raw);
  assert.equal(parseNote(raw).metaParseable, false);
  v.appendToNote('ideias/Manual.md', { text: 'novo' });
  const out = fs.readFileSync(path.join(dir, 'ideias', 'Manual.md'), 'utf8');
  assert.ok(out.startsWith('---\ntitulo: Manual\nextra:\n  aninhado: valor\n---\n'));
  assert.match(out, /novo\n$/);
});
