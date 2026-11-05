import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyFactRow,
  buildFacts,
  buildReport,
  extractNewTokens,
  findMirrors,
  normalizeRemote,
  parseDelta,
  parseFrontmatter,
  parseProfile,
  planAngles,
  renderNew,
  runFactCheck,
  sameValue,
  standaloneNumberPattern,
} from './delta.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'delta.mjs');

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe('parseDelta rows', () => {
  const cases = [
    [
      'fact that replaces lines',
      'fact docs/a.md § Limits\n- old\n+ new\n+ newer',
      { type: 'fact', line: 1, kind: 'behavior', path: 'docs/a.md', section: 'Limits', minus: ['old'], plus: ['new', 'newer'] },
    ],
    [
      'fact that appends to a section',
      'fact docs/a.md § Limits\n+ added',
      { type: 'fact', line: 1, kind: 'behavior', path: 'docs/a.md', section: 'Limits', minus: [], plus: ['added'] },
    ],
    [
      'fact for a new file keeps a bare + as an empty line',
      'fact docs/new.md\n+ # Title\n+\n+ body',
      { type: 'fact', line: 1, kind: 'behavior', path: 'docs/new.md', section: null, minus: [], plus: ['# Title', '', 'body'] },
    ],
    ['const', 'const BULK_LIMITS.DOWNLOAD_RECEIPTS 20 -> 50', { type: 'const', line: 1, kind: 'limit', key: 'BULK_LIMITS.DOWNLOAD_RECEIPTS', old: '20', new: '50' }],
    [
      'page with quotes and a note',
      'page acme/site src/a.md\n> first quote\n> second quote\nThe wording must match.',
      { type: 'page', line: 1, kind: 'content', repo: 'acme/site', path: 'src/a.md', quotes: ['first quote', 'second quote'], note: 'The wording must match.' },
    ],
    ['doc in this repo', 'doc . docs/guide.md', { type: 'doc', line: 1, kind: 'content', repo: '.', path: 'docs/guide.md', quotes: [], note: '' }],
    ['none with a note', 'none Users land back on the page.\nDetails here.', { type: 'none', line: 1, kind: 'behavior', text: 'Users land back on the page.', note: 'Details here.' }],
  ];
  for (const [name, text, expected] of cases)
    it(name, () => {
      const { rows, errors } = parseDelta(text);
      assert.deepEqual(errors, []);
      assert.deepEqual(rows, [expected]);
    });

  it('a profile of kind internal makes every row internal', () => {
    const text = 'fact a.md\n+ x\n\nconst K 1 -> 2\n\npage . p.md\n\nnone y';
    assert.deepEqual(parseDelta(text, { internal: true }).rows.map((r) => r.kind), ['internal', 'internal', 'internal', 'internal']);
    assert.deepEqual(parseDelta(text).rows.map((r) => r.kind), ['behavior', 'limit', 'content', 'behavior']);
  });

  it('skips comments, separates rows on blank lines and numbers lines from 1 within the block', () => {
    const { rows } = parseDelta('# first\nnone a\n\n# gap\n\nconst K 1 -> 2');
    assert.deepEqual(rows.map((r) => [r.type, r.line]), [['none', 2], ['const', 6]]);
  });

  it('reads the base line', () => {
    const { base, rows } = parseDelta('base acme/product@3f2a1c9\n\nnone x');
    assert.deepEqual(base, { repo: 'acme/product', sha: '3f2a1c9' });
    assert.equal(rows[0].line, 3);
  });

  it('reads only the first delta fence of a markdown card, numbering lines inside the block', () => {
    const card = '# Card\n\nprose\n\n```delta\nnone first\n```\n\n```delta\nnone second\n```\n';
    const { rows } = parseDelta(card);
    assert.deepEqual(rows.map((r) => [r.text, r.line]), [['first', 1]]);
  });

  it('treats a file without a delta fence as a bare delta', () => {
    assert.equal(parseDelta('none only row').rows.length, 1);
  });
});

describe('parseDelta errors', () => {
  const cases = [
    ['an unknown row type', 'frob x y', /line 1: unknown row "frob"/],
    ['a const header with a lowercase key', 'const lower 1 -> 2', /line 1: malformed const header/],
    ['a const header without an arrow', 'const KEY 1 2', /line 1: malformed const header/],
    ['a fact body line without a sign', 'fact a.md\n- x\nplain', /line 3: a fact row body/],
    ["a '- ' line after a '+' line", 'fact a.md\n+ x\n- y', /line 3: '- ' lines come before/],
    ['a body under a const row', 'const K 1 -> 2\nextra', /line 2: a const row has no body/],
    ['a fact row with no lines', 'fact a.md', /line 1: a fact row needs/],
    ['a base line that is not first', 'none x\n\nbase acme/b@abc1234', /line 3: base must be the first line/],
    ['a malformed base line', 'base nope', /line 1: malformed base line/],
    ['a page header without a path', 'page acme/x', /line 1: malformed page header/],
  ];
  for (const [name, text, pattern] of cases)
    it(name, () => {
      assert.match(parseDelta(text).errors.join('\n'), pattern);
    });

  it('does not cascade a bad header into its body and still parses the next row', () => {
    const { rows, errors } = parseDelta('frob\n- x\n+ y\n\nnone ok');
    assert.equal(errors.length, 1);
    assert.deepEqual(rows.map((r) => r.type), ['none']);
  });
});

// ---------------------------------------------------------------------------
// Angle planner
// ---------------------------------------------------------------------------

describe('planAngles', () => {
  const catalog = [
    { angle: 'WHY', standard: true, kinds: ['behavior', 'limit', 'content', 'internal'], file: 'WHY.md' },
    { angle: 'FIT', standard: true, kinds: ['behavior', 'limit'], file: 'FIT.md' },
    { angle: 'SEO', standard: false, kinds: ['content'], file: 'SEO.md' },
  ];
  const names = (plan) => plan.run.map((a) => a.angle);

  it('runs the standard angles whose kinds match and says why', () => {
    const plan = planAngles({ rows: [{ kind: 'limit', optIns: [] }], catalog });
    assert.deepEqual(plan.run.map((a) => [a.angle, a.because]), [['WHY', ['limit']], ['FIT', ['limit']]]);
  });

  it('runs no behavior angle for an internal row', () => {
    assert.deepEqual(names(planAngles({ rows: [{ kind: 'internal', optIns: [] }], catalog })), ['WHY']);
  });

  it('removes a skipped angle and reports its reason, but not a skip that removed nothing', () => {
    const plan = planAngles({ rows: [{ kind: 'behavior', optIns: [] }], catalog, skip: { FIT: 'no rollout here', SEO: 'never' } });
    assert.deepEqual(names(plan), ['WHY']);
    assert.deepEqual(plan.skipped, [{ angle: 'FIT', reason: 'no rollout here' }]);
  });

  it('runs an opt-in angle only for the rows whose target repo lists it', () => {
    const rows = [{ kind: 'content', optIns: ['SEO'] }, { kind: 'behavior', optIns: ['SEO'] }];
    assert.deepEqual(planAngles({ rows, catalog }).run.find((a) => a.angle === 'SEO').because, ['content']);
    assert.equal(names(planAngles({ rows: [{ kind: 'content', optIns: [] }], catalog })).includes('SEO'), false);
  });

  it("runs a repo's own angle when a kind matches, tagged with its source", () => {
    const own = [{ angle: 'LEGAL', kinds: ['behavior'], file: '/r/requirements/LEGAL.md' }];
    const plan = planAngles({ rows: [{ kind: 'behavior', optIns: [] }], catalog, own });
    assert.deepEqual(plan.run.find((a) => a.angle === 'LEGAL'), { angle: 'LEGAL', source: 'repo', file: '/r/requirements/LEGAL.md', because: ['behavior'] });
    assert.equal(names(planAngles({ rows: [{ kind: 'content', optIns: [] }], catalog, own })).includes('LEGAL'), false);
  });
});

// ---------------------------------------------------------------------------
// Applying fact rows and rendering NEW tokens
// ---------------------------------------------------------------------------

describe('applyFactRow', () => {
  const doc = '---\nid: t\n---\n\n## What\n\n- a\n\n## Limits\n\n- one\n- two\n- three\n\n## Not\n\n- n\n';
  const row = (over) => ({ type: 'fact', path: 'f.md', section: 'Limits', minus: [], plus: [], ...over });

  it('replaces the contiguous run of - lines with the + lines', () => {
    const r = applyFactRow(doc, row({ minus: ['- one', '- two'], plus: ['- uno'] }));
    assert.equal(r.text, doc.replace('- one\n- two\n', '- uno\n'));
  });

  it('tolerates trailing whitespace on the - line and nothing else', () => {
    assert.ok(applyFactRow(doc.replace('- one', '- one  '), row({ minus: ['- one'], plus: ['x'] })).text);
    assert.deepEqual(applyFactRow(doc, row({ minus: ['one'], plus: ['x'] })).stale, ['one']);
  });

  it('appends at the end of the section, before its trailing blank lines', () => {
    const r = applyFactRow(doc, row({ plus: ['- four'] }));
    assert.equal(r.text, doc.replace('- three\n', '- three\n- four\n'));
  });

  it('appends at the end of the file when the section is last', () => {
    const r = applyFactRow(doc, row({ section: 'Not', plus: ['- m'] }));
    assert.ok(r.text.endsWith('- n\n- m\n'));
  });

  it('makes the + lines the whole file when the file does not exist', () => {
    assert.equal(applyFactRow(null, row({ section: null, plus: ['# x', 'y'] })).text, '# x\ny\n');
  });

  it('reports a - line that is gone as stale, not as an error', () => {
    const r = applyFactRow(doc, row({ minus: ['- one', '- gone'], plus: ['x'] }));
    assert.deepEqual(r, { stale: ['- gone'] });
  });

  it("errors on a section that does not exist and on - lines that are not contiguous", () => {
    assert.match(applyFactRow(doc, row({ section: 'Nope', plus: ['x'] })).error, /no "## Nope" section/);
    assert.match(applyFactRow(doc, row({ minus: ['- one', '- three'], plus: ['x'] })).error, /not contiguous/);
  });

  it('only looks for - lines inside the named section', () => {
    assert.deepEqual(applyFactRow(doc, row({ minus: ['- a'], plus: ['x'] })).stale, ['- a']);
  });
});

describe('NEW tokens', () => {
  it('extracts value tokens and flag lines from + lines', () => {
    const tokens = extractNewTokens(['limit {{NEW:MAX_PER_DAY=20}} and {{NEW:A.B=x y}}', 'flag: NEW:tag-limits', '<!-- flag: NEW:promo -->', '<!-- flag: existing -->']);
    assert.deepEqual(tokens, [
      { type: 'value', key: 'MAX_PER_DAY', value: '20' },
      { type: 'value', key: 'A.B', value: 'x y' },
      { type: 'flag', name: 'tag-limits' },
      { type: 'flag', name: 'promo' },
    ]);
  });

  it('does not take a lowercase key as a value token', () => {
    assert.deepEqual(extractNewTokens(['{{NEW:max_tags=20}}']), []);
  });

  const rendered = [
    ['inlines a value token', 'a {{NEW:K=20}} b', 'a 20 b'],
    ['drops a NEW flag line in the frontmatter only', '---\nid: t\nflag: NEW:x\n---\n\nflag: NEW:x\n', '---\nid: t\n---\n\nflag: NEW:x\n'],
    [
      'keeps the on-branch of a NEW flag block and drops markers and the else-branch',
      '## S\n\n<!-- flag: NEW:x -->\n\non\n\n<!-- else -->\n\noff\n\n<!-- /flag -->\n\nafter',
      '## S\n\n\non\n\n\nafter',
    ],
    [
      'leaves a flag block that is not NEW alone',
      '<!-- flag: promo -->\non\n<!-- else -->\noff\n<!-- /flag -->',
      '<!-- flag: promo -->\non\n<!-- else -->\noff\n<!-- /flag -->',
    ],
  ];
  for (const [name, input, expected] of rendered) it(name, () => assert.equal(renderNew(input), expected));
});

// ---------------------------------------------------------------------------
// Profile and small pure helpers
// ---------------------------------------------------------------------------

describe('parseProfile', () => {
  const wrap = (obj) => `# Requirements\n\nprose\n\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`\n`;
  const valid = { kind: 'product', team: 'PAY', states: { land: 'In Analysis' }, behavior: { code: true } };

  it('re-serializes the keys in the documented order', () => {
    const scrambled = { behavior: { code: true }, skip: { FIT: 'r' }, states: { land: 'x' }, team: 'T', kind: 'internal', angles: ['SEO'] };
    const { profile, errors } = parseProfile(wrap(scrambled), ['SEO']);
    assert.deepEqual(errors, []);
    assert.deepEqual(Object.keys(profile), ['kind', 'team', 'states', 'behavior', 'angles', 'skip']);
  });

  const withRef = (prodRef) => ({ ...valid, behavior: { facts: 'd', readme: 'd/R.md', placeholders: 'x', prodRef } });

  const bad = [
    ['a prodRef git would read as an option', withRef('--upload-pack=x'), /behavior\.prodRef: expected a plain ref name/],
    ['a prodRef with ".."', withRef('prod..main'), /behavior\.prodRef: expected a plain ref name/],
    ['a prodRef with a shell metacharacter', withRef('prod;x'), /behavior\.prodRef: expected a plain ref name/],
    ['an unknown key', { ...valid, extra: 1 }, /extra: unknown key/],
    ['a missing required key', { kind: 'product', team: 'PAY', behavior: { code: true } }, /states: required/],
    ['a wrong type', { ...valid, team: 7 }, /team: expected a non-empty string/],
    ['a wrong type nested in claimedBy', { ...valid, claimedBy: [{ repo: 'a/b', team: 'X', pages: 'src/*.md' }] }, /claimedBy\[0\]\.pages: expected an array/],
    ['a facts behavior without prodRef', { ...valid, behavior: { facts: 'd', readme: 'd/R.md', placeholders: 'x' } }, /behavior\.prodRef: required/],
    ['an unknown catalog angle', { ...valid, angles: ['NOPE'] }, /angles\[0\]: expected one of SEO/],
  ];
  for (const [name, obj, pattern] of bad)
    it(`rejects ${name}`, () => {
      const { profile, errors } = parseProfile(wrap(obj), ['SEO']);
      assert.equal(profile, null);
      assert.match(errors.join('\n'), pattern);
    });

  it('accepts a branch name with slashes, dots, dashes and underscores as prodRef', () => {
    assert.deepEqual(parseProfile(wrap(withRef('release/v1.2_x-3'))).errors, []);
  });

  it('needs exactly one json block', () => {
    assert.match(parseProfile('no block').errors[0], /no json block/);
    assert.match(parseProfile(`${wrap(valid)}\n${wrap(valid)}`).errors[0], /2 json blocks/);
  });
});

describe('helpers', () => {
  it('normalizes origin URLs to owner/name', () => {
    for (const url of ['git@github.com:acme/site.git', 'https://github.com/acme/site', 'https://github.com/acme/site.git/', 'ssh://git@github.com/acme/site.git', '/tmp/x/acme/site.git'])
      assert.equal(normalizeRemote(url), 'acme/site', url);
  });

  it('compares values as strings with numbers normalized', () => {
    assert.ok(sameValue(20, '20'));
    assert.ok(sameValue('20.0', 20));
    assert.ok(!sameValue(20, '21'));
    assert.ok(sameValue('pro', 'pro'));
  });

  it('matches a number only as a standalone figure', () => {
    const p = standaloneNumberPattern('20');
    for (const yes of ['up to 20 receipts', 'limit: 20,', 'at most 20.', '(20)']) assert.ok(p.test(yes), yes);
    for (const no of ['order 120', '1,20', '20.5', '2020', 'v1.20']) assert.ok(!p.test(no), no);
    assert.equal(standaloneNumberPattern('pro'), null);
  });

  it('reads inline and block lists from frontmatter and ignores nested mappings', () => {
    const fm = parseFrontmatter('---\ntitle: "A"\nsidebar:\n  order: 2\nfacts:\n  - tags.md#x\n  - b.md#y\nkw: [a, b]\nflag: true\n---\nbody');
    assert.deepEqual(fm.facts, ['tags.md#x', 'b.md#y']);
    assert.deepEqual(fm.kw, ['a', 'b']);
    assert.equal(fm.title, 'A');
    assert.equal(fm.flag, true);
  });

  it('finds links to a fact from other facts with and without ../ and an anchor', () => {
    const files = new Map([
      ['facts/tags.md', 'self [t](tags.md)'],
      ['facts/a.md', 'x [t](tags.md#limits) y\nnone [other](tagsx.md)'],
      ['facts/admin/b.md', '[t](../tags.md)'],
    ]);
    assert.deepEqual(findMirrors(files, ['tags']).map((m) => [m.file, m.line]), [['facts/a.md', 1], ['facts/admin/b.md', 1]]);
  });
});

// ---------------------------------------------------------------------------
// Integration: two fixture repos
// ---------------------------------------------------------------------------

const GIT = ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];
const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8' });

function writeFiles(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}

const profileMd = (obj) => `# Requirements\n\n## Users\n\nTest users.\n\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;

const PRODUCT_PROFILE = {
  kind: 'product',
  team: 'ACM',
  states: { land: 'In Analysis' },
  behavior: { facts: 'facts', readme: 'facts/README.md', placeholders: 'node scripts/placeholders.mjs', prodRef: 'prod' },
  factCheck: 'node scripts/check.mjs',
  claimedBy: [{ repo: 'acme/site', team: 'WEB', pages: ['content/**/*.md'], factsKey: 'cites', claims: ['src/*.txt'] }],
  angles: ['BRAND'],
};
const SITE_PROFILE = { kind: 'product', team: 'WEB', states: { land: 'Todo' }, behavior: { code: true }, claimsAgainst: 'acme/product', angles: ['SEO'] };

const TAGS_MAIN = `---
id: tags
title: Tags
---

## What

- Tag your records. Export them: [export](export.md).

## Limits

- Up to {{MAX_TAGS}} tags per business
- Names up to {{NAME_LEN}} characters, emoji allowed
- Bulk edit up to {{BULK.DOWNLOAD}} records

## Not promised

- No shared tags
`;
const TAGS_PROD = TAGS_MAIN.replace('emoji allowed', 'no emoji');

const EXPORT_MD = `---
id: export
title: Export
---

## What

- Download receipts as PDF. Tag rules: [tags](tags.md#limits).

## Limits

- Download up to {{BULK.DOWNLOAD}} receipts at once
`;
const OPS_MD = '---\nid: ops\n---\n\n## What\n\n- Staff read [tags](../tags.md) first.\n\n## Limits\n\n- None\n';

const PLACEHOLDERS_JS = `import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const i = process.argv.indexOf('--ref');
process.stdout.write(i > 0 ? execFileSync('git', ['show', process.argv[i + 1] + ':values.json'], { encoding: 'utf8' }) : readFileSync('values.json', 'utf8'));
`;

const CHECK_JS = `import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
const values = JSON.parse(execFileSync(process.execPath, ['scripts/placeholders.mjs'], { encoding: 'utf8' }));
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk('facts').filter((f) => f.endsWith('.md') && !f.endsWith('README.md'));
const bad = [];
for (const f of files)
  readFileSync(f, 'utf8').split('\\n').forEach((l, i) => {
    if (/^flag: NEW:/.test(l)) bad.push(f + ':' + (i + 1) + ' NEW flag left in frontmatter');
    for (const m of l.matchAll(/\\{\\{([^}]*)\\}\\}/g)) {
      if (m[1].startsWith('NEW:')) bad.push(f + ':' + (i + 1) + ' unrendered NEW token ' + m[0]);
      else if (!(m[1].split(':')[0] in values)) bad.push(f + ':' + (i + 1) + ' unknown placeholder ' + m[0]);
    }
  });
if (bad.length) { console.error(bad.join('\\n')); process.exit(1); }
console.log(files.length + ' fact files OK');
`;

const SITE_FILES = {
  'REQUIREMENTS.md': profileMd(SITE_PROFILE),
  'content/guide/tags.md': '---\ntitle: Tags\ncites:\n  - tags.md#Limits\n  - export.md#What\n---\n\nTag names up to 50 characters, emoji allowed.\n',
  'content/guide/misc.md': '---\ntitle: Misc\ncites: [export.md#What]\n---\n\nbody\n',
  'src/pricing.txt': 'Download up to 20 receipts at once.\nOrder #120 ships today\nprice 1,20 baht\nlimit: 20,\n',
};

let root;
let product;
let site;
let catalogDir;
let env;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-test-'));
  product = path.join(root, 'a', 'product');
  site = path.join(root, 'b', 'site');
  catalogDir = path.join(root, 'catalog');

  writeFiles(catalogDir, {
    'WHY.md': '---\nangle: WHY\nstandard: true\nkinds: [behavior, limit, content, internal]\n---\n',
    'FIT.md': '---\nangle: FIT\nstandard: true\nkinds: [behavior, limit]\n---\n',
    'SEO.md': '---\nangle: SEO\nstandard: false\nkinds: [content]\n---\n',
    'BRAND.md': '---\nangle: BRAND\nstandard: false\nkinds: [content]\n---\n',
  });

  fs.mkdirSync(product, { recursive: true });
  git(product, 'init', '-q');
  writeFiles(product, {
    'REQUIREMENTS.md': profileMd(PRODUCT_PROFILE),
    'facts/README.md': 'Example: [tags](tags.md) holds the real fact.\n',
    'facts/tags.md': TAGS_PROD,
    'facts/export.md': EXPORT_MD,
    'facts/admin/ops.md': OPS_MD,
    'scripts/placeholders.mjs': PLACEHOLDERS_JS,
    'scripts/check.mjs': CHECK_JS,
    'values.json': JSON.stringify({ MAX_TAGS: 25, NAME_LEN: 50, 'BULK.DOWNLOAD': 20 }),
  });
  git(product, 'add', '-A');
  git(product, 'commit', '-qm', 'prod state');
  git(product, 'branch', 'prod');
  const bare = path.join(root, 'remotes', 'acme', 'product.git');
  fs.mkdirSync(bare, { recursive: true });
  git(bare, 'init', '-q', '--bare');
  git(product, 'remote', 'add', 'origin', bare);
  git(product, 'push', '-q', 'origin', 'prod');
  writeFiles(product, { 'facts/tags.md': TAGS_MAIN, 'values.json': JSON.stringify({ MAX_TAGS: 30, NAME_LEN: 50, 'BULK.DOWNLOAD': 20 }) });
  git(product, 'commit', '-qam', 'main moves on');

  fs.mkdirSync(site, { recursive: true });
  git(site, 'init', '-q');
  writeFiles(site, SITE_FILES);
  git(site, 'add', '-A');
  git(site, 'commit', '-qm', 'init');
  git(site, 'remote', 'add', 'origin', 'https://github.com/acme/site');

  env = { ...process.env, PRODUCT_REPO_PATHS: site };
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

const report = (deltaText, over = {}) => buildReport({ deltaText, repoDir: product, env, cacheRoot: path.join(root, 'cache'), catalogDir, ...over });
const cli = (args, over = {}) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env, ...over });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json: r.stdout ? JSON.parse(r.stdout) : null };
};

describe('report: fact rows', () => {
  it('flags a - line that is no longer verbatim as stale, and a verbatim one as not stale', () => {
    const delta = [
      'fact facts/tags.md § Limits',
      '- - Names up to {{NAME_LEN}} characters, no emoji',
      '+ - Names up to {{NAME_LEN}} characters, emoji allowed',
      '',
      'fact facts/tags.md § Limits',
      '- - Names up to {{NAME_LEN}} characters, emoji allowed',
      '+ - Names up to {{NAME_LEN}} characters, any language',
    ].join('\n');
    const { report: r } = report(delta);
    assert.deepEqual(r.rows[0].findings, [{ type: 'stale', text: '- Names up to {{NAME_LEN}} characters, no emoji' }]);
    assert.deepEqual(r.rows[1].findings, []);
    assert.deepEqual(r.errors, [], 'a stale line is a finding, not an error');
  });

  it('lists the NEW tokens a row introduces', () => {
    const { report: r } = report('fact facts/tags.md § Limits\n+ - Up to {{NEW:MAX_PER_DAY=20}} actions per day');
    assert.deepEqual(r.rows[0].newTokens, [{ type: 'value', key: 'MAX_PER_DAY', value: '20' }]);
  });

  it('lists links to the touched fact from other facts, leaving out the facts README and the fact itself', () => {
    const { report: r } = report('fact facts/tags.md § Limits\n+ - Another limit');
    assert.deepEqual(r.mirrors.map((m) => [m.id, m.file]), [['tags', 'facts/admin/ops.md'], ['tags', 'facts/export.md']]);
  });

  it('errors on a fact row for a path outside the facts folder', () => {
    assert.match(report('fact docs/other.md\n+ x').report.errors.join('\n'), /outside the facts folder/);
  });

  it('errors on a fact row path that is absolute, has a ".." segment or a backslash, and applies nothing', () => {
    for (const p of ['facts/../REQUIREMENTS.md', 'facts/../../escape.md', 'facts/sub/../tags.md', '/etc/escape.md', 'facts\\tags.md']) {
      const { report: r, applied, blockers, profile } = report(`fact ${p}\n+ x`);
      assert.match(r.errors.join('\n'), /outside the facts folder/, p);
      assert.equal(applied.size, 0, p);
      assert.equal(runFactCheck({ repoDir: product, profile, applied, blockers }).ran, false, p);
    }
  });

  it('applies rows that spell one file differently to it under one normalized repo-relative path', () => {
    const { report: r, applied } = report('fact facts/./tags.md § Limits\n+ - one\n\nfact facts//tags.md § Limits\n+ - two');
    assert.deepEqual(r.rows.map((row) => row.path), ['facts/tags.md', 'facts/tags.md']);
    assert.deepEqual([...applied.keys()], ['facts/tags.md']);
    assert.match(applied.get('facts/tags.md'), /- one\n- two\n/);
  });
});

describe('report: const rows', () => {
  it('lists every fact line that uses the key and finds no mismatch when the old value is current', () => {
    const { report: r } = report('const BULK.DOWNLOAD 20 -> 50');
    assert.deepEqual(r.rows[0].findings, []);
    assert.deepEqual(r.rows[0].usedBy.map((u) => [u.file, u.line]), [['facts/export.md', 12], ['facts/tags.md', 14]]);
  });

  it('reports old-mismatch with the current value and unknown-key for a key code does not hold', () => {
    const { report: r } = report('const MAX_TAGS 25 -> 40\n\nconst NOPE 1 -> 2');
    assert.deepEqual(r.rows[0].findings, [{ type: 'old-mismatch', current: 30 }]);
    assert.deepEqual(r.rows[1].findings, [{ type: 'unknown-key' }]);
  });
});

describe('report: claimedBy', () => {
  it('lists pages that cite a touched fact, only with the entries that point at it', () => {
    const { report: r } = report('fact facts/tags.md § Limits\n+ - Another limit');
    assert.deepEqual(r.claimedBy.pages, [{ repo: 'acme/site', page: 'content/guide/tags.md', cites: ['tags.md#Limits'] }]);
  });

  it('lists claim-file lines that show the old number of a const row as a standalone figure', () => {
    const { report: r } = report('const BULK.DOWNLOAD 20 -> 50');
    assert.deepEqual(r.claimedBy.claims.map((c) => [c.file, c.line, c.key]), [['src/pricing.txt', 1, 'BULK.DOWNLOAD'], ['src/pricing.txt', 4, 'BULK.DOWNLOAD']]);
    assert.deepEqual(r.claimedBy.pages.map((p) => p.page), ['content/guide/misc.md', 'content/guide/tags.md']);
  });

  it('reports an error, without crashing, for a claimedBy repo with no checkout and no gh', () => {
    const { report: r } = report('fact facts/tags.md § Limits\n+ x', { env: { ...process.env, PRODUCT_REPO_PATHS: '', PATH: '' } });
    assert.match(r.errors.join('\n'), /claimedBy acme\/site: no local checkout of acme\/site and gh is not installed/);
  });
});

describe('report: page rows and angles', () => {
  it('marks a quote that is not in the page as stale and errors on a page that does not exist', () => {
    const { report: r } = report(
      'page acme/site content/guide/tags.md\n> Tag names up to 50 characters, emoji allowed.\n> Tag names up to 99 characters.\n\npage acme/site content/missing.md',
    );
    assert.deepEqual(r.rows[0].findings, [{ type: 'stale', text: 'Tag names up to 99 characters.' }]);
    assert.match(r.errors.join('\n'), /line 5 \(page\): content\/missing\.md does not exist in acme\/site/);
  });

  it('errors on a page or doc row path that is absolute, has a ".." segment or a backslash, even when it lands inside the repo', () => {
    for (const p of ['content/../REQUIREMENTS.md', '/etc/hosts', 'content\\guide\\tags.md'])
      for (const type of ['page', 'doc'])
        assert.match(report(`${type} acme/site ${p}`).report.errors.join('\n'), /does not exist in acme\/site/, `${type} ${p}`);
  });

  it("takes opt-in angles from the profile of the repo a row targets, so a page in site runs SEO and one here runs BRAND", () => {
    const here = report('doc . REQUIREMENTS.md').report.angles.run.map((a) => a.angle);
    const there = report('page acme/site content/guide/misc.md').report.angles.run.map((a) => a.angle);
    assert.deepEqual([here.includes('BRAND'), here.includes('SEO')], [true, false]);
    assert.deepEqual([there.includes('BRAND'), there.includes('SEO')], [false, true]);
  });

  it("falls back to this repo's angles when the target repo has no resolvable profile", () => {
    const { report: r } = report('page acme/ghost x.md', { env: { ...process.env, PRODUCT_REPO_PATHS: '', PATH: '' } });
    assert.ok(r.angles.run.some((a) => a.angle === 'BRAND'));
    assert.match(r.errors.join('\n'), /acme\/ghost/);
  });
});

describe('--check', () => {
  const worktrees = () => git(product, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length;

  it('renders NEW tokens before the factCheck runs, so it passes, and leaves the repo untouched', () => {
    const delta = [
      'fact facts/tags.md § Limits',
      '+ - Up to {{NEW:MAX_PER_DAY=20}} tag actions per day',
      '',
      'fact facts/tags.md',
      '- title: Tags',
      '+ title: Tags',
      '+ flag: NEW:tag-limits',
    ].join('\n');
    const before = git(product, 'status', '--porcelain');
    const { report: r, applied, blockers, profile } = report(delta);
    const check = runFactCheck({ repoDir: product, profile, applied, blockers });
    assert.deepEqual(r.errors, []);
    assert.equal(check.ran, true);
    assert.equal(check.passed, true, check.output);
    assert.match(check.output, /3 fact files OK/);
    assert.equal(git(product, 'status', '--porcelain'), before);
    assert.equal(worktrees(), 1);
  });

  it('fails when a + line carries a NEW token that is not well formed', () => {
    const { applied, blockers, profile } = report('fact facts/tags.md § Limits\n+ - Up to {{NEW:max_tags=20}} per day');
    const check = runFactCheck({ repoDir: product, profile, applied, blockers });
    assert.equal(check.ran, true);
    assert.equal(check.passed, false);
    assert.match(check.output, /unrendered NEW token \{\{NEW:max_tags=20\}\}/);
    assert.equal(worktrees(), 1);
  });

  it('does not run on a delta whose fact row is stale, and says why', () => {
    const { applied, blockers, profile } = report('fact facts/tags.md § Limits\n- - gone line\n+ x');
    const check = runFactCheck({ repoDir: product, profile, applied, blockers });
    assert.equal(check.ran, false);
    assert.match(check.reason, /stale/);
  });

  it('symlinks node_modules into the scratch worktree when the check needs it, says so, and leaves the real one intact', () => {
    const repo = path.join(root, 'c', 'needs-modules');
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    const profile = {
      kind: 'product',
      team: 'T',
      states: { land: 'x' },
      behavior: { facts: 'facts', readme: 'facts/README.md', placeholders: 'echo {}', prodRef: 'prod' },
      factCheck: 'test -d node_modules || { echo "node_modules is missing" >&2; exit 1; }',
    };
    writeFiles(repo, { 'REQUIREMENTS.md': profileMd(profile), 'facts/a.md': '## S\n\n- one\n', '.gitignore': 'node_modules\n' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'init');
    writeFiles(repo, { 'node_modules/keep.txt': 'x' });

    const { applied, blockers, profile: loaded } = report('fact facts/a.md § S\n+ - two', { repoDir: repo });
    const check = runFactCheck({ repoDir: repo, profile: loaded, applied, blockers });
    assert.equal(check.passed, true, check.output);
    assert.match(check.nodeModules, /symlinked/);
    assert.ok(fs.existsSync(path.join(repo, 'node_modules', 'keep.txt')));
  });

  it('refuses to write an applied path outside the facts folder of the scratch worktree', () => {
    const outside = path.join(root, 'outside.txt');
    const { profile } = report('none x');
    for (const rel of [outside, 'facts/../REQUIREMENTS.md', 'facts/../../escape.md']) {
      const check = runFactCheck({ repoDir: product, profile, applied: new Map([[rel, 'x']]), blockers: [] });
      assert.equal(check.ran, false, rel);
      assert.match(check.reason, /is not under facts\//, rel);
    }
    assert.equal(fs.existsSync(outside), false);
    assert.equal(worktrees(), 1);
  });

  it('says so when the profile has no factCheck', () => {
    const check = runFactCheck({ repoDir: product, profile: { behavior: { facts: 'facts' } }, applied: new Map(), blockers: [] });
    assert.deepEqual(check, { ran: false, reason: 'the profile has no factCheck' });
  });
});

describe('facts', () => {
  const facts = () =>
    buildFacts({ pagePath: 'content/guide/tags.md', repoDir: site, env: { ...process.env, PRODUCT_REPO_PATHS: product, PATH: process.env.PATH }, cacheRoot: path.join(root, 'cache'), catalogDir });

  it('reads each cited fact whole at the claimed repo prod ref, not at its working tree', () => {
    const r = facts();
    assert.deepEqual(r.errors, []);
    assert.equal(r.ref, 'origin/prod');
    assert.equal(r.sha, git(product, 'rev-parse', 'origin/prod').trim());
    assert.deepEqual(r.facts.map((f) => [f.id, f.sections]), [['tags', ['Limits']], ['export', ['What']]]);
    assert.match(r.facts[0].text, /no emoji/);
    assert.match(r.facts[0].text, /Not promised/);
  });

  it('gives the placeholder values the text uses, as of the prod ref', () => {
    const [tags] = facts().facts;
    assert.deepEqual(tags.values, { MAX_TAGS: 25, NAME_LEN: 50, 'BULK.DOWNLOAD': 20 });
  });

  it('runs the placeholders command only in a checkout the user already has, never in the cache clone, whose facts are still read', () => {
    const cache = path.join(root, 'cache-clone-root');
    const clone = path.join(cache, 'acme', 'product');
    fs.mkdirSync(path.dirname(clone), { recursive: true });
    git(root, 'clone', '-q', '--branch', 'prod', path.join(root, 'remotes', 'acme', 'product.git'), clone);
    const marker = path.join(root, 'placeholders-ran');
    writeFiles(clone, { 'scripts/placeholders.mjs': `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, 'x');\nprocess.stdout.write('{}');\n` });
    const ask = (paths) => buildFacts({ pagePath: 'content/guide/tags.md', repoDir: site, env: { ...process.env, PRODUCT_REPO_PATHS: paths }, cacheRoot: cache, catalogDir });

    ask(clone);
    assert.ok(fs.existsSync(marker), 'a PRODUCT_REPO_PATHS checkout runs its command');
    fs.rmSync(marker);

    const r = ask('');
    assert.equal(fs.existsSync(marker), false);
    assert.match(r.errors.join('\n'), /acme\/product resolved to the cache clone/);
    assert.match(r.errors.join('\n'), /add its path to PRODUCT_REPO_PATHS, to read its placeholder values/);
    assert.match(r.facts[0].text, /no emoji/);
    assert.deepEqual(r.facts[0].values, { MAX_TAGS: null, NAME_LEN: null, 'BULK.DOWNLOAD': null });
  });
});

describe('CLI', () => {
  it('prints the report and exits 0 when there are no errors, finding the angle catalog next to the skills', () => {
    const file = path.join(root, 'ok.delta');
    fs.writeFileSync(file, 'none Users land back on the page they meant to open.\n');
    const r = cli(['report', file, '--repo', product]);
    assert.equal(r.status, 0, r.stdout);
    assert.ok(r.json.angles.run.some((a) => a.angle === 'WHY'));
  });

  it('exits 1 when the report has errors', () => {
    const file = path.join(root, 'bad.delta');
    fs.writeFileSync(file, 'frob\n');
    assert.equal(cli(['report', file, '--repo', product]).status, 1);
  });

  it('exits 2 on a usage error', () => {
    assert.equal(cli([]).status, 2);
    assert.equal(cli(['report']).status, 2);
    assert.equal(cli(['profile', '--nope']).status, 2);
    assert.equal(cli(['facts', 'p.md', '--check']).status, 2);
  });

  it('says which command to run when the repo has no REQUIREMENTS.md', () => {
    const bare = path.join(root, 'plain');
    fs.mkdirSync(bare);
    git(bare, 'init', '-q');
    const file = path.join(root, 'any.delta');
    fs.writeFileSync(file, 'none x\n');
    const r = cli(['report', file, '--repo', bare]);
    assert.equal(r.status, 1);
    assert.deepEqual(r.json.errors, ['no REQUIREMENTS.md: run /product-setup']);
    assert.deepEqual(cli(['facts', 'a.md', '--repo', bare]).json.errors, ['no REQUIREMENTS.md: run /product-setup']);
  });

  it('profile prints ok and the profile in documented key order', () => {
    const r = cli(['profile', '--repo', product]);
    assert.equal(r.status, 0);
    assert.equal(r.json.ok, true);
    assert.deepEqual(Object.keys(r.json.profile), ['kind', 'team', 'states', 'behavior', 'factCheck', 'claimedBy', 'angles']);
  });
});
