// Integração com o Obsidian: o vault é só uma pasta de arquivos Markdown.
// Este módulo lê, pesquisa, cria e acrescenta conteúdo às notas.
// Regras de segurança:
//  - nunca apaga notas;
//  - antes de alterar uma nota, guarda a versão anterior em <vault>/.jarvis/historico/;
//  - só grava dentro das pastas de conhecimento (ideias/, projetos/, ...);
//  - não lê nem grava fora do vault, nem em pastas ocultas (.obsidian, .jarvis, .trash).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppError, invalid, notFound, conflict } from '../core/errors.js';
import { today, toISODate } from '../core/dates.js';

export const NOTE_TYPES = {
  ideia: { folder: 'ideias', status: 'aberta' },
  projeto: { folder: 'projetos', status: 'ativo' },
  decisao: { folder: 'decisoes', status: 'tomada' },
  desempenho: { folder: 'desempenho', status: 'registro' },
  rotina: { folder: 'rotinas', status: 'ativa' },
};
const WRITABLE_FOLDERS = Object.values(NOTE_TYPES).map((t) => t.folder);
const MAX_FILES = 10000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function fold(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function safeFileName(title) {
  const s = String(title)
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 100)
    .trim();
  return s || 'Sem título';
}

// ---------- frontmatter (subconjunto simples de YAML) ----------
export function parseNote(raw) {
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { meta: {}, body: text, hasFrontmatter: false, metaParseable: true };
  const meta = {};
  let parseable = true;
  let lastKey = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = /^([A-Za-zÀ-ÿ0-9_-]+):\s*(.*)$/.exec(line);
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (kv) {
      lastKey = kv[1];
      const v = kv[2].trim();
      if (v === '') meta[lastKey] = [];
      else if (/^\[.*\]$/.test(v)) meta[lastKey] = v.slice(1, -1).split(',').map(unquote).filter(Boolean);
      else meta[lastKey] = unquote(v);
    } else if (item && lastKey && Array.isArray(meta[lastKey])) {
      meta[lastKey].push(unquote(item[1]));
    } else {
      parseable = false; // YAML mais complexo: não reescrevemos o cabeçalho
    }
  }
  return { meta, body: text.slice(m[0].length), hasFrontmatter: true, metaParseable: parseable, rawFrontmatter: m[0] };
}

function unquote(s) {
  const t = String(s).trim();
  return /^(['"]).*\1$/.test(t) ? t.slice(1, -1) : t;
}
function yamlValue(v) {
  if (Array.isArray(v)) return `[${v.map(yamlScalar).join(', ')}]`;
  return yamlScalar(v);
}
function yamlScalar(v) {
  const s = String(v);
  return /^[\w À-ÿ./@+-]*$/.test(s) && !/^\s|\s$/.test(s) && s !== '' ? s : JSON.stringify(s);
}
export function serializeMeta(meta) {
  return `---\n${Object.entries(meta).map(([k, v]) => `${k}: ${yamlValue(v)}`).join('\n')}\n---\n`;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${toISODate(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export class Vault {
  constructor(root) {
    this.root = root ? path.resolve(root) : '';
  }

  status() {
    if (!this.root) return { configured: false, ok: false, reason: 'OBSIDIAN_VAULT_PATH não definido no arquivo .env.' };
    try {
      const st = fs.statSync(this.root);
      if (!st.isDirectory()) return { configured: true, ok: false, path: this.root, reason: 'O caminho existe, mas não é uma pasta.' };
      fs.accessSync(this.root, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      return { configured: true, ok: false, path: this.root, reason: 'Pasta não encontrada ou sem permissão de leitura/escrita.' };
    }
    const isObsidian = fs.existsSync(path.join(this.root, '.obsidian'));
    return {
      configured: true,
      ok: true,
      path: this.root,
      obsidian_detected: isObsidian,
      folders: WRITABLE_FOLDERS.map((f) => ({ folder: f, exists: fs.existsSync(path.join(this.root, f)) })),
    };
  }

  ensureReady() {
    const st = this.status();
    if (!st.ok) throw new AppError(503, `Vault do Obsidian indisponível: ${st.reason}`);
  }

  // Cria as pastas de conhecimento que faltarem (nunca mexe nas existentes).
  ensureFolders() {
    this.ensureReady();
    for (const f of WRITABLE_FOLDERS) fs.mkdirSync(path.join(this.root, f), { recursive: true });
    return this.status();
  }

  // Converte um caminho relativo em absoluto, garantindo que fica dentro do vault.
  resolve(rel, { forWrite = false } = {}) {
    if (typeof rel !== 'string' || !rel.trim()) throw invalid('Caminho da nota não informado.');
    const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '').trim();
    const withExt = clean.toLowerCase().endsWith('.md') ? clean : `${clean}.md`;
    const parts = withExt.split('/');
    if (parts.some((p) => p === '..' || p === '' || p.startsWith('.'))) throw invalid('Caminho de nota inválido.');
    if (forWrite && !WRITABLE_FOLDERS.includes(parts[0])) {
      throw invalid(`O Jarvis só grava nas pastas: ${WRITABLE_FOLDERS.join(', ')}.`);
    }
    const abs = path.resolve(this.root, ...parts);
    if (!abs.startsWith(this.root + path.sep)) throw invalid('Caminho fora do vault.');
    return { abs, rel: parts.join('/') };
  }

  *walk(dir = this.root, relDir = '') {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) yield* this.walk(abs, rel);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) yield { abs, rel };
    }
  }

  loadAll() {
    const out = [];
    for (const f of this.walk()) {
      if (out.length >= MAX_FILES) break;
      let st;
      try { st = fs.statSync(f.abs); } catch { continue; }
      if (st.size > MAX_FILE_BYTES) continue;
      const raw = fs.readFileSync(f.abs, 'utf8');
      const parsed = parseNote(raw);
      out.push({ ...f, mtime: st.mtime, raw, ...parsed, title: titleOf(f.rel, parsed) });
    }
    return out;
  }

  readNote(rel) {
    this.ensureReady();
    const { abs, rel: r } = this.resolve(rel);
    if (!fs.existsSync(abs)) throw notFound(`Nota não encontrada: ${r}`);
    const raw = fs.readFileSync(abs, 'utf8');
    const parsed = parseNote(raw);
    const title = titleOf(r, parsed);
    const stem = path.basename(r, '.md');
    const backlinks = this.loadAll()
      .filter((n) => n.rel !== r && wikiLinks(n.body).some((l) => fold(l) === fold(stem)))
      .map((n) => ({ path: n.rel, title: n.title }));
    return {
      path: r,
      title,
      meta: parsed.meta,
      body: parsed.body,
      links: wikiLinks(parsed.body),
      backlinks,
      updated_at: fs.statSync(abs).mtime.toISOString(),
    };
  }

  // Busca tolerante: ignora acentos e maiúsculas, aceita partes de palavras
  // (ex.: "decis" encontra "decisão" e "decisões") e ordena por relevância.
  search(query, { type, limit = 10 } = {}) {
    this.ensureReady();
    const terms = fold(query || '').split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
    if (!terms.length) throw invalid('Informe palavras para pesquisar.');
    const folder = type ? NOTE_TYPES[type]?.folder : null;
    if (type && !folder) throw invalid(`Tipo inválido. Use: ${Object.keys(NOTE_TYPES).join(', ')}.`);
    const now = Date.now();
    const results = [];
    for (const n of this.loadAll()) {
      if (folder && !n.rel.startsWith(folder + '/')) continue;
      const title = fold(n.title + ' ' + n.rel);
      const tags = fold([].concat(n.meta.tags || []).join(' '));
      const body = fold(n.body);
      let score = 0;
      let matched = 0;
      for (const t of terms) {
        const stem = t.length > 5 ? t.slice(0, Math.max(5, t.length - 2)) : t;
        let s = 0;
        if (title.includes(t)) s += 6; else if (title.includes(stem)) s += 4;
        if (tags.includes(stem)) s += 3;
        const occ = countOcc(body, stem);
        s += Math.min(occ, 5);
        if (s > 0) matched++;
        score += s;
      }
      if (!matched || matched < Math.ceil(terms.length / 2)) continue;
      if (matched === terms.length) score += 3;
      const ageDays = (now - n.mtime.getTime()) / 86400000;
      score += ageDays < 14 ? 1 : 0;
      results.push({
        path: n.rel,
        title: n.title,
        type: n.meta.tipo || null,
        status: n.meta.status || null,
        tags: [].concat(n.meta.tags || []),
        updated_at: n.mtime.toISOString(),
        score,
        snippet: snippet(n.body, terms),
      });
    }
    return results.sort((a, b) => b.score - a.score || b.updated_at.localeCompare(a.updated_at)).slice(0, Math.min(limit, 50));
  }

  listRecent({ type, limit = 10 } = {}) {
    this.ensureReady();
    const folder = type ? NOTE_TYPES[type]?.folder : null;
    return this.loadAll()
      .filter((n) => !folder || n.rel.startsWith(folder + '/'))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, Math.min(limit, 50))
      .map((n) => ({ path: n.rel, title: n.title, type: n.meta.tipo || null, status: n.meta.status || null, updated_at: n.mtime.toISOString() }));
  }

  // Cria uma nota. Se já existir uma nota com o mesmo título na mesma pasta,
  // recusa e aponta a existente (o certo é atualizá-la, não duplicar).
  createNote({ type, title, body = '', tags = [], status, related = [] }) {
    this.ensureReady();
    const t = NOTE_TYPES[type];
    if (!t) throw invalid(`Tipo de nota inválido. Use: ${Object.keys(NOTE_TYPES).join(', ')}.`);
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) throw invalid('Informe um título para a nota.');
    const fileName = safeFileName(cleanTitle);
    const dir = path.join(this.root, t.folder);
    fs.mkdirSync(dir, { recursive: true });
    const existing = fs.readdirSync(dir).find((f) => fold(f) === fold(`${fileName}.md`));
    if (existing) {
      throw conflict(`Já existe uma nota com esse título: ${t.folder}/${existing}. Atualize-a em vez de criar outra.`, {
        existing_path: `${t.folder}/${existing}`,
      });
    }
    const rel = `${t.folder}/${fileName}.md`;
    const d = today();
    const meta = {
      id: `${d.replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`,
      tipo: type,
      criado: d,
      atualizado: d,
      status: status || t.status,
      tags: normalizeTags(tags),
    };
    let content = `${serializeMeta(meta)}# ${cleanTitle}\n\n${String(body).trim()}\n`;
    const rels = [].concat(related || []).map((r) => this.linkTarget(r)).filter(Boolean);
    if (rels.length) content += `\n## Relacionadas\n\n${rels.map((l) => `- [[${l}]]`).join('\n')}\n`;
    writeAtomic(path.join(this.root, rel), content, { exclusive: true });
    return this.readNote(rel);
  }

  // Acrescenta uma seção datada ao final da nota (nunca apaga o que existe).
  appendToNote(rel, { text, heading, status, tags } = {}) {
    this.ensureReady();
    const { abs, rel: r } = this.resolve(rel, { forWrite: true });
    if (!fs.existsSync(abs)) throw notFound(`Nota não encontrada: ${r}`);
    const addition = String(text || '').trim();
    if (!addition && !status && !tags) throw invalid('Nada para acrescentar.');
    const raw = fs.readFileSync(abs, 'utf8');
    this.snapshot(r, raw);
    const parsed = parseNote(raw);
    let out = raw.replace(/\s+$/, '');
    if (addition) out += `\n\n## ${heading ? String(heading).trim() : `Atualização ${stamp()}`}\n\n${addition}`;
    out += '\n';
    out = this.touchMeta(out, parsed, { status, tags });
    writeAtomic(abs, out);
    return this.readNote(r);
  }

  // Liga a nota A à nota B (e B à A) numa seção "Relacionadas". Idempotente.
  linkNotes(fromRel, toRel, { bidirectional = true } = {}) {
    this.ensureReady();
    const a = this.resolve(fromRel, { forWrite: true });
    const b = this.resolve(toRel, { forWrite: bidirectional });
    for (const x of [a, b]) if (!fs.existsSync(x.abs)) throw notFound(`Nota não encontrada: ${x.rel}`);
    const changed = [];
    if (this.addRelated(a, b.rel)) changed.push(a.rel);
    if (bidirectional && this.addRelated(b, a.rel)) changed.push(b.rel);
    return { linked: [a.rel, b.rel], changed };
  }

  addRelated(target, otherRel) {
    const link = this.linkTarget(otherRel);
    const raw = fs.readFileSync(target.abs, 'utf8');
    const parsed = parseNote(raw);
    if (wikiLinks(parsed.body).some((l) => fold(l) === fold(link))) return false;
    this.snapshot(target.rel, raw);
    let out = raw.replace(/\s+$/, '');
    const hasSection = /^## Relacionadas\s*$/m.test(out);
    if (hasSection) {
      out = out.replace(/^## Relacionadas\s*$((?:\n(?!## ).*)*)/m, (sec) => `${sec.replace(/\s+$/, '')}\n- [[${link}]]`);
    } else {
      out += `\n\n## Relacionadas\n\n- [[${link}]]`;
    }
    out = this.touchMeta(out + '\n', parsed, {});
    writeAtomic(target.abs, out);
    return true;
  }

  linkTarget(rel) {
    if (!rel) return null;
    const s = String(rel).replace(/\\/g, '/');
    return path.posix.basename(s, '.md');
  }

  touchMeta(content, parsed, { status, tags }) {
    if (!parsed.hasFrontmatter || !parsed.metaParseable) return content; // não arriscamos reescrever YAML complexo
    const meta = { ...parsed.meta, atualizado: today() };
    if (status) meta.status = String(status);
    if (tags) meta.tags = normalizeTags([].concat(parsed.meta.tags || [], tags));
    const fm = serializeMeta(meta);
    return content.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, fm);
  }

  // Cópia da versão anterior antes de qualquer alteração (recuperação simples).
  snapshot(rel, raw) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(this.root, '.jarvis', 'historico', `${rel.replace(/\.md$/, '')}.${ts}.md`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, raw);
  }
}

function titleOf(rel, parsed) {
  if (parsed.meta.titulo || parsed.meta.title) return parsed.meta.titulo || parsed.meta.title;
  const h = /^#\s+(.+)$/m.exec(parsed.body);
  return h ? h[1].trim() : path.posix.basename(rel, '.md');
}

export function wikiLinks(body) {
  const out = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(body))) out.push(path.posix.basename(m[1].trim(), '.md'));
  return [...new Set(out)];
}

function normalizeTags(tags) {
  return [...new Set([].concat(tags || []).map((t) => String(t).trim().replace(/^#/, '').replace(/\s+/g, '-')).filter(Boolean))];
}

function countOcc(hay, needle) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1 && n < 20) { n++; i = hay.indexOf(needle, i + needle.length); }
  return n;
}

function snippet(body, terms) {
  const plain = body.replace(/^#\s+.*$/m, '').replace(/\s+/g, ' ').trim();
  const f = fold(plain);
  let pos = -1;
  for (const t of terms) { pos = f.indexOf(t.length > 5 ? t.slice(0, 5) : t); if (pos !== -1) break; }
  if (pos === -1) return plain.slice(0, 160);
  const start = Math.max(0, pos - 60);
  return (start > 0 ? '…' : '') + plain.slice(start, start + 200) + (start + 200 < plain.length ? '…' : '');
}

function writeAtomic(file, content, { exclusive = false } = {}) {
  if (exclusive && fs.existsSync(file)) throw conflict(`Arquivo já existe: ${file}`);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}
