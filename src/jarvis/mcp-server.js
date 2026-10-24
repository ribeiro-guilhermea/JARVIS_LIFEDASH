#!/usr/bin/env node
// Jarvis — servidor MCP (Model Context Protocol) via stdio.
// O Hermes Agent (ou outro agente compatível com MCP) inicia este programa e
// ganha um conjunto FECHADO de ferramentas. Toda leitura/gravação passa pela API
// do Life Dashboard, que valida tudo. A IA nunca toca no banco ou nos arquivos
// diretamente, e não existe ferramenta para apagar nada.
import readline from 'node:readline';
import { loadConfig } from '../config.js';

const config = loadConfig();
const SERVER_INFO = { name: 'jarvis-lifedash', version: '0.1.0' };
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `Você é o Jarvis, assistente pessoal. Use estas ferramentas para consultar e alterar o Life Dashboard (tarefas, prioridades, XP) e as notas do Obsidian.
Regras:
- Nunca invente tarefas, datas, XP, níveis, notas ou decisões. Se uma ferramenta não retornar a informação, diga que não encontrou.
- Datas: converta expressões como "quinta" com a ferramenta interpretar_data. Se ela indicar ambiguidade, pergunte ao usuário antes de gravar.
- Antes de concluir uma tarefa citada de forma vaga, use listar_tarefas; se houver mais de uma candidata, pergunte qual é.
- Antes de criar uma nota, use notas_buscar. Se já existir nota sobre o assunto, prefira notas_acrescentar ou notas_relacionar.
- Depois de gravar algo, confirme ao usuário exatamente o que foi feito (id da tarefa, caminho da nota, XP).
- Não existe ferramenta para apagar: se o usuário pedir exclusão, oriente a fazer pelo painel.`;

// ---------- cliente da API do painel ----------
async function api(method, path, body) {
  const headers = { 'X-Source': 'jarvis' };
  if (config.accessToken) headers.Authorization = `Bearer ${config.accessToken}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${config.jarvisApiUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ToolError(`O Life Dashboard não está respondendo em ${config.jarvisApiUrl}. Ele precisa estar aberto (npm start).`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const extra = data.details ? `\nDetalhes: ${JSON.stringify(data.details)}` : '';
    throw new ToolError(`${data.error || `Erro HTTP ${res.status}`}${extra}`);
  }
  return data;
}
class ToolError extends Error {}

const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

const slimTask = (t) => ({
  id: t.id,
  titulo: t.title,
  area: t.area_name,
  status: t.status,
  tipo: t.granularity,
  prioridade: Boolean(t.is_priority),
  data_planejada: t.planned_date,
  prazo: t.due_date,
  ...(t.subtasks && t.subtasks.total ? { subdivisoes: `${t.subtasks.done}/${t.subtasks.total} concluídas` } : {}),
});

async function resolveAreaId(area) {
  if (!area) return undefined;
  const areas = await api('GET', '/api/areas');
  const f = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const hit = areas.filter((a) => f(a.name).includes(f(area)) || a.slug === f(area));
  if (hit.length !== 1) throw new ToolError(`Área "${area}" não encontrada ou ambígua. Áreas: ${areas.map((a) => a.name).join(', ')}.`);
  return hit[0].id;
}

// ---------- ferramentas ----------
const str = (description) => ({ type: 'string', description });
const TOOLS = [
  {
    name: 'painel_semana', write: false,
    description: 'Resumo da semana: data de hoje, prioridades, tarefas por dia, atrasadas, XP, nível e atenção por área. Use para "quais minhas prioridades", "o que tenho hoje/esta semana".',
    inputSchema: { type: 'object', properties: { data: str('Qualquer dia da semana desejada (AAAA-MM-DD). Padrão: hoje.') } },
    run: async ({ data }) => {
      const o = await api('GET', `/api/overview${qs({ date: data })}`);
      return {
        hoje: `${o.today} (${o.today_weekday})`,
        semana: `${o.week.start} a ${o.week.end}`,
        numeros: o.counts,
        xp: { total: o.xp.total_xp, semana: o.xp.week, hoje: o.xp.today, nivel: o.xp.level, titulo: o.xp.title, faltam_para_proximo_nivel: o.xp.xp_to_next },
        prioridades: o.priorities.map(slimTask),
        prazo_vencido: o.overdue.map(slimTask),
        ficaram_de_semanas_anteriores: o.carried_over.map(slimTask),
        dias: o.week.days.map((d) => ({ data: d.date, dia: d.weekday, tarefas: d.tasks.map(slimTask) })),
        sem_data: o.unscheduled.slice(0, 15).map(slimTask),
        areas: o.areas.map((a) => ({ area: a.name, concluidas_semana: a.done_week, pendentes: a.pending_total, dias_sem_atividade: a.days_since_activity })),
        habitos: o.habits.map((h) => ({ habito: h.title, feitos_semana: h.week_count, meta: h.target_per_week })),
      };
    },
  },
  {
    name: 'listar_tarefas', write: false,
    description: 'Lista/procura tarefas. Use para achar o id de uma tarefa citada pelo usuário.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'done', 'cancelled', 'all'], description: 'Padrão: pending.' },
        busca: str('Palavras do título (ignora acentos).'),
        area: str('Nome da área (ex.: Faculdade).'),
        de: str('Data inicial AAAA-MM-DD (planejada ou prazo).'),
        ate: str('Data final AAAA-MM-DD.'),
        so_prioridades: { type: 'boolean' },
        limite: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    run: async (a) => {
      const area_id = await resolveAreaId(a.area);
      const list = await api('GET', `/api/tasks${qs({ status: a.status, q: a.busca, area_id, from: a.de, to: a.ate, priority: a.so_prioridades ? 1 : undefined, limit: a.limite || 30 })}`);
      return { total: list.length, tarefas: list.map(slimTask) };
    },
  },
  {
    name: 'ver_tarefa', write: false,
    description: 'Detalhes de uma tarefa: subdivisões, histórico de alterações e lançamentos de XP.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    run: async ({ id }) => {
      const t = await api('GET', `/api/tasks/${id}`);
      return { ...slimTask(t), observacoes: t.notes, esforco: t.effort, concluida_em: t.completed_at, caminho: t.ancestors.map((x) => x.title), subdivisoes: t.children.map(slimTask), xp: t.xp_entries.map((e) => ({ valor: e.amount, motivo: e.note, em: e.created_at })) };
    },
  },
  {
    name: 'interpretar_data', write: false,
    description: 'Converte uma expressão de data em português ("quinta", "amanhã", "25/10", "próxima segunda") para AAAA-MM-DD, relativo a hoje. Se ambiguous=true, pergunte ao usuário.',
    inputSchema: { type: 'object', properties: { texto: str('Expressão de data.') }, required: ['texto'] },
    run: async ({ texto }) => api('GET', `/api/dates/parse${qs({ text: texto })}`),
  },
  {
    name: 'listar_areas', write: false,
    description: 'Lista as áreas de vida cadastradas.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => (await api('GET', '/api/areas')).map((a) => ({ id: a.id, nome: a.name })),
  },
  {
    name: 'criar_tarefa', write: true,
    description: 'Cria uma tarefa no Life Dashboard. Datas em AAAA-MM-DD (use interpretar_data antes). data_planejada = quando pretende fazer; prazo = até quando precisa estar pronta. Se área ou data forem ambíguas, pergunte antes.',
    inputSchema: {
      type: 'object',
      properties: {
        titulo: str('Ação concreta, começando por verbo.'),
        area: str('Nome da área (opcional).'),
        data_planejada: str('AAAA-MM-DD (opcional).'),
        prazo: str('AAAA-MM-DD (opcional).'),
        prioridade: { type: 'boolean' },
        esforco: { type: 'integer', enum: [1, 2, 3], description: '1 pequena, 2 média, 3 grande. Padrão 1.' },
        tarefa_mae_id: { type: 'integer', description: 'Para criar como subtarefa de outra.' },
        observacoes: str('Contexto adicional, ex.: caminho da nota de origem no Obsidian.'),
      },
      required: ['titulo'],
    },
    run: async (a) => {
      const area_id = await resolveAreaId(a.area);
      const t = await api('POST', '/api/tasks', {
        title: a.titulo, area_id, planned_date: a.data_planejada, due_date: a.prazo, is_priority: a.prioridade,
        effort: a.esforco, parent_id: a.tarefa_mae_id, notes: a.observacoes,
      });
      return { criada: slimTask(t) };
    },
  },
  {
    name: 'concluir_tarefa', write: true,
    description: 'Marca uma tarefa como concluída e lança o XP. Exige o id exato. Se a tarefa tiver subdivisões pendentes, a ferramenta recusa e lista-as: só reenvie com confirmar_subdivisoes=true depois que o usuário confirmar.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer' }, confirmar_subdivisoes: { type: 'boolean' } }, required: ['id'] },
    run: async ({ id, confirmar_subdivisoes }) => {
      const r = await api('POST', `/api/tasks/${id}/complete`, { cascade: Boolean(confirmar_subdivisoes) });
      if (r.already_done) return { aviso: 'A tarefa já estava concluída. Nada foi alterado.', tarefa: slimTask(r.task) };
      const xp = await api('GET', '/api/xp');
      return { concluida: slimTask(r.task), xp_ganho: r.xp.amount, motivo_xp: r.xp.note, xp_total: xp.total_xp, nivel: xp.level, titulo: xp.title };
    },
  },
  {
    name: 'reabrir_tarefa', write: true,
    description: 'Reabre uma tarefa concluída por engano. O XP é estornado com um lançamento explícito (nada é apagado).',
    inputSchema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    run: async ({ id }) => {
      const r = await api('POST', `/api/tasks/${id}/reopen`, {});
      return { reaberta: slimTask(r.task), xp_estornado: r.reversal ? r.reversal.amount : 0 };
    },
  },
  {
    name: 'dividir_tarefa', write: true,
    description: 'Divide uma tarefa em passos menores e concretos (subtarefas/microtarefas).',
    inputSchema: { type: 'object', properties: { id: { type: 'integer' }, passos: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 30 } }, required: ['id', 'passos'] },
    run: async ({ id, passos }) => {
      const r = await api('POST', `/api/tasks/${id}/split`, { steps: passos });
      return { tarefa: slimTask(r.parent), criadas: r.created.map(slimTask) };
    },
  },
  {
    name: 'revisao_semanal', write: false,
    description: 'Dados reais para a síntese da revisão semanal: concluído, pendente, hábitos, áreas sem atividade, XP e o que está planejado para a próxima semana.',
    inputSchema: { type: 'object', properties: { data: str('Um dia da semana a revisar (AAAA-MM-DD). Padrão: hoje.') } },
    run: async ({ data }) => api('GET', `/api/reviews/draft${qs({ date: data })}`),
  },
  {
    name: 'contexto_projeto', write: false,
    description: 'Para retomar um projeto: dados do projeto no painel (tarefas pendentes, concluídas) + notas relacionadas no Obsidian.',
    inputSchema: { type: 'object', properties: { nome: str('Nome ou parte do nome do projeto/assunto.') }, required: ['nome'] },
    run: async ({ nome }) => {
      const painel = await api('GET', `/api/projects/context${qs({ q: nome })}`);
      let notas = [];
      let aviso_notas;
      try { notas = await api('GET', `/api/notes/search${qs({ q: nome, limit: 8 })}`); } catch (e) { aviso_notas = e.message; }
      return { projetos_no_painel: painel, notas_relacionadas: notas, ...(aviso_notas ? { aviso_notas } : {}), dica: 'Leia as notas mais relevantes com notas_ler antes de sugerir próximos passos.' };
    },
  },
  {
    name: 'notas_buscar', write: false,
    description: 'Pesquisa nas notas do Obsidian (ideias, projetos, decisões, desempenho, rotinas). Tolerante a acentos e a partes de palavras. Use antes de criar nota e quando o usuário não lembra o nome.',
    inputSchema: { type: 'object', properties: { termos: str('Palavras-chave.'), tipo: { type: 'string', enum: ['ideia', 'projeto', 'decisao', 'desempenho', 'rotina'] }, limite: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['termos'] },
    run: async ({ termos, tipo, limite }) => api('GET', `/api/notes/search${qs({ q: termos, type: tipo, limit: limite })}`),
  },
  {
    name: 'notas_recentes', write: false,
    description: 'Notas alteradas mais recentemente.',
    inputSchema: { type: 'object', properties: { tipo: { type: 'string', enum: ['ideia', 'projeto', 'decisao', 'desempenho', 'rotina'] }, limite: { type: 'integer', minimum: 1, maximum: 30 } } },
    run: async ({ tipo, limite }) => api('GET', `/api/notes/recent${qs({ type: tipo, limit: limite })}`),
  },
  {
    name: 'notas_ler', write: false,
    description: 'Lê uma nota completa (metadados, conteúdo, links e notas que apontam para ela).',
    inputSchema: { type: 'object', properties: { caminho: str('Ex.: ideias/Minha ideia.md') }, required: ['caminho'] },
    run: async ({ caminho }) => api('GET', `/api/notes/read${qs({ path: caminho })}`),
  },
  {
    name: 'notas_criar', write: true,
    description: 'Cria uma nota nova. Faça notas_buscar antes; se já existir nota sobre o assunto, use notas_acrescentar. Recusa título repetido na mesma pasta.',
    inputSchema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['ideia', 'projeto', 'decisao', 'desempenho', 'rotina'] },
        titulo: str('Título claro.'),
        conteudo: str('Texto em Markdown, organizado.'),
        tags: { type: 'array', items: { type: 'string' } },
        relacionadas: { type: 'array', items: { type: 'string' }, description: 'Caminhos de notas a ligar.' },
      },
      required: ['tipo', 'titulo', 'conteudo'],
    },
    run: async (a) => {
      const n = await api('POST', '/api/notes', { type: a.tipo, title: a.titulo, body: a.conteudo, tags: a.tags, related: a.relacionadas });
      return { criada: n.path, titulo: n.title };
    },
  },
  {
    name: 'notas_acrescentar', write: true,
    description: 'Acrescenta uma seção datada ao final de uma nota existente (nunca apaga conteúdo; a versão anterior fica guardada). Também pode mudar status e tags.',
    inputSchema: {
      type: 'object',
      properties: { caminho: str('Caminho da nota.'), texto: str('Conteúdo novo.'), titulo_secao: str('Opcional. Padrão: "Atualização <data>".'), status: str('Opcional.'), tags: { type: 'array', items: { type: 'string' } } },
      required: ['caminho'],
    },
    run: async (a) => {
      const n = await api('POST', '/api/notes/append', { path: a.caminho, text: a.texto, heading: a.titulo_secao, status: a.status, tags: a.tags });
      return { atualizada: n.path };
    },
  },
  {
    name: 'notas_relacionar', write: true,
    description: 'Cria ligação [[...]] entre duas notas (nas duas direções), na seção "Relacionadas".',
    inputSchema: { type: 'object', properties: { de: str('Caminho da nota A.'), para: str('Caminho da nota B.') }, required: ['de', 'para'] },
    run: async ({ de, para }) => api('POST', '/api/notes/link', { from: de, to: para }),
  },
];

const visibleTools = () => TOOLS.filter((t) => !(config.jarvisReadonly && t.write));

// ---------- protocolo MCP (JSON-RPC 2.0, uma mensagem por linha) ----------
function reply(id, result) { write({ jsonrpc: '2.0', id, result }); }
function replyError(id, code, message) { write({ jsonrpc: '2.0', id, error: { code, message } }); }
function write(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

async function handle(msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    if (msg && msg.id !== undefined) replyError(msg.id, -32600, 'Requisição inválida');
    return;
  }
  const { id, method, params = {} } = msg;
  const isNotification = id === undefined || id === null;
  if (isNotification) return; // notifications/initialized, cancelled etc.

  switch (method) {
    case 'initialize': {
      const requested = params.protocolVersion;
      return reply(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : SUPPORTED_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: visibleTools().map(({ name, description, inputSchema, write: w }) => ({ name, description, inputSchema, annotations: { readOnlyHint: !w, destructiveHint: false } })) });
    case 'tools/call': {
      const tool = visibleTools().find((t) => t.name === params.name);
      if (!tool) {
        const hidden = TOOLS.find((t) => t.name === params.name);
        return reply(id, { content: [{ type: 'text', text: hidden ? 'Jarvis está em modo somente leitura (JARVIS_READONLY=true). Nada foi gravado.' : `Ferramenta desconhecida: ${params.name}` }], isError: true });
      }
      try {
        const out = await tool.run(params.arguments || {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] });
      } catch (err) {
        const text = err instanceof ToolError ? err.message : `Erro inesperado: ${err.message}`;
        if (!(err instanceof ToolError)) console.error('[jarvis-mcp]', err);
        return reply(id, { content: [{ type: 'text', text }], isError: true });
      }
    }
    default:
      return replyError(id, -32601, `Método não suportado: ${method}`);
  }
}

const pending = new Set();
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return replyError(null, -32700, 'JSON inválido'); }
  for (const m of Array.isArray(msg) ? msg : [msg]) {
    const p = handle(m).catch((err) => { console.error('[jarvis-mcp]', err); if (m && m.id != null) replyError(m.id, -32603, 'Erro interno'); });
    pending.add(p);
    p.finally(() => pending.delete(p));
  }
});
// Ao fechar a entrada, termina as respostas em andamento antes de sair.
rl.on('close', () => Promise.allSettled([...pending]).then(() => process.exit(0)));
console.error(`[jarvis-mcp] pronto. API: ${config.jarvisApiUrl}${config.jarvisReadonly ? ' (somente leitura)' : ''}`);
