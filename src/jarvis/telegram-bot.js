// Jarvis — modo básico no Telegram (sem IA, sem custo).
// Funciona por comandos simples. Para conversa em linguagem natural, use o
// Hermes Agent + servidor MCP (ver docs/INTEGRATIONS.md). Não rode os dois
// com o MESMO bot do Telegram: o Telegram só entrega cada mensagem a um deles.
import { parseDatePt } from './date-parse.js';
import { today, weekdayName } from '../core/dates.js';

const HELP = `Jarvis (modo básico) — comandos:
/hoje — o que está planejado para hoje e o que está atrasado
/semana — prioridades, números da semana e XP
/pendentes [área] — tarefas pendentes com seus números
/tarefa título | data | área — cria tarefa (data e área opcionais; comece com ! para prioridade)
   ex.: /tarefa Estudar para a prova | quinta | faculdade
/feito 12 — conclui a tarefa nº 12 (ou /feito texto para procurar)
/ideia título | detalhes — guarda uma ideia no Obsidian
/buscar termos — procura nas notas do Obsidian
/nota caminho — mostra uma nota (ex.: /nota ideias/Minha ideia)
/projeto nome — contexto de um projeto (tarefas + notas)
/revisao — síntese para a revisão semanal
/xp — nível e XP`;

const fmtTask = (t) => {
  const bits = [`#${t.id}`, t.is_priority ? '⭐' : '', t.title];
  const when = [];
  if (t.planned_date) when.push(`plan. ${shortDate(t.planned_date)}`);
  if (t.due_date) when.push(`prazo ${shortDate(t.due_date)}`);
  if (t.area_name) when.push(t.area_name);
  return `${bits.filter(Boolean).join(' ')}${when.length ? ` (${when.join(' · ')})` : ''}`;
};
const shortDate = (iso) => `${weekdayName(iso).slice(0, 3)} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const list = (arr, fmt, empty = '—') => (arr.length ? arr.map(fmt).join('\n') : empty);

export function createHandler({ core, vault }) {
  const S = 'telegram';
  const cmds = {
    start: () => `Olá! Sou o Jarvis.\n\n${HELP}`,
    ajuda: () => HELP,
    help: () => HELP,

    hoje: () => {
      const ov = core.overview(today());
      const day = ov.week.days.find((d) => d.is_today);
      const pend = day ? day.tasks.filter((t) => t.status === 'pending') : [];
      const done = day ? day.tasks.filter((t) => t.status === 'done') : [];
      return [
        `Hoje, ${ov.today_weekday} ${ov.today.slice(8)}/${ov.today.slice(5, 7)}`,
        `\nPlanejado (${pend.length}):\n${list(pend, fmtTask, 'nada planejado')}`,
        done.length ? `\nConcluído hoje: ${done.length} ✔` : '',
        ov.overdue.length ? `\nCom prazo vencido (${ov.overdue.length}):\n${list(ov.overdue.slice(0, 10), fmtTask)}` : '',
        `\nXP hoje: ${ov.xp.today} · Nível ${ov.xp.level} (${ov.xp.title})`,
      ].filter(Boolean).join('\n');
    },

    semana: () => {
      const ov = core.overview(today());
      return [
        `Semana ${ov.week.start.slice(8)}/${ov.week.start.slice(5, 7)} a ${ov.week.end.slice(8)}/${ov.week.end.slice(5, 7)}`,
        `Planejadas ${ov.counts.planned} · concluídas ${ov.counts.done} · pendentes ${ov.counts.pending} · prazo vencido ${ov.counts.overdue}`,
        `\nPrioridades:\n${list(ov.priorities.slice(0, 10), fmtTask, 'nenhuma tarefa marcada como prioridade')}`,
        `\nXP: ${ov.xp.total_xp} total, ${ov.xp.week} nesta semana · Nível ${ov.xp.level} (${ov.xp.title}) · faltam ${ov.xp.xp_to_next} para o próximo`,
      ].join('\n');
    },

    pendentes: (arg) => {
      let area = null;
      if (arg) area = core.findArea(arg);
      const tasks = core.listTasks({ status: 'pending', area_id: area?.id, limit: 25 });
      return `Pendentes${area ? ` em ${area.name}` : ''} (${tasks.length}${tasks.length === 25 ? '+' : ''}):\n${list(tasks, fmtTask, 'nenhuma 🎉')}`;
    },

    tarefa: (arg) => {
      if (!arg) return 'Use: /tarefa título | data | área\nex.: /tarefa Estudar para a prova | quinta | faculdade';
      let [title, when, areaRef] = arg.split('|').map((s) => s.trim());
      let priority = false;
      if (title.startsWith('!')) { priority = true; title = title.slice(1).trim(); }
      if (!title) return 'Faltou o título da tarefa.';
      let planned = null;
      if (when) {
        const p = parseDatePt(when);
        if (!p.ok) {
          return p.ambiguous
            ? `${p.question}\nNão gravei nada. Reenvie com a data exata (ex.: ${p.options[1].split('-').reverse().slice(0, 2).join('/')}).`
            : `Não entendi a data "${when}". Não gravei nada. Use: hoje, amanhã, quinta, 25/10...`;
        }
        planned = p.date;
      }
      const area = areaRef ? core.findArea(areaRef) : null;
      const t = core.createTask({ title, planned_date: planned, area_id: area?.id ?? null, is_priority: priority }, S);
      return `✔ Tarefa criada: ${fmtTask(t)}${planned ? '' : '\n(sem data planejada)'}${area ? '' : '\n(sem área — dá para ajustar no painel)'}`;
    },

    feito: (arg) => {
      if (!arg) return 'Use: /feito 12 (número da tarefa) ou /feito parte do título';
      if (/^#?\d+$/.test(arg)) {
        const r = core.completeTask(Number(arg.replace('#', '')), {}, S);
        if (r.already_done) return `A tarefa #${r.task.id} já estava concluída. Nada mudou.`;
        const lvl = core.xpStatus();
        return `✔ Concluída: ${r.task.title}\n+${r.xp.amount} XP${r.xp.amount === 0 ? ` (${r.xp.note})` : ''} · total ${lvl.total_xp} · nível ${lvl.level} (${lvl.title})`;
      }
      const matches = core.listTasks({ status: 'pending', q: arg, limit: 10 });
      if (!matches.length) return `Não encontrei tarefa pendente com "${arg}".`;
      if (matches.length === 1) return `Encontrei: ${fmtTask(matches[0])}\nPara confirmar, envie /feito ${matches[0].id}`;
      return `Encontrei ${matches.length} tarefas. Qual delas?\n${list(matches, fmtTask)}\n\nEnvie /feito <número>.`;
    },

    ideia: (arg) => {
      if (!arg) return 'Use: /ideia título | detalhes';
      const [title, ...rest] = arg.split('|').map((s) => s.trim());
      const body = rest.join('\n') || '';
      const similar = safeSearch(vault, title).filter((n) => n.score >= 6).slice(0, 3);
      try {
        const n = vault.createNote({ type: 'ideia', title, body: body || '(registrada pelo Telegram)', tags: ['telegram'] });
        return `💡 Ideia guardada em ${n.path}${similar.length ? `\n\nNotas parecidas que já existem:\n${similar.map((s) => `- ${s.path}`).join('\n')}` : ''}`;
      } catch (err) {
        if (err.status === 409 && err.details?.existing_path) {
          if (!body) return `Já existe a nota ${err.details.existing_path}. Para acrescentar algo, envie /ideia ${title} | texto novo`;
          vault.appendToNote(err.details.existing_path, { text: body });
          return `Já existia ${err.details.existing_path}: acrescentei o texto novo nela (sem apagar nada).`;
        }
        throw err;
      }
    },

    buscar: (arg) => {
      if (!arg) return 'Use: /buscar termos';
      const res = vault.search(arg, { limit: 8 });
      if (!res.length) return `Não encontrei notas sobre "${arg}".`;
      return res.map((r) => `• ${r.title}\n  ${r.path}\n  ${r.snippet}`).join('\n\n');
    },

    nota: (arg) => {
      if (!arg) return 'Use: /nota caminho (ex.: /nota ideias/Minha ideia)';
      const n = vault.readNote(arg);
      const body = n.body.length > 3000 ? `${n.body.slice(0, 3000)}\n…(cortado)` : n.body;
      return `${n.path} · atualizado ${n.meta.atualizado || n.updated_at.slice(0, 10)}\n\n${body}`;
    },

    projeto: (arg) => {
      if (!arg) return 'Use: /projeto nome';
      const ctx = core.projectContext(arg);
      const notes = safeSearch(vault, arg).slice(0, 5);
      if (!ctx.length && !notes.length) return `Não encontrei projeto nem notas sobre "${arg}".`;
      const parts = ctx.map((c) => [
        `📁 ${c.project.title} (${c.area}, ${c.project.status})`,
        c.project.description ? c.project.description : '',
        `Pendentes:\n${list(c.pending_tasks.slice(0, 10), (t) => `#${t.id} ${t.title}`)}`,
        c.recently_done.length ? `Concluídas recentes:\n${list(c.recently_done.slice(0, 5), (t) => `✔ ${t.title}`)}` : '',
        c.project.note_path ? `Nota principal: ${c.project.note_path}` : '',
      ].filter(Boolean).join('\n'));
      if (notes.length) parts.push(`Notas relacionadas:\n${notes.map((n) => `- ${n.path}`).join('\n')}`);
      return parts.join('\n\n');
    },

    revisao: () => {
      const d = core.reviewDraft(today());
      return [
        `Revisão da semana ${d.week.label}`,
        `XP na semana: ${d.xp_week} · Nível ${d.level.level} (${d.level.title})`,
        `\nConcluído (${d.done.length}):\n${list(d.done.slice(0, 15), (t) => `✔ ${t.title}`)}`,
        `\nFicou pendente (${d.still_pending.length}):\n${list(d.still_pending.slice(0, 10), (t) => `• #${t.id} ${t.title}`)}`,
        d.habits.length ? `\nHábitos:\n${list(d.habits, (h) => `${h.title}: ${h.done}/${h.target}`)}` : '',
        d.quiet_areas.length ? `\nÁreas sem conclusões nesta semana: ${d.quiet_areas.map((a) => a.area).join(', ')}` : '',
        '\nPara registrar conquistas, aprendizados e o foco da próxima semana, abra a tela "Revisão" do painel.',
      ].filter(Boolean).join('\n');
    },

    xp: () => {
      const x = core.xpStatus();
      return `Nível ${x.level} — ${x.title}\nXP total: ${x.total_xp}\nFaltam ${x.xp_to_next} XP para o nível ${x.level + 1}${x.next_title ? `\nPróximo título: ${x.next_title.title} (nível ${x.next_title.level})` : ''}`;
    },
  };

  return function handle(text) {
    const m = /^\/([a-zA-Zçã]+)(?:@\w+)?\s*([\s\S]*)$/.exec(String(text || '').trim());
    if (!m) return 'Modo básico: use comandos. Ex.: /ideia título para guardar uma ideia, /hoje, /semana. Envie /ajuda para ver todos.';
    const name = m[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const fn = cmds[name];
    if (!fn) return `Comando desconhecido: /${m[1]}\n\n${HELP}`;
    try {
      return fn(m[2].trim());
    } catch (err) {
      if (err.status === 503) return `⚠ ${err.message}`;
      if (err.status && err.status < 500) return `⚠ ${err.message}${err.details?.pending ? `\nPendentes: ${err.details.pending.map((p) => `#${p.id} ${p.title}`).join(', ')}` : ''}`;
      console.error('[telegram]', err);
      return '⚠ Erro interno. Veja o terminal do painel.';
    }
  };
}

function safeSearch(vault, q) {
  try { return vault.search(q, { limit: 5 }); } catch { return []; }
}

// ---------- conexão com o Telegram (long polling: não expõe nada na internet) ----------
export async function startTelegramBot({ config, core, vault }) {
  if (!config.telegramAllowedUsers.length) {
    console.error('[telegram] JARVIS_TELEGRAM_ALLOWED_USERS vazio: por segurança o bot não foi iniciado.');
    return;
  }
  const api = (method, body) => fetch(`https://api.telegram.org/bot${config.telegramToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then((r) => r.json());

  const me = await api('getMe');
  if (!me.ok) throw new Error(`token do Telegram recusado: ${me.description}`);
  console.log(`  Telegram:         @${me.result.username} (modo básico, ${config.telegramAllowedUsers.length} usuário(s) autorizado(s))`);
  const handle = createHandler({ core, vault });
  let offset = 0;
  for (;;) {
    try {
      const upd = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
      if (!upd.ok) { console.error(`[telegram] ${upd.description}`); await sleep(10000); continue; }
      for (const u of upd.result) {
        offset = u.update_id + 1;
        const msg = u.message;
        if (!msg || !msg.text) continue;
        if (!config.telegramAllowedUsers.includes(String(msg.from?.id))) {
          console.warn(`[telegram] mensagem ignorada de usuário não autorizado ${msg.from?.id}`);
          continue;
        }
        const reply = handle(msg.text);
        for (let i = 0; i < reply.length; i += 4000) {
          await api('sendMessage', { chat_id: msg.chat.id, text: reply.slice(i, i + 4000) });
        }
      }
    } catch (err) {
      console.error(`[telegram] conexão: ${err.message}`);
      await sleep(10000);
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
