#!/usr/bin/env node
// Fact delta parser and checker for /product. Contracts: ../references/delta-format.md and ../references/profile.md.
// Node >= 22 (fs.globSync). Built-ins only. Pure functions are exported for delta.test.mjs; IO lives below "IO".
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// ---------------------------------------------------------------------------
// Domain tables
// ---------------------------------------------------------------------------

export const KINDS = ['behavior', 'limit', 'content', 'internal'];

// The one place a row type becomes a kind. A profile with kind "internal" overrides it for every row.
export const KIND_OF_TYPE = Object.freeze({ fact: 'behavior', const: 'limit', page: 'content', doc: 'content', none: 'behavior' });

const kindFor = (type, internal) => (internal ? 'internal' : KIND_OF_TYPE[type]);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CATALOG_DIR = path.resolve(SCRIPT_DIR, '../../product-gate/angles');
const DEFAULT_CACHE_ROOT = path.join(os.homedir(), '.cache', 'wstack', 'repos');

const KEY = '[A-Z][A-Z0-9_]*(?:\\.\\w+)*';
const REPO_REF = '(?:\\.|[\\w-][\\w.-]*/[\\w-][\\w.-]*)';
const OWNER_REPO = /^[\w-][\w.-]*\/[\w-][\w.-]*$/;
const SIGN_LINE = /^([-+])(?: (.*))?$/;
const QUOTE_LINE = /^>(?: (.*))?$/;
const BASE_LINE = /^base\s+([\w-][\w.-]*\/[\w-][\w.-]*)@([0-9a-fA-F]{7,40})$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const NEW_VALUE = new RegExp(`\\{\\{NEW:(${KEY})=((?:(?!\\}\\}).)*)\\}\\}`, 'g');
const NEW_FLAG_FRONTMATTER = /^flag:\s*NEW:(\S+)$/;
const FLAG_OPEN = /^\s*<!--\s*flag:\s*(\S+?)\s*-->\s*$/;
const FLAG_ELSE = /^\s*<!--\s*else\s*-->\s*$/;
const FLAG_CLOSE = /^\s*<!--\s*\/flag\s*-->\s*$/;
const PLACEHOLDER = new RegExp(`\\{\\{(${KEY})(?::(\\w+))?\\}\\}`, 'g');

const CLAIM_HIT_CAP = 30;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tail = (s, n = 40) => s.trimEnd().split('\n').slice(-n).join('\n');
const idOf = (file) => path.posix.basename(file.split(path.sep).join('/'), '.md');
const memo = (fn) => {
  let done = false;
  let value;
  return () => (done ? value : ((done = true), (value = fn())));
};

// ---------------------------------------------------------------------------
// Fenced blocks and frontmatter
// ---------------------------------------------------------------------------

/** Contents of every fenced block whose info string is `info`, as arrays of lines. */
export function fencedBlocks(text, info) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let open = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!open) {
      const m = /^(`{3,}|~{3,})\s*(\S*)/.exec(line);
      if (m) open = { fence: m[1], keep: m[2] === info, lines: [] };
    } else if (line.startsWith(open.fence) && /^(`+|~+)$/.test(line.trim())) {
      if (open.keep) blocks.push(open.lines);
      open = null;
    } else open.lines.push(raw);
  }
  if (open?.keep) blocks.push(open.lines);
  return blocks;
}

const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, '$2');
const scalar = (s) => (s === 'true' ? true : s === 'false' ? false : unquote(s));

/** Top-level `key: value`, `key: [a, b]` and block lists. Nested mappings are ignored. */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  const data = {};
  if (!m) return data;
  let listKey = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    const item = /^\s*-\s+(.*)$/.exec(raw);
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const [, key, rest] = kv;
    listKey = null;
    if (rest === '') {
      data[key] = [];
      listKey = key;
    } else if (rest.startsWith('[') && rest.endsWith(']')) {
      data[key] = rest.slice(1, -1).split(',').map(unquote).filter(Boolean);
    } else data[key] = scalar(rest);
  }
  return data;
}

const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === '' ? [] : [v]);

// ---------------------------------------------------------------------------
// Delta parser
// ---------------------------------------------------------------------------

const ROW_SPECS = {
  fact: {
    header: /^fact\s+(\S+)(?:\s+§\s*(.+))?$/,
    make: ([, file, section]) => ({ path: file, section: section?.trim() ?? null, minus: [], plus: [] }),
    body(row, text) {
      const m = SIGN_LINE.exec(text);
      if (!m) return "a fact row body holds lines that start with '- ' or '+ ' (a blank row separator is an empty line)";
      const [, sign, rest = ''] = m;
      if (sign === '+') row.plus.push(rest);
      else if (row.plus.length) return "'- ' lines come before '+ ' lines";
      else row.minus.push(rest);
      return null;
    },
    finish: (row) => (row.minus.length || row.plus.length ? null : "a fact row needs '- ' or '+ ' lines"),
  },
  const: {
    header: new RegExp(`^const\\s+(${KEY})\\s+(\\S+)\\s+->\\s+(\\S+)$`),
    make: ([, key, old, next]) => ({ key, old, new: next }),
    body: () => 'a const row has no body; separate rows with a blank line',
  },
  page: {
    header: new RegExp(`^page\\s+(${REPO_REF})\\s+(\\S+)$`),
    make: ([, repo, file]) => ({ repo, path: file, quotes: [], note: '' }),
    body(row, text) {
      const q = QUOTE_LINE.exec(text);
      if (q) row.quotes.push(q[1] ?? '');
      else row.note = row.note ? `${row.note}\n${text}` : text;
      return null;
    },
  },
  none: {
    header: /^none\s+(.+)$/,
    make: ([, text]) => ({ text, note: '' }),
    body(row, text) {
      row.note = row.note ? `${row.note}\n${text}` : text;
      return null;
    },
  },
};
ROW_SPECS.doc = { ...ROW_SPECS.page, header: new RegExp(`^doc\\s+(${REPO_REF})\\s+(\\S+)$`) };

/** The first ```delta block of a markdown file, or the whole text for a bare delta file. */
export function extractDeltaBlock(text) {
  const [first] = fencedBlocks(text, 'delta');
  return first ? first.join('\n') : text.replace(/\r\n/g, '\n');
}

/**
 * @typedef {{ type: 'fact', line: number, kind: string, path: string, section: string | null, minus: string[], plus: string[] }} FactRow
 * @typedef {{ type: 'const', line: number, kind: string, key: string, old: string, new: string }} ConstRow
 * @typedef {{ type: 'page' | 'doc', line: number, kind: string, repo: string, path: string, quotes: string[], note: string }} PageRow
 * @typedef {{ type: 'none', line: number, kind: string, text: string, note: string }} NoneRow
 */

/** @returns {{ base: { repo: string, sha: string } | null, rows: (FactRow | ConstRow | PageRow | NoneRow)[], errors: string[] }} */
export function parseDelta(text, { internal = false } = {}) {
  const rows = [];
  const errors = [];
  let base = null;
  let sawContent = false;
  let cur = null;

  const closeRow = () => {
    if (cur && !cur.skip) {
      const problem = ROW_SPECS[cur.row.type].finish?.(cur.row);
      if (problem) errors.push(`line ${cur.row.line}: ${problem}`);
      else rows.push(cur.row);
    }
    cur = null;
  };

  extractDeltaBlock(text)
    .split('\n')
    .forEach((raw, i) => {
      const line = i + 1;
      const t = raw.trimEnd();
      if (t.trim() === '') return closeRow();
      if (t.startsWith('#')) return;
      if (cur) {
        if (cur.skip) return;
        const problem = ROW_SPECS[cur.row.type].body(cur.row, t);
        if (problem) errors.push(`line ${line}: ${problem}`);
        return;
      }

      const head = t.trim();
      const word = head.split(/\s+/)[0];
      if (word === 'base') {
        if (sawContent) errors.push(`line ${line}: base must be the first line`);
        else {
          const m = BASE_LINE.exec(head);
          if (m) base = { repo: m[1], sha: m[2] };
          else errors.push(`line ${line}: malformed base line, expected "base <owner/repo>@<sha>"`);
        }
        sawContent = true;
        cur = { skip: true };
        return;
      }
      sawContent = true;
      const spec = ROW_SPECS[word];
      if (!spec) {
        errors.push(`line ${line}: unknown row "${word}", expected one of ${Object.keys(ROW_SPECS).join(', ')}`);
        cur = { skip: true };
        return;
      }
      const m = spec.header.exec(head);
      if (!m) {
        errors.push(`line ${line}: malformed ${word} header: ${head}`);
        cur = { skip: true };
        return;
      }
      cur = { row: { type: word, line, kind: kindFor(word, internal), ...spec.make(m) } };
    });
  closeRow();
  return { base, rows, errors };
}

// ---------------------------------------------------------------------------
// Fact rows: apply, NEW tokens
// ---------------------------------------------------------------------------

/** [start, end) of the `## <name>` section: start is the heading line, end is the next `## ` heading or EOF. */
export function sectionRange(lines, name) {
  const start = lines.findIndex((l) => l.trimEnd() === `## ${name}`);
  if (start < 0) return null;
  const next = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return [start, next < 0 ? lines.length : next];
}

/**
 * Applies one fact row to a file's text (null when the file does not exist).
 * `stale` lists '-' lines that are no longer in the file; `error` means the row cannot apply for another reason.
 * @returns {{ text?: string, stale: string[], error?: string }}
 */
export function applyFactRow(text, row) {
  if (text === null) {
    if (row.minus.length) return { stale: [], error: `${row.path} does not exist but the row has '- ' lines` };
    return { text: `${row.plus.join('\n')}\n`, stale: [] };
  }
  const lines = text.split('\n');
  let [from, to] = [0, lines.length];
  if (row.section) {
    const range = sectionRange(lines, row.section);
    if (!range) return { stale: [], error: `no "## ${row.section}" section in ${row.path}` };
    [from, to] = range;
  }

  if (!row.minus.length) {
    if (!row.section) return { stale: [], error: "a row with only '+' lines needs a § section to append to" };
    let at = to;
    while (at > from + 1 && lines[at - 1].trim() === '') at--;
    lines.splice(at, 0, ...row.plus);
    return { text: lines.join('\n'), stale: [] };
  }

  const scope = lines.slice(from, to).map((l) => l.trimEnd());
  const wanted = row.minus.map((l) => l.trimEnd());
  const stale = [...new Set(wanted.filter((l) => !scope.includes(l)))];
  if (stale.length) return { stale };
  const offset = scope.findIndex((_, i) => wanted.every((l, k) => scope[i + k] === l));
  if (offset < 0) return { stale: [], error: `the '- ' lines are not contiguous in ${row.path}` };
  lines.splice(from + offset, wanted.length, ...row.plus);
  return { text: lines.join('\n'), stale: [] };
}

/** NEW tokens a fact row introduces in its '+' lines. */
export function extractNewTokens(plusLines) {
  const tokens = [];
  for (const l of plusLines) {
    for (const m of l.matchAll(NEW_VALUE)) tokens.push({ type: 'value', key: m[1], value: m[2] });
    const flag = NEW_FLAG_FRONTMATTER.exec(l.trim()) ?? /^\s*<!--\s*flag:\s*NEW:(\S+?)\s*-->\s*$/.exec(l);
    if (flag) tokens.push({ type: 'flag', name: flag[1] });
  }
  return tokens;
}

/** Text as it reads once NEW tokens are live: values inlined, NEW flag frontmatter dropped, NEW flag blocks keep the on-branch. */
export function renderNew(text) {
  const lines = text.split('\n');
  const fmEnd = lines[0]?.trimEnd() === '---' ? lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---') : -1;
  const out = [];
  let mode = 'none'; // none | new-on | new-else | other
  lines.forEach((l, i) => {
    if (i <= fmEnd) {
      if (!(i > 0 && i < fmEnd && NEW_FLAG_FRONTMATTER.test(l.trim()))) out.push(l);
      return;
    }
    const open = FLAG_OPEN.exec(l);
    if (open) {
      mode = open[1].startsWith('NEW:') ? 'new-on' : 'other';
      if (mode === 'other') out.push(l);
    } else if (FLAG_ELSE.test(l) && mode.startsWith('new-')) mode = 'new-else';
    else if (FLAG_CLOSE.test(l) && mode !== 'none') {
      if (mode === 'other') out.push(l);
      mode = 'none';
    } else if (mode !== 'new-else') out.push(l);
  });
  return out.join('\n').replace(NEW_VALUE, (_, _key, value) => value);
}

// ---------------------------------------------------------------------------
// Const rows, mirrors, claims
// ---------------------------------------------------------------------------

export function normalizeValue(v) {
  const s = String(v).trim();
  return /^-?\d+(?:\.\d+)?$/.test(s) ? String(Number(s)) : s;
}
export const sameValue = (a, b) => normalizeValue(a) === normalizeValue(b);

/** Lines of `files` (Map path -> text) that use `{{KEY}}` or `{{KEY:format}}`. */
export function findUsedBy(files, key) {
  const use = new RegExp(`\\{\\{${escapeRegExp(key)}(?::\\w+)?\\}\\}`);
  const hits = [];
  for (const [file, text] of files)
    text.split('\n').forEach((l, i) => {
      if (use.test(l)) hits.push({ file, line: i + 1, text: l.trimEnd() });
    });
  return hits;
}

/** Lines in fact files other than the touched fact itself that link to it. */
export function findMirrors(files, ids) {
  const hits = [];
  for (const id of ids) {
    const link = new RegExp(`\\]\\((?:\\.\\./)?${escapeRegExp(id)}\\.md(?=[)#\\s])`);
    for (const [file, text] of files) {
      if (idOf(file) === id) continue;
      text.split('\n').forEach((l, i) => {
        if (link.test(l)) hits.push({ id, file, line: i + 1, text: l.trimEnd() });
      });
    }
  }
  return hits;
}

/**
 * Matches the number as a standalone figure: not part of a longer number (120, 1,20, 20.5), but sentence-final
 * "20." and code like `limit: 20,` count. Null when the old value is not a plain non-negative number.
 */
export function standaloneNumberPattern(old) {
  const s = normalizeValue(old);
  return /^\d+(?:\.\d+)?$/.test(s) ? new RegExp(`(?<!\\d)(?<!\\d[.,])${escapeRegExp(s)}(?!\\d)(?![.,]\\d)`) : null;
}

/** `tags.md#ทำอะไรได้` -> { id: 'tags', section: 'ทำอะไรได้' } */
export function parseCitation(entry) {
  const [file, ...rest] = entry.trim().split('#');
  return { id: idOf(file), file: file.replace(/\.md$/, ''), section: rest.length ? rest.join('#') : null };
}

// ---------------------------------------------------------------------------
// Angle planner
// ---------------------------------------------------------------------------

/**
 * Which angles run. `rows` carry their kind and the opt-in angles of the repo each row targets.
 * Standard and own angles run when a row's kind matches; opt-in (standard:false) angles also need the row's repo to list them.
 */
export function planAngles({ rows, catalog, own = [], skip = {} }) {
  const candidates = new Map();
  for (const a of catalog) candidates.set(a.angle, { ...a, source: 'catalog' });
  for (const a of own) candidates.set(a.angle, { ...a, standard: true, source: 'repo' });

  const run = [];
  const skipped = [];
  for (const a of candidates.values()) {
    const matched = new Set(rows.filter((r) => a.kinds.includes(r.kind) && (a.standard || r.optIns.includes(a.angle))).map((r) => r.kind));
    const because = KINDS.filter((k) => matched.has(k));
    if (!because.length) continue;
    if (Object.hasOwn(skip, a.angle)) skipped.push({ angle: a.angle, reason: skip[a.angle] });
    else run.push({ angle: a.angle, source: a.source, file: a.file, because });
  }
  return { run, skipped };
}

/** Parses one angle file's frontmatter. `standard` is required in the shared catalog only. */
export function parseAngleFile(file, text, { standardRequired = false } = {}) {
  const fm = parseFrontmatter(text);
  const name = path.basename(file);
  if (typeof fm.angle !== 'string' || !fm.angle) return { error: `${name}: frontmatter needs "angle: <NAME>"` };
  if (!Array.isArray(fm.kinds) || !fm.kinds.length || fm.kinds.some((k) => !KINDS.includes(k)))
    return { error: `${name}: "kinds" must be a list from ${KINDS.join(', ')}` };
  if (standardRequired && typeof fm.standard !== 'boolean') return { error: `${name}: frontmatter needs "standard: true|false"` };
  return { angle: { angle: fm.angle, standard: fm.standard === true, kinds: fm.kinds, file } };
}

export function loadAngles(dir, opts) {
  if (!fs.existsSync(dir)) return { angles: [], errors: opts?.standardRequired ? [`angle catalog not found at ${dir}`] : [] };
  const angles = [];
  const errors = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
    const file = path.join(dir, name);
    const r = parseAngleFile(file, fs.readFileSync(file, 'utf8'), opts);
    if (r.error) errors.push(r.error);
    else angles.push(r.angle);
  }
  return { angles, errors };
}

// ---------------------------------------------------------------------------
// Profile (REQUIREMENTS.md)
// ---------------------------------------------------------------------------

const ok = (value) => ({ errors: [], value });
const bad = (message) => ({ errors: [message], value: undefined });
const at = (p, k) => (p ? `${p}.${k}` : k);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const str = (v, p) => (typeof v === 'string' && v.trim() ? ok(v) : bad(`${p}: expected a non-empty string`));
const ownerRepo = (v, p) => (typeof v === 'string' && OWNER_REPO.test(v) ? ok(v) : bad(`${p}: expected "<owner>/<repo>"`));
const posInt = (v, p) => (Number.isInteger(v) && v > 0 ? ok(v) : bad(`${p}: expected a positive integer`));
const isTrue = (v, p) => (v === true ? ok(v) : bad(`${p}: expected true`));
const oneOf = (values) => (v, p) => (values.includes(v) ? ok(v) : bad(`${p}: expected one of ${values.join(', ')}`));
const listOf = (item) => (v, p) => {
  if (!Array.isArray(v)) return bad(`${p}: expected an array`);
  const rs = v.map((x, i) => item(x, `${p}[${i}]`));
  return { errors: rs.flatMap((r) => r.errors), value: rs.map((r) => r.value) };
};
const recordOf = (item) => (v, p) => {
  if (!isObject(v)) return bad(`${p}: expected an object`);
  const rs = Object.entries(v).map(([k, x]) => [k, item(x, at(p, k))]);
  return { errors: rs.flatMap(([, r]) => r.errors), value: Object.fromEntries(rs.map(([k, r]) => [k, r.value])) };
};
/** fields: { key: [required, validator] }. The value comes back with keys in the order of `fields`. */
const shape = (fields) => (v, p) => {
  if (!isObject(v)) return bad(`${p || 'profile'}: expected an object`);
  const errors = Object.keys(v)
    .filter((k) => !Object.hasOwn(fields, k))
    .map((k) => `${at(p, k)}: unknown key`);
  const value = {};
  for (const [k, [required, validate]] of Object.entries(fields)) {
    if (!Object.hasOwn(v, k)) {
      if (required) errors.push(`${at(p, k)}: required`);
      continue;
    }
    const r = validate(v[k], at(p, k));
    errors.push(...r.errors);
    value[k] = r.value;
  }
  return { errors, value };
};

/** A ref git cannot read as an option or a range: starts with a letter or digit, no "..". */
export const isSafeRef = (v) => typeof v === 'string' && SAFE_REF.test(v) && !v.includes('..');
const gitRef = (v, p) => (isSafeRef(v) ? ok(v) : bad(`${p}: expected a plain ref name (letters, digits, . _ / -; no leading dash, no "..")`));

const behavior = (v, p) =>
  isObject(v) && Object.hasOwn(v, 'code')
    ? shape({ code: [true, isTrue] })(v, p)
    : shape({ facts: [true, str], readme: [true, str], placeholders: [true, str], prodRef: [true, gitRef] })(v, p);

const profileShape = (optInAngles) =>
  shape({
    kind: [true, oneOf(['product', 'internal'])],
    team: [true, str],
    states: [true, shape({ land: [true, str] })],
    behavior: [true, behavior],
    factCheck: [false, str],
    claimsAgainst: [false, ownerRepo],
    claimedBy: [
      false,
      listOf(
        shape({
          repo: [true, ownerRepo],
          team: [true, str],
          pages: [true, listOf(str)],
          factsKey: [false, str],
          claims: [false, listOf(str)],
        }),
      ),
    ],
    blast: [false, listOf(shape({ tool: [true, str], counts: [true, str] }))],
    angles: [false, listOf(optInAngles ? oneOf(optInAngles) : str)],
    skip: [false, recordOf(str)],
    size: [false, shape({ epicMax: [true, posInt] })],
  });

/** @returns {{ profile: object | null, errors: string[] }} profile is null when anything is wrong. */
export function parseProfile(text, optInAngles = null) {
  const blocks = fencedBlocks(text, 'json');
  if (blocks.length !== 1)
    return { profile: null, errors: [blocks.length ? `REQUIREMENTS.md has ${blocks.length} json blocks: keep exactly one` : 'REQUIREMENTS.md has no json block'] };
  let obj;
  try {
    obj = JSON.parse(blocks[0].join('\n'));
  } catch (e) {
    return { profile: null, errors: [`REQUIREMENTS.md json block is not valid JSON: ${e.message}`] };
  }
  const r = profileShape(optInAngles)(obj, '');
  return { profile: r.errors.length ? null : r.value, errors: r.errors };
}

export function loadProfile(repoDir, optInAngles = null) {
  const file = path.join(repoDir, 'REQUIREMENTS.md');
  if (!fs.existsSync(file)) return { profile: null, errors: ['no REQUIREMENTS.md: run /product-setup'] };
  return parseProfile(fs.readFileSync(file, 'utf8'), optInAngles);
}

// ---------------------------------------------------------------------------
// IO: git, shell, repo resolution
// ---------------------------------------------------------------------------

const MAX_BUFFER = 256 * 1024 * 1024;

function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: MAX_BUFFER });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: (r.stderr ?? '').trim() };
}

export function normalizeRemote(url) {
  const m = /[:/]([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

function originSlug(dir) {
  const r = git(dir, ['remote', 'get-url', 'origin']);
  return r.ok ? normalizeRemote(r.stdout) : null;
}

const sameRepo = (a, b) => Boolean(a && b) && a.toLowerCase() === b.toLowerCase();
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
const readIfFile = (p) => (isFile(p) ? fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null);

/**
 * `rel` as a normalized repo-relative posix path when it stays under `root/under` (default `root`), else null:
 * an absolute path, a backslash, a ".." segment and anything that resolves outside all fail.
 */
function contained(root, rel, under = '') {
  if (path.isAbsolute(rel) || rel.includes('\\') || rel.split('/').includes('..')) return null;
  const abs = path.resolve(root, rel);
  return abs.startsWith(path.resolve(root, under) + path.sep) ? path.relative(root, abs).split(path.sep).join('/') : null;
}

/**
 * Local checkout for `owner/repo`: PRODUCT_REPO_PATHS, then siblings of this repo, then a blob-less clone in the cache.
 * `via` says which one ('self' for this repo). Only the cache is a checkout the user did not make, so a command from its profile must not run there.
 */
export function makeResolver({ repoDir, env = process.env, cacheRoot = DEFAULT_CACHE_ROOT }) {
  const here = memo(() => originSlug(repoDir));
  const memoized = new Map();

  const find = (slug) => {
    if (sameRepo(here(), slug)) return { dir: repoDir, via: 'self' };
    const matches = (d) => sameRepo(originSlug(d), slug);
    for (const p of (env.PRODUCT_REPO_PATHS ?? '').split(':').filter(Boolean)) {
      if (isDir(p) && matches(path.resolve(p))) return { dir: path.resolve(p), via: 'env' };
    }
    const parent = path.dirname(repoDir);
    for (const name of fs.readdirSync(parent).sort()) {
      const d = path.join(parent, name);
      if (d !== repoDir && fs.existsSync(path.join(d, '.git')) && matches(d)) return { dir: d, via: 'sibling' };
    }
    const cached = path.join(cacheRoot, ...slug.split('/'));
    if (isDir(cached) && matches(cached)) return { dir: cached, via: 'cache' };
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    const r = spawnSync('gh', ['repo', 'clone', slug, cached, '--', '--filter=blob:none'], { encoding: 'utf8', env });
    if (r.error?.code === 'ENOENT') return { error: `no local checkout of ${slug} and gh is not installed: clone it, or add its path to PRODUCT_REPO_PATHS` };
    if (r.status !== 0) return { error: `gh repo clone ${slug} failed: ${tail(r.stderr ?? '', 3)}` };
    return { dir: cached, via: 'cache' };
  };

  return (slug) => {
    if (slug === '.') return { dir: repoDir, via: 'self' };
    if (!memoized.has(slug)) memoized.set(slug, find(slug));
    return memoized.get(slug);
  };
}

const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Runs the profile's placeholders command in `dir` (at `ref` when given) and parses its JSON stdout. */
export function loadPlaceholders(dir, profile, ref) {
  const cmd = profile.behavior.placeholders;
  if (!cmd) return { error: 'profile has no behavior.placeholders command' };
  const r = spawnSync('sh', ['-c', ref ? `${cmd} --ref ${shellQuote(ref)}` : cmd], { cwd: dir, encoding: 'utf8', maxBuffer: MAX_BUFFER });
  if (r.status !== 0) return { error: `placeholders command failed (exit ${r.status}): ${tail(r.stderr || r.stdout || '', 5)}` };
  try {
    return { values: JSON.parse(r.stdout) };
  } catch {
    return { error: 'placeholders command did not print JSON' };
  }
}

function walkMarkdown(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(p, out);
    else if (entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

/** Fact files in the working tree, keyed by repo-relative posix path; the facts README is not a fact. */
function readFactFiles(repoDir, profile) {
  const files = new Map();
  const { facts, readme } = profile.behavior;
  if (!facts || !isDir(path.join(repoDir, facts))) return files;
  for (const abs of walkMarkdown(path.join(repoDir, facts))) {
    const rel = path.relative(repoDir, abs).split(path.sep).join('/');
    if (rel !== readme) files.set(rel, fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'));
  }
  return files;
}

function globFiles(root, patterns) {
  if (typeof fs.globSync !== 'function') throw new Error('this script needs Node 22 or newer (fs.globSync)');
  const found = fs.globSync(patterns, { cwd: root, exclude: (name) => name === 'node_modules' || name === '.git' });
  return [...new Set(found)].sort().filter((rel) => isFile(path.join(root, rel)));
}

// ---------------------------------------------------------------------------
// IO: report
// ---------------------------------------------------------------------------

function analyseFact(row, st) {
  const out = { line: row.line, type: 'fact', kind: row.kind, path: row.path, section: row.section, newFile: false, findings: [], newTokens: extractNewTokens(row.plus) };
  const block = (message) => {
    st.fail(row, message);
    st.blockers.push(`line ${row.line}: ${message}`);
    return out;
  };
  const facts = st.profile.behavior.facts;
  if (!facts) return block('the profile has no facts folder (behavior.code is true)');
  const rel = contained(st.repoDir, row.path, facts);
  if (!rel) return block(`${row.path} is outside the facts folder ${facts}/`);
  out.path = rel;

  const current = st.applied.has(rel) ? st.applied.get(rel) : readIfFile(path.join(st.repoDir, rel));
  out.newFile = current === null;
  const r = applyFactRow(current, row);
  out.findings = r.stale.map((text) => ({ type: 'stale', text }));
  st.touched.add(idOf(rel));
  if (r.error) return block(r.error);
  if (r.text === undefined) st.blockers.push(`line ${row.line}: a '- ' line is stale`);
  else st.applied.set(rel, r.text);
  return out;
}

function analyseConst(row, st) {
  const out = { line: row.line, type: 'const', kind: row.kind, key: row.key, old: row.old, new: row.new, current: null, findings: [], usedBy: [] };
  const loaded = st.values();
  if (loaded.error) st.fail(row, loaded.error);
  else if (!Object.hasOwn(loaded.values, row.key)) out.findings.push({ type: 'unknown-key' });
  else {
    out.current = loaded.values[row.key];
    if (!sameValue(out.current, row.old)) out.findings.push({ type: 'old-mismatch', current: out.current });
  }
  out.usedBy = findUsedBy(st.factFiles(), row.key);
  for (const u of out.usedBy) st.touched.add(idOf(u.file));
  st.constRows.push(row);
  return out;
}

function analysePage(row, st) {
  const out = { line: row.line, type: row.type, kind: row.kind, repo: row.repo, path: row.path, findings: [] };
  const target = st.resolve(row.repo);
  const targetProfile = target.dir ? st.profileOf(target.dir).profile : null;
  st.optIns.set(row, targetProfile ? (targetProfile.angles ?? []) : (st.profile.angles ?? []));
  if (target.error) {
    st.fail(row, target.error);
    return out;
  }
  const rel = contained(target.dir, row.path);
  const text = rel ? readIfFile(path.join(target.dir, rel)) : null;
  if (text === null) {
    st.fail(row, `${row.path} does not exist in ${row.repo === '.' ? 'this repo' : row.repo}`);
    return out;
  }
  out.findings = row.quotes
    .map((q) => q.trimEnd())
    .filter((q) => q && !text.includes(q))
    .map((q) => ({ type: 'stale', text: q }));
  return out;
}

const analyseNone = (row) => ({ line: row.line, type: 'none', kind: row.kind, text: row.text });

const ANALYSERS = { fact: analyseFact, const: analyseConst, page: analysePage, doc: analysePage, none: analyseNone };

function scanClaimedBy(st) {
  const result = { pages: [], claims: [] };
  if (!st.touched.size && !st.constRows.length) return result;
  const hits = new Map(st.constRows.map((r) => [r, 0]));
  for (const entry of st.profile.claimedBy ?? []) {
    const target = st.resolve(entry.repo);
    if (target.error) {
      st.errors.push(`claimedBy ${entry.repo}: ${target.error}`);
      continue;
    }
    const factsKey = entry.factsKey ?? 'facts';
    for (const page of globFiles(target.dir, entry.pages)) {
      const cites = asList(parseFrontmatter(readIfFile(path.join(target.dir, page)) ?? '')[factsKey]).filter((c) => st.touched.has(parseCitation(c).id));
      if (cites.length) result.pages.push({ repo: entry.repo, page, cites });
    }
    const claimFiles = st.constRows.length ? globFiles(target.dir, entry.claims ?? []) : [];
    for (const row of st.constRows) {
      const pattern = standaloneNumberPattern(row.old);
      if (!pattern) continue;
      for (const file of claimFiles) {
        const text = readIfFile(path.join(target.dir, file));
        if (text === null || text.length > 1_000_000) continue;
        for (const [i, l] of text.split('\n').entries()) {
          if (hits.get(row) >= CLAIM_HIT_CAP) break;
          if (!pattern.test(l)) continue;
          hits.set(row, hits.get(row) + 1);
          result.claims.push({ repo: entry.repo, file, line: i + 1, text: l.trim().slice(0, 300), key: row.key });
        }
      }
    }
  }
  return result;
}

/**
 * Parses and checks a delta against the repo's working tree. Returns the report plus what `--check` needs:
 * the fact files with every row applied, and the reasons some row could not be applied.
 */
export function buildReport({ deltaText, repoDir, env = process.env, cacheRoot = DEFAULT_CACHE_ROOT, catalogDir = CATALOG_DIR }) {
  const report = { repo: repoDir, base: null, errors: [], rows: [], mirrors: [], claimedBy: { pages: [], claims: [] }, angles: { run: [], skipped: [] } };
  const catalog = loadAngles(catalogDir, { standardRequired: true });
  const optInNames = catalog.angles.length ? catalog.angles.filter((a) => !a.standard).map((a) => a.angle) : null;

  const profiles = new Map();
  const profileOf = (dir) => {
    if (!profiles.has(dir)) profiles.set(dir, loadProfile(dir, optInNames));
    return profiles.get(dir);
  };
  const { profile, errors: profileErrors } = profileOf(repoDir);
  report.errors.push(...profileErrors);

  const parsed = parseDelta(deltaText, { internal: profile?.kind === 'internal' });
  report.base = parsed.base;
  report.errors.push(...parsed.errors);
  const outcome = { report, applied: new Map(), blockers: [], profile };
  if (!profile) return outcome;
  report.errors.push(...catalog.errors);

  const st = {
    repoDir,
    profile,
    profileOf,
    resolve: makeResolver({ repoDir, env, cacheRoot }),
    applied: outcome.applied,
    blockers: outcome.blockers,
    errors: report.errors,
    touched: new Set(),
    constRows: [],
    optIns: new Map(),
    values: memo(() => loadPlaceholders(repoDir, profile)),
    factFiles: memo(() => readFactFiles(repoDir, profile)),
    fail: (row, message) => report.errors.push(`line ${row.line} (${row.type}): ${message}`),
  };

  report.rows = parsed.rows.map((row) => ANALYSERS[row.type](row, st));
  if (parsed.errors.length) outcome.blockers.push('the delta has lines that do not parse');
  report.mirrors = findMirrors(st.factFiles(), [...st.touched].sort());
  report.claimedBy = scanClaimedBy(st);

  const own = loadAngles(path.join(repoDir, 'requirements'));
  report.errors.push(...own.errors);
  report.angles = planAngles({
    rows: parsed.rows.map((r) => ({ kind: r.kind, optIns: st.optIns.get(r) ?? profile.angles ?? [] })),
    catalog: catalog.angles,
    own: own.angles,
    skip: profile.skip ?? {},
  });
  return outcome;
}

// ---------------------------------------------------------------------------
// IO: --check
// ---------------------------------------------------------------------------

const NEEDS_NODE_MODULES = /Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|node_modules|(?:sh|bash): .*not found/i;

function execFactCheck(cmd, cwd) {
  const r = spawnSync('sh', ['-c', `exec 2>&1\n${cmd}`], { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER, timeout: 10 * 60 * 1000 });
  return { exitCode: r.status ?? 1, output: tail(`${r.stdout ?? ''}${r.error ? `\n${r.error.message}` : ''}`) };
}

/** Runs the profile's factCheck on a scratch worktree with every fact row applied and NEW tokens rendered. */
export function runFactCheck({ repoDir, profile, applied, blockers }) {
  if (!profile.factCheck) return { ran: false, reason: 'the profile has no factCheck' };
  if (blockers.length) return { ran: false, reason: `the delta cannot be applied: ${blockers.join('; ')}` };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-check-'));
  const wt = path.join(tmp, 'wt');
  const link = path.join(wt, 'node_modules');
  let linked = false;
  let result;
  try {
    const add = git(repoDir, ['worktree', 'add', '--detach', wt, 'HEAD']);
    if (!add.ok) return { ran: false, reason: `git worktree add failed: ${add.stderr}` };

    const facts = profile.behavior.facts;
    fs.rmSync(path.join(wt, facts), { recursive: true, force: true });
    if (isDir(path.join(repoDir, facts))) fs.cpSync(path.join(repoDir, facts), path.join(wt, facts), { recursive: true });
    const factsAbs = path.resolve(wt, facts);
    for (const [rel, text] of applied) {
      const dest = path.resolve(wt, rel);
      if (!dest.startsWith(factsAbs + path.sep)) return { ran: false, reason: `${rel} is not under ${facts}/` };
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, renderNew(text));
    }

    let run = execFactCheck(profile.factCheck, wt);
    if (run.exitCode !== 0 && NEEDS_NODE_MODULES.test(run.output) && isDir(path.join(repoDir, 'node_modules'))) {
      fs.symlinkSync(path.join(repoDir, 'node_modules'), link, 'dir');
      linked = true;
      run = execFactCheck(profile.factCheck, wt);
    }
    result = { ran: true, command: profile.factCheck, exitCode: run.exitCode, passed: run.exitCode === 0, output: run.output };
    if (linked) result.nodeModules = 'the scratch worktree had no node_modules, so the root node_modules was symlinked in and the check re-run';
  } finally {
    if (linked) fs.rmSync(link, { force: true });
    const removed = git(repoDir, ['worktree', 'remove', '--force', wt]);
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!removed.ok && result) result.cleanup = `git worktree remove failed: ${removed.stderr}`;
  }
  return result;
}

// ---------------------------------------------------------------------------
// IO: facts command
// ---------------------------------------------------------------------------

/** The cited facts of a claiming page, read at the claimed repo's production ref. */
export function buildFacts({ pagePath, repoDir, env = process.env, cacheRoot = DEFAULT_CACHE_ROOT, catalogDir = CATALOG_DIR }) {
  const failure = (...errors) => ({ ref: null, sha: null, facts: [], errors });
  const catalog = loadAngles(catalogDir, { standardRequired: true });
  const optInNames = catalog.angles.length ? catalog.angles.filter((a) => !a.standard).map((a) => a.angle) : null;

  const mine = loadProfile(repoDir, optInNames);
  if (!mine.profile) return failure(...mine.errors);
  if (!mine.profile.claimsAgainst) return failure('the profile has no claimsAgainst: nothing to read facts from');

  const pageText = readIfFile(path.resolve(repoDir, pagePath));
  if (pageText === null) return failure(`${pagePath} does not exist in ${repoDir}`);

  const slug = mine.profile.claimsAgainst;
  const target = makeResolver({ repoDir, env, cacheRoot })(slug);
  if (target.error) return failure(target.error);
  const theirs = loadProfile(target.dir, optInNames);
  if (!theirs.profile) return failure(`${slug} at ${target.dir}: ${theirs.errors.join('; ')}`);
  const { facts: factsDir, placeholders, prodRef } = theirs.profile.behavior;
  if (!factsDir || !placeholders || !prodRef) return failure(`${slug} has no facts folder, placeholders command and prodRef in its profile`);

  const entry = theirs.profile.claimedBy?.find((c) => sameRepo(c.repo, originSlug(repoDir)));
  const cited = asList(parseFrontmatter(pageText)[entry?.factsKey ?? 'facts']);

  if (!isSafeRef(prodRef)) return failure(`${slug}: prodRef "${prodRef}" is not a plain ref name`);
  const fetched = git(target.dir, ['fetch', '--', 'origin', prodRef]);
  if (!fetched.ok) return failure(`git fetch origin ${prodRef} in ${target.dir} failed: ${fetched.stderr}`);
  const ref = `origin/${prodRef}`;
  const sha = git(target.dir, ['rev-parse', ref]).stdout.trim();

  // A foreign profile's command runs only in a checkout the user already has; the cache clone is read with git show only.
  const errors = [];
  let loaded = { values: {} };
  if (target.via === 'cache')
    errors.push(`${slug} resolved to the cache clone, so its placeholders command was not run. Clone it next to this repo, or add its path to PRODUCT_REPO_PATHS, to read its placeholder values`);
  else {
    loaded = loadPlaceholders(target.dir, theirs.profile, ref);
    if (loaded.error) return failure(loaded.error);
  }

  // A page that cites one section still makes claims the fact's other sections govern (limits live in ข้อจำกัด), so each cited fact is returned whole.
  const byFile = new Map();
  for (const citation of cited) {
    const { id, file, section } = parseCitation(citation);
    if (!byFile.has(file)) {
      const shown = git(target.dir, ['show', `${ref}:${factsDir}/${file}.md`]);
      byFile.set(file, shown.ok ? { id, sections: [], text: shown.stdout.trimEnd() } : null);
      if (!shown.ok) errors.push(`${citation}: ${factsDir}/${file}.md is not at ${ref}`);
    }
    const fact = byFile.get(file);
    if (!fact || !section) continue;
    if (!sectionRange(fact.text.split('\n'), section)) errors.push(`${citation}: no "## ${section}" section at ${ref}`);
    else fact.sections.push(section);
  }
  const facts = [];
  for (const fact of byFile.values()) {
    if (!fact) continue;
    const values = {};
    for (const m of fact.text.matchAll(PLACEHOLDER)) values[m[1]] = Object.hasOwn(loaded.values, m[1]) ? loaded.values[m[1]] : null;
    facts.push({ ...fact, values });
  }
  return { ref, sha, facts, errors };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `usage:
  delta.mjs report <file> [--repo <dir>] [--check]
  delta.mjs profile [--repo <dir>]
  delta.mjs facts <page-path> [--repo <dir>]`;

const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

export function main(argv, { env = process.env, cwd = process.cwd() } = {}) {
  const usage = (message) => {
    process.stderr.write(`${message ? `${message}\n` : ''}${USAGE}\n`);
    return 2;
  };
  let args;
  try {
    args = parseArgs({ args: argv, allowPositionals: true, options: { repo: { type: 'string' }, check: { type: 'boolean' } } });
  } catch (e) {
    return usage(e.message);
  }
  const [command, ...positionals] = args.positionals;
  const wantsFile = command === 'report' || command === 'facts';
  if (!['report', 'profile', 'facts'].includes(command)) return usage(command ? `unknown command "${command}"` : '');
  if (positionals.length !== (wantsFile ? 1 : 0)) return usage(`${command} takes ${wantsFile ? 'exactly one path' : 'no path'}`);
  if (args.values.check && command !== 'report') return usage('--check only applies to report');

  const top = git(path.resolve(cwd, args.values.repo ?? '.'), ['rev-parse', '--show-toplevel']);
  if (!top.ok) return usage(`not a git repository: ${path.resolve(cwd, args.values.repo ?? '.')}`);
  const repoDir = top.stdout.trim();

  if (command === 'profile') {
    const catalog = loadAngles(CATALOG_DIR, { standardRequired: true });
    const { profile, errors } = loadProfile(repoDir, catalog.angles.length ? catalog.angles.filter((a) => !a.standard).map((a) => a.angle) : null);
    print({ ok: errors.length === 0, errors, profile });
    return errors.length ? 1 : 0;
  }

  if (command === 'facts') {
    const result = buildFacts({ pagePath: positionals[0], repoDir, env });
    print(result);
    return result.errors.length ? 1 : 0;
  }

  const file = path.resolve(cwd, positionals[0]);
  if (!isFile(file)) return usage(`no such file: ${file}`);
  const { report, applied, blockers, profile } = buildReport({ deltaText: fs.readFileSync(file, 'utf8'), repoDir, env });
  if (args.values.check && profile) {
    report.check = runFactCheck({ repoDir, profile, applied, blockers });
    if (report.check.ran && !report.check.passed) report.errors.push(`factCheck failed with exit code ${report.check.exitCode}`);
  }
  print(report);
  return report.errors.length ? 1 : 0;
}

const invokedDirectly = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
