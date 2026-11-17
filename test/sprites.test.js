import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLASSES, CODEX_PAL, CODEX_BODY, CODEX_FAMILIAR, codexOf, spriteSvg } from '../src/renderer/sprites.js';

const claude = JSON.parse(readFileSync(new URL('./fixtures/claude-sprites.json', import.meta.url), 'utf8'));
const ids = CLASSES.map((c) => c.id);

test('Claude sprites are byte-identical to the pre-Codex output', () => {
  assert.equal(ids.length, 12);
  for (const id of ids) {
    assert.equal(spriteSvg(id, 2), claude[id]['2'], id);
    assert.equal(spriteSvg(id, 1.5), claude[id]['1.5'], id);
    assert.equal(spriteSvg(id, 2, { source: 'claude' }), claude[id]['2'], id);
  }
});

test('Codex sprite differs from Claude and carries the mint accent for every class', () => {
  for (const id of ids) {
    const svg = spriteSvg(id, 2, { source: 'codex' });
    assert.notEqual(svg, spriteSvg(id, 2), id);
    assert.ok(svg.includes('#8ef5c6'), id);
  }
});

test('Codex Summoner has no Claude critter colour', () => {
  assert.ok(!spriteSvg('summoner', 2, { source: 'codex' }).includes('#D97757'));
  assert.ok(spriteSvg('summoner', 2).includes('#D97757'));
});

test('exports: palette, body, familiar, codexOf', () => {
  assert.equal(CODEX_PAL.M, '#8ef5c6');
  assert.ok(CODEX_BODY.length && CODEX_FAMILIAR.noBody);
  assert.equal(codexOf(CLASSES[0]).body, CODEX_BODY);
});
