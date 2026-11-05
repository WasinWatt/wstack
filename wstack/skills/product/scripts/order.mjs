#!/usr/bin/env node
// Draws an epic's order of work as a mermaid graph: one column per wave, so
// everything in a column can run at the same time, and each arrow is labeled
// with the output the next card waits on. A plain-text list of the same waves
// follows, for places that show the description without rendering mermaid.
//
// Input (JSON file or stdin):
//   { "children": [ { "id": "PAY-1", "title": "short outcome",
//                     "blockedBy": [ { "id": "PAY-0", "needs": "what PAY-1 needs from PAY-0" } ] } ],
//     "done": "one-line end-to-end check" }
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const nodeId = (id) => 'n_' + id.replace(/[^A-Za-z0-9]/g, '_');
// Both outputs put each value on one line, so a value never splits a list line.
const oneLine = (s) => String(s).replace(/\s*[\r\n]+\s*/g, ' ').trim();
// Mermaid labels are quoted and rendered as HTML: a raw quote would end them
// early, and a raw angle bracket would be read as a tag.
const label = (s) => oneLine(s).replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');

/** Returns the reason the input cannot be drawn, or null when its shape is fine. */
function shapeError(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input is not an object';
  if (!Array.isArray(input.children)) return 'children is not a list';
  for (const c of input.children) {
    if (c && c.blockedBy !== undefined && !Array.isArray(c.blockedBy)) return `${c.id}: blockedBy is not a list`;
    if (c && (c.blockedBy ?? []).some((b) => !b || typeof b !== 'object')) return `${c.id}: a blockedBy entry is not an object`;
  }
  return null;
}

/** Returns { waves: string[][], errors: string[] }. waves[0] needs nothing. */
export function computeWaves(children) {
  const shape = shapeError({ children });
  if (shape) return { waves: [], errors: [shape] };
  const errors = [];
  const byId = new Map();
  for (const c of children) {
    if (!c || typeof c.id !== 'string' || !c.id) { errors.push('a child has no id'); continue; }
    if (byId.has(c.id)) errors.push(`${c.id} is listed twice`);
    byId.set(c.id, c);
  }
  for (const c of byId.values()) {
    for (const b of c.blockedBy ?? []) {
      if (!byId.has(b.id)) errors.push(`${c.id} is blocked by ${b.id}, which is not a child`);
      else if (b.id === c.id) errors.push(`${c.id} is blocked by itself`);
      if (!b.needs || !String(b.needs).trim()) errors.push(`${c.id} ← ${b.id} does not say what it needs`);
    }
  }
  if (errors.length) return { waves: [], errors };

  const wave = new Map();
  const visiting = new Set();
  const depth = (id) => {
    if (wave.has(id)) return wave.get(id);
    if (visiting.has(id)) throw new Error(`cycle through ${id}`);
    visiting.add(id);
    const blockers = byId.get(id).blockedBy ?? [];
    const w = blockers.length ? 1 + Math.max(...blockers.map((b) => depth(b.id))) : 0;
    visiting.delete(id);
    wave.set(id, w);
    return w;
  };
  try {
    for (const id of byId.keys()) depth(id);
  } catch (e) {
    return { waves: [], errors: [e.message] };
  }
  const waves = [];
  for (const [id, w] of wave) (waves[w] ??= []).push(id);
  return { waves, errors: [] };
}

function waveTitle(i, size) {
  if (i === 0) return size > 1 ? '1 · Start now, in parallel' : '1 · Start now';
  return size > 1 ? `${i + 1} · Then, in parallel` : `${i + 1} · Then`;
}

/** Returns { mermaid, list, errors }. */
export function renderOrder(input) {
  const shape = shapeError(input);
  if (shape) return { mermaid: '', list: '', errors: [shape] };
  const { children, done } = input;
  const { waves, errors } = computeWaves(children);
  if (errors.length) return { mermaid: '', list: '', errors };
  const byId = new Map(children.map((c) => [c.id, c]));
  const blocksSomething = new Set(children.flatMap((c) => (c.blockedBy ?? []).map((b) => b.id)));

  const out = ['graph LR'];
  waves.forEach((ids, i) => {
    out.push(`  subgraph w${i + 1}["${waveTitle(i, ids.length)}"]`);
    for (const id of ids) out.push(`    ${nodeId(id)}["<b>${label(id)}</b><br/>${label(byId.get(id).title ?? '')}"]`);
    out.push('  end');
  });
  if (done) {
    out.push(`  subgraph wdone["${waves.length + 1} · Done when"]`);
    out.push(`    done["${label(done)}"]`);
    out.push('  end');
  }
  for (const c of children) {
    for (const b of c.blockedBy ?? []) out.push(`  ${nodeId(b.id)} -->|"${label(b.needs)}"| ${nodeId(c.id)}`);
  }
  if (done) {
    for (const c of children) if (!blocksSomething.has(c.id)) out.push(`  ${nodeId(c.id)} -.-> done`);
    out.push('  classDef doneNode stroke-dasharray: 4 3');
    out.push('  class done doneNode');
  }
  const list = waves.map((ids, i) => {
    const cards = ids.map((id) => {
      const needs = (byId.get(id).blockedBy ?? []).map((b) => `${oneLine(b.needs)} from ${b.id}`);
      return needs.length ? `${id} (needs ${needs.join(', ')})` : id;
    });
    return `${waveTitle(i, ids.length)}: ${cards.join(', ')}`;
  });
  if (done) list.push(`${waves.length + 1} · Done when: ${oneLine(done)}`);
  return { mermaid: out.join('\n'), list: list.join('\n'), errors: [] };
}

export function main(argv, { stdin = () => fs.readFileSync(0, 'utf8') } = {}) {
  const file = argv[0];
  let input;
  try {
    input = JSON.parse(file && file !== '-' ? fs.readFileSync(file, 'utf8') : stdin());
  } catch (e) {
    process.stderr.write(`order: cannot read input: ${e.message}\n`);
    return 2;
  }
  const { mermaid, list, errors } = renderOrder(input);
  if (errors.length) {
    process.stderr.write(errors.map((e) => `order: ${e}`).join('\n') + '\n');
    return 1;
  }
  process.stdout.write('```mermaid\n' + mermaid + '\n```\n\n```text\n' + list + '\n```\n');
  return 0;
}

const invokedDirectly = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
