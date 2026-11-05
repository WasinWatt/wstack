import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { computeWaves, renderOrder } from './order.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'order.mjs');

const EPIC = {
  children: [
    { id: 'A-1', title: 'routes on HttpApi' },
    { id: 'A-2', title: '/v1 paths' },
    { id: 'A-3', title: 'API keys', blockedBy: [{ id: 'A-2', needs: '/v1 routes' }] },
    { id: 'A-4', title: 'error contract', blockedBy: [{ id: 'A-1', needs: 'HttpApi error schema' }] },
    {
      id: 'A-5',
      title: 'docs',
      blockedBy: [
        { id: 'A-1', needs: 'openapi.json' },
        { id: 'A-4', needs: 'error codes' },
      ],
    },
    { id: 'A-6', title: 'pagination' },
  ],
  done: 'keys read every GET',
};

describe('computeWaves', () => {
  it('puts each card one column after its latest blocker', () => {
    const { waves, errors } = computeWaves(EPIC.children);
    assert.deepEqual(errors, []);
    assert.deepEqual(waves, [['A-1', 'A-2', 'A-6'], ['A-3', 'A-4'], ['A-5']]);
  });

  it('rejects an unknown blocker, a missing need and a cycle', () => {
    assert.match(computeWaves([{ id: 'X', blockedBy: [{ id: 'Y', needs: 'n' }] }]).errors[0], /not a child/);
    assert.match(computeWaves([{ id: 'X' }, { id: 'Y', blockedBy: [{ id: 'X' }] }]).errors[0], /does not say what it needs/);
    const cyc = [
      { id: 'X', blockedBy: [{ id: 'Y', needs: 'n' }] },
      { id: 'Y', blockedBy: [{ id: 'X', needs: 'n' }] },
    ];
    assert.match(computeWaves(cyc).errors[0], /cycle/);
  });
});

describe('renderOrder', () => {
  const { mermaid } = renderOrder(EPIC);

  it('draws one titled column per wave and a done column', () => {
    assert.match(mermaid, /^graph LR/);
    assert.match(mermaid, /subgraph w1\["1 · Start now, in parallel"\]/);
    assert.match(mermaid, /subgraph w3\["3 · Then"\]/);
    assert.match(mermaid, /subgraph wdone\["4 · Done when"\]/);
  });

  it('labels each arrow with what the next card needs', () => {
    assert.match(mermaid, /n_A_1 -->\|"openapi.json"\| n_A_5/);
    assert.match(mermaid, /n_A_2 -->\|"\/v1 routes"\| n_A_3/);
  });

  it('feeds only the cards that block nothing into done', () => {
    const into = [...mermaid.matchAll(/(n_\w+) -.-> done/g)].map((m) => m[1]).sort();
    assert.deepEqual(into, ['n_A_3', 'n_A_5', 'n_A_6']);
  });

  it('lists the same waves as text, with what each card needs', () => {
    assert.equal(
      renderOrder(EPIC).list,
      [
        '1 · Start now, in parallel: A-1, A-2, A-6',
        '2 · Then, in parallel: A-3 (needs /v1 routes from A-2), A-4 (needs HttpApi error schema from A-1)',
        '3 · Then: A-5 (needs openapi.json from A-1, error codes from A-4)',
        '4 · Done when: keys read every GET',
      ].join('\n'),
    );
  });

  it('escapes quotes in labels', () => {
    const r = renderOrder({ children: [{ id: 'Q', title: 'say "hi"' }] });
    assert.match(r.mermaid, /say #quot;hi#quot;/);
    assert.doesNotMatch(r.mermaid, /done/);
  });
});

describe('cli', () => {
  it('prints a mermaid fence from stdin', () => {
    const r = spawnSync('node', [SCRIPT], { input: JSON.stringify(EPIC), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^```mermaid\ngraph LR/);
    assert.match(r.stdout, /```text\n1 · Start now, in parallel: A-1, A-2, A-6\n/);
  });

  it('exits 1 with the errors on a bad graph', () => {
    const bad = { children: [{ id: 'X', blockedBy: [{ id: 'Y', needs: 'n' }] }] };
    const r = spawnSync('node', [SCRIPT], { input: JSON.stringify(bad), encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a child/);
  });
});
