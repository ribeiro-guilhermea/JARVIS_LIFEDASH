import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeVault } from './helpers.js';
import { openDatabase } from '../src/core/db.js';
import { createCore } from '../src/core/service.js';
import { Vault } from '../src/obsidian/vault.js';
import { createHandler } from '../src/jarvis/telegram-bot.js';
import { addDays, today } from '../src/core/dates.js';

function setup() {
  const core = createCore(openDatabase(':memory:'));
  const vault = new Vault(makeVault());
  return { core, vault, say: createHandler({ core, vault }) };
}

test('/tarefa cria com data e área; data ambígua não grava', () => {
  const { core, say } = setup();
  const r = say('/tarefa !Estudar para a prova | amanhã | faculdade');
  assert.match(r, /Tarefa criada/);
  const [t] = core.listTasks();
  assert.equal(t.planned_date, addDays(today(), 1));
  assert.equal(t.area_name, 'Faculdade');
  assert.equal(t.is_priority, true);
  assert.equal(t.source, 'telegram');
  assert.match(say('/tarefa Algo | talvez um dia'), /Não gravei nada/);
  assert.equal(core.listTasks().length, 1);
});

test('/feito com texto pede confirmação; com número conclui uma vez', () => {
  const { core, say } = setup();
  core.createTask({ title: 'Ligar para o dentista' });
  core.createTask({ title: 'Ligar para a escola' });
  assert.match(say('/feito ligar'), /Qual delas/);
  assert.match(say('/feito dentista'), /para confirmar, envie \/feito 1/i);
  assert.equal(core.totalXp(), 0, 'nada concluído sem confirmação');
  assert.match(say('/feito 1'), /\+10 XP/);
  assert.match(say('/feito 1'), /já estava concluída/);
  assert.equal(core.totalXp(), 10);
});

test('/ideia grava no Obsidian e /buscar encontra', () => {
  const { say } = setup();
  assert.match(say('/ideia Planilha de orçamento | modelo simples para casais'), /ideias\/Planilha de orçamento\.md/);
  assert.match(say('/buscar orcamento'), /Planilha de orçamento/);
  assert.match(say('/ideia Planilha de orçamento | incluir reserva'), /acrescentei/);
  assert.match(say('/nota ideias/Planilha de orçamento'), /incluir reserva/);
});

test('comandos de consulta respondem com dados reais', () => {
  const { core, say } = setup();
  core.createTask({ title: 'Prioridade real', is_priority: true, planned_date: today() });
  assert.match(say('/semana'), /Prioridade real/);
  assert.match(say('/hoje'), /Prioridade real/);
  assert.match(say('/xp'), /Nível 1/);
  assert.match(say('/revisao'), /Revisão da semana/);
  assert.match(say('olá'), /Modo básico/);
  assert.match(say('/xyz'), /desconhecido/);
});

test('sem vault configurado avisa claramente', () => {
  const core = createCore(openDatabase(':memory:'));
  const say = createHandler({ core, vault: new Vault('') });
  assert.match(say('/ideia Teste'), /Vault do Obsidian indisponível/);
});
