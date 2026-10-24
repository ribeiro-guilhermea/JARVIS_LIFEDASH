// Servidor HTTP do Life Dashboard: entrega a interface (pasta public/) e a API JSON.
// O Jarvis (MCP/Hermes) usa exatamente esta mesma API: não existe outro caminho
// de gravação, então todas as validações valem para ele também.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AppError, invalid, notFound } from '../core/errors.js';
import { today, isoWeekLabel, weekStart } from '../core/dates.js';
import { parseDatePt } from '../jarvis/date-parse.js';
import { createBackup, listBackups } from '../backup/backup.js';
import { dbFile } from '../config.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
export const VERSION = '0.1.0';

export function isLoopback(host) {
  return ['127.0.0.1', 'localhost', '::1'].includes(host);
}

export function createServer({ config, core, vault }) {
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler });
  };

  // ---------- rotas ----------
  route('GET', '/api/health', () => ({
    ok: true, version: VERSION, today: today(), timezone: config.timezone,
    vault: vault.status(), auth_required: Boolean(config.accessToken),
  }));
  route('GET', '/api/overview', ({ query }) => core.overview(query.date || today()));

  route('GET', '/api/areas', ({ query }) => core.listAreas({ includeInactive: query.all === '1' }));
  route('POST', '/api/areas', ({ body, source }) => core.createArea(body, source));
  route('GET', '/api/areas/:id', ({ params }) => core.areaDetail(Number(params.id)));
  route('PATCH', '/api/areas/:id', ({ params, body, source }) => core.updateArea(Number(params.id), body, source));

  const kind = (k) => { if (!['objective', 'goal', 'project'].includes(k)) throw notFound('Tipo inválido.'); return k; };
  route('GET', '/api/plan/:kind', ({ params, query }) => core.listPlanItems(kind(params.kind), query));
  route('POST', '/api/plan/:kind', ({ params, body, source }) => core.createPlanItem(kind(params.kind), body, source));
  route('PATCH', '/api/plan/:kind/:id', ({ params, body, source }) => core.updatePlanItem(kind(params.kind), Number(params.id), body, source));
  route('GET', '/api/projects/context', ({ query }) => core.projectContext(query.q || ''));

  route('GET', '/api/tasks', ({ query }) => core.listTasks({
    ...query, root_only: query.root_only === '1', priority: query.priority === '1',
  }));
  route('POST', '/api/tasks', ({ body, source }) => {
    const input = { ...body };
    if (input.area !== undefined && input.area_id === undefined) {
      const a = core.findArea(input.area);
      input.area_id = a ? a.id : null;
    }
    delete input.area;
    return core.createTask(input, source);
  });
  route('GET', '/api/tasks/:id', ({ params }) => core.getTask(Number(params.id)));
  route('PATCH', '/api/tasks/:id', ({ params, body, source }) => core.updateTask(Number(params.id), body, source));
  route('POST', '/api/tasks/:id/complete', ({ params, body, source }) => core.completeTask(Number(params.id), { cascade: Boolean(body.cascade) }, source));
  route('POST', '/api/tasks/:id/reopen', ({ params, source }) => core.reopenTask(Number(params.id), source));
  route('POST', '/api/tasks/:id/cancel', ({ params, source }) => core.cancelTask(Number(params.id), source));
  route('POST', '/api/tasks/:id/split', ({ params, body, source }) => {
    const steps = [].concat(body.steps || []).map((s) => String(s).trim()).filter(Boolean);
    if (!steps.length) throw invalid('Informe ao menos um passo.');
    if (steps.length > 30) throw invalid('No máximo 30 passos por vez.');
    const created = steps.map((title) => core.createTask({ title, parent_id: Number(params.id) }, source));
    return { parent: core.getTask(Number(params.id)), created };
  });

  route('GET', '/api/habits', ({ query }) => core.listHabits(query.date || today()));
  route('POST', '/api/habits', ({ body, source }) => core.createHabit(body, source));
  route('PATCH', '/api/habits/:id', ({ params, body, source }) => core.updateHabit(Number(params.id), body, source));
  route('POST', '/api/habits/:id/check', ({ params, body, source }) => core.checkHabit(Number(params.id), body.date || today(), source));
  route('POST', '/api/habits/:id/uncheck', ({ params, body, source }) => core.uncheckHabit(Number(params.id), body.date || today(), source));

  route('GET', '/api/xp', () => core.xpStatus());
  route('GET', '/api/xp/ledger', ({ query }) => core.listLedger(query));
  route('GET', '/api/xp/history', ({ query }) => core.xpHistory(Math.min(Number(query.weeks) || 12, 52)));
  route('POST', '/api/xp/adjustments', ({ body, source }) => core.addAdjustment(body, source));
  route('GET', '/api/rules', () => core.getRules());
  route('PUT', '/api/rules', ({ body, source }) => core.setRules(body, source));
  route('GET', '/api/seasons', () => ({ current: core.currentSeason(), all: core.listSeasons() }));
  route('POST', '/api/seasons', ({ body, source }) => core.createSeason(body, source));
  route('GET', '/api/activity', ({ query }) => core.activity(query));

  route('GET', '/api/reviews', () => core.listReviews());
  route('GET', '/api/reviews/draft', ({ query }) => core.reviewDraft(query.date || today()));
  route('POST', '/api/reviews', ({ body, source }) => {
    const result = core.saveReview(body, source);
    if (body.save_to_obsidian) {
      // A revisão já está salva no banco; se o vault falhar, avisamos sem perder nada.
      try {
        result.note = writeReviewNote(vault, result.review);
        core.saveReview({ ...body, week_start: result.review.week_start, note_path: result.note.path }, source);
      } catch (err) {
        result.note_error = err.message;
      }
    }
    return result;
  });

  route('GET', '/api/notes/status', () => vault.status());
  route('POST', '/api/notes/init', () => vault.ensureFolders());
  route('GET', '/api/notes/search', ({ query }) => vault.search(query.q, { type: query.type || undefined, limit: Number(query.limit) || 10 }));
  route('GET', '/api/notes/recent', ({ query }) => vault.listRecent({ type: query.type || undefined, limit: Number(query.limit) || 10 }));
  route('GET', '/api/notes/read', ({ query }) => vault.readNote(query.path));
  route('POST', '/api/notes', ({ body }) => vault.createNote(body));
  route('POST', '/api/notes/append', ({ body }) => vault.appendToNote(body.path, body));
  route('POST', '/api/notes/link', ({ body }) => vault.linkNotes(body.from, body.to, { bidirectional: body.bidirectional !== false }));

  route('GET', '/api/backups', () => ({ dir: config.backupDir, backups: listBackups(config.backupDir).slice(0, 20) }));
  route('POST', '/api/backups', () => {
    const r = createBackup({ dbFile: dbFile(config), backupDir: config.backupDir, db: core.db, kind: 'manual' });
    return { file: r.file, path: r.path, counts: r.counts, xp_total: r.xp_total, integrity: r.integrity };
  });

  route('GET', '/api/dates/parse', ({ query }) => parseDatePt(query.text, query.ref || today()));

  // ---------- segurança ----------
  const tokenBuf = config.accessToken ? Buffer.from(config.accessToken) : null;
  function authorized(req) {
    if (!tokenBuf) return true;
    const h = req.headers.authorization || '';
    const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
    return given.length === tokenBuf.length && crypto.timingSafeEqual(given, tokenBuf);
  }
  function checkHost(req) {
    // Sem senha, só aceitamos acessos endereçados a localhost (bloqueia "DNS rebinding").
    if (tokenBuf) return true;
    const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
    return LOOPBACK_HOSTS.includes(host);
  }
  function checkOrigin(req) {
    // Gravações só a partir da própria página (bloqueia sites de terceiros).
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  }

  // ---------- servidor ----------
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url, 'http://local');
    try {
      if (!checkHost(req)) return send(res, 403, { error: 'Host não permitido.' });
      if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);

      if (url.pathname !== '/api/health' && !authorized(req)) return send(res, 401, { error: 'Acesso não autorizado. Informe a senha de acesso.' });
      const method = req.method.toUpperCase();
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        if (!checkOrigin(req)) return send(res, 403, { error: 'Origem não permitida.' });
        if (!String(req.headers['content-type'] || '').includes('application/json')) {
          return send(res, 415, { error: 'Envie JSON (Content-Type: application/json).' });
        }
        body = await readJson(req);
      }
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const query = Object.fromEntries(url.searchParams);
        const source = ['jarvis', 'telegram'].includes(req.headers['x-source']) ? req.headers['x-source'] : 'dashboard';
        const result = await r.handler({ params, query, body, source, req });
        return send(res, 200, result === undefined ? { ok: true } : result);
      }
      return send(res, 404, { error: 'Rota não encontrada.' });
    } catch (err) {
      if (err instanceof AppError) return send(res, err.status, { error: err.message, details: err.details });
      console.error('[erro]', err);
      return send(res, 500, { error: 'Erro interno. Veja o terminal do servidor.' });
    }
  });
  return server;
}

function writeReviewNote(vault, review) {
  const label = isoWeekLabel(weekStart(review.week_start));
  const s = review.snapshot;
  const list = (arr, fmt) => (arr.length ? arr.map((x) => `- ${fmt(x)}`).join('\n') : '- (nada)');
  const body = [
    `Semana de ${review.week_start} a ${s.week.end}. XP na semana: ${s.xp_week}. Nível ${s.level.level} (${s.level.title}).`,
    '', '## Concluído', list(s.done, (t) => `${t.title}${t.area ? ` (${t.area})` : ''}`),
    '', '## Ficou pendente', list(s.still_pending, (t) => t.title),
    '', '## Hábitos', list(s.habits, (h) => `${h.title}: ${h.done}/${h.target}`),
    '', '## Conquistas', review.wins || '-',
    '', '## Dificuldades', review.difficulties || '-',
    '', '## Aprendizados', review.lessons || '-',
    '', '## Foco da próxima semana', review.next_focus || '-',
  ].join('\n');
  const title = `Revisão semanal ${label}`;
  try {
    return vault.createNote({ type: 'desempenho', title, body, tags: ['revisao-semanal'] });
  } catch (err) {
    if (err.status === 409 && err.details?.existing_path) {
      return vault.appendToNote(err.details.existing_path, { text: body, heading: `Revisão atualizada` });
    }
    throw err;
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) { reject(invalid('Conteúdo grande demais.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch { reject(invalid('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  const json = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
}

function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.resolve(PUBLIC_DIR, '.' + rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Não encontrado');
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
  });
  fs.createReadStream(file).pipe(res);
}
