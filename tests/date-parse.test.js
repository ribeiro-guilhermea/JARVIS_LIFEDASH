import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.js';
import { parseDatePt } from '../src/jarvis/date-parse.js';

const REF = '2026-10-24'; // sábado

test('expressões relativas', () => {
  assert.equal(parseDatePt('hoje', REF).date, '2026-10-24');
  assert.equal(parseDatePt('amanhã', REF).date, '2026-10-25');
  assert.equal(parseDatePt('depois de amanhã', REF).date, '2026-10-26');
  assert.equal(parseDatePt('daqui a 10 dias', REF).date, '2026-11-03');
});

test('dias da semana', () => {
  assert.equal(parseDatePt('quinta', REF).date, '2026-10-29');
  assert.equal(parseDatePt('na quinta-feira', REF).date, '2026-10-29');
  assert.equal(parseDatePt('Segunda', REF).date, '2026-10-26');
  assert.equal(parseDatePt('próxima sexta', REF).date, '2026-10-30');
});

test('mesmo dia da semana de hoje é ambíguo e gera pergunta', () => {
  const r = parseDatePt('sábado', REF);
  assert.equal(r.ok, false);
  assert.equal(r.ambiguous, true);
  assert.deepEqual(r.options, ['2026-10-24', '2026-10-31']);
  assert.match(r.question, /hoje/);
  assert.equal(parseDatePt('sábado que vem', REF).date, '2026-10-31');
});

test('datas numéricas e por extenso', () => {
  assert.equal(parseDatePt('30/10', REF).date, '2026-10-30');
  assert.equal(parseDatePt('05/01', REF).date, '2027-01-05');
  assert.equal(parseDatePt('15/03/2027', REF).date, '2027-03-15');
  assert.equal(parseDatePt('2 de novembro', REF).date, '2026-11-02');
  assert.equal(parseDatePt('dia 3', REF).date, '2026-11-03');
  assert.equal(parseDatePt('2026-12-01', REF).date, '2026-12-01');
});

test('datas inválidas ou desconhecidas não são inventadas', () => {
  assert.equal(parseDatePt('31/02', REF).ok, false);
  assert.equal(parseDatePt('semana que vem talvez', REF).ok, false);
  assert.equal(parseDatePt('', REF).ok, false);
});
