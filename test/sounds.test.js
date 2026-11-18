import test from 'node:test'; import assert from 'node:assert/strict';
import { soundCue, createPlayer } from '../src/renderer/sounds.js';

const snap = (o = {}) => ({ cards: [], agents: [], tucked: [], ...o });

test('soundCue seeds on the first snapshot and plays nothing', () => {
  const r = soundCue(null, snap({ cards: [{ id: 'c1' }], agents: [{ id: 'a', stage: 'turn' }] }));
  assert.equal(r.cue, null);
  assert.deepEqual([...r.state.cards], ['c1']);
  assert.deepEqual([...r.state.turn], ['a']);
});

test('a new card plays needs; the same card again is silent', () => {
  const s0 = soundCue(null, snap()).state;
  const r = soundCue(s0, snap({ cards: [{ id: 'c1' }] }));
  assert.equal(r.cue, 'needs');
  assert.equal(soundCue(r.state, snap({ cards: [{ id: 'c1' }] })).cue, null);
});

test('needs beats finished when both happen at once', () => {
  const s0 = soundCue(null, snap()).state;
  const r = soundCue(s0, snap({ cards: [{ id: 'c1' }], agents: [{ id: 'a', stage: 'turn' }] }));
  assert.equal(r.cue, 'needs');
});

test('an agent entering turn plays finished; mood done with no stage counts', () => {
  const s0 = soundCue(null, snap({ agents: [{ id: 'a', stage: 'working' }, { id: 'b', mood: 'working' }] })).state;
  assert.equal(soundCue(s0, snap({ agents: [{ id: 'a', stage: 'turn' }, { id: 'b', mood: 'working' }] })).cue, 'finished');
  assert.equal(soundCue(s0, snap({ agents: [{ id: 'a', stage: 'working' }, { id: 'b', mood: 'done' }] })).cue, 'finished');
});

test('a tucked agent finishing is silent', () => {
  const s0 = soundCue(null, snap()).state;
  assert.equal(soundCue(s0, snap({ tucked: [{ id: 'a', stage: 'turn' }] })).cue, null);
});

test('muted or quiet silences the cue but the state still advances', () => {
  const s0 = soundCue(null, snap()).state;
  for (const sound of [{ muted: true }, { quiet: true }]) {
    const r = soundCue(s0, snap({ sound, cards: [{ id: 'c1' }] }));
    assert.equal(r.cue, null);
    assert.ok(r.state.cards.has('c1'));
    assert.equal(soundCue(r.state, snap({ cards: [{ id: 'c1' }] })).cue, null);
  }
});

const fakeCtx = () => {
  const osc = [];
  const gains = [];
  const ctx = {
    currentTime: 0, destination: {},
    createOscillator() {
      const o = { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
      osc.push(o); return o;
    },
    createGain() {
      const g = { gain: { value: 0, setValueAtTime(v) { g.gain.value = v; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      gains.push(g); return g;
    },
  };
  return { ctx, osc, gains };
};
const file = { bytes: new Uint8Array([1, 2]), mime: 'audio/wav' };

test('the synth plays two notes per cue at the set frequencies', () => {
  const { ctx, osc } = fakeCtx();
  const p = createPlayer({ makeContext: () => ctx });
  p.play('needs');
  assert.deepEqual(osc.map((o) => o.frequency.value), [660, 880]);
  p.play('finished');
  assert.deepEqual(osc.slice(2).map((o) => o.frequency.value), [523, 784]);
});

test('a rejected play() of a custom file falls back to the synth', async () => {
  const { ctx, osc } = fakeCtx();
  const p = createPlayer({
    makeContext: () => ctx,
    makeAudio: () => ({ play: () => Promise.reject(new Error('nope')), addEventListener() {} }),
    makeUrl: () => 'blob:x', revokeUrl() {},
  });
  p.setCustom('needs', file);
  p.play('needs');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(osc.length, 2);
});

test('an error event on the custom audio falls back to the synth', () => {
  const { ctx, osc } = fakeCtx();
  let onError;
  const p = createPlayer({
    makeContext: () => ctx,
    makeAudio: () => ({ play: () => new Promise(() => {}), addEventListener: (n, f) => { if (n === 'error') onError = f; } }),
    makeUrl: () => 'blob:x', revokeUrl() {},
  });
  p.setCustom('finished', file);
  p.play('finished');
  onError();
  assert.equal(osc.length, 2);
});

test('setCustom(cue, null) reverts to the synth and revokes the old URL', () => {
  const { ctx, osc } = fakeCtx();
  const revoked = []; let audios = 0;
  const p = createPlayer({
    makeContext: () => ctx,
    makeAudio: () => { audios++; return { play: () => Promise.resolve(), addEventListener() {} }; },
    makeUrl: () => 'blob:old', revokeUrl: (u) => revoked.push(u),
  });
  p.setCustom('needs', file);
  p.play('needs');
  assert.equal(audios, 1); assert.equal(osc.length, 0);
  p.setCustom('needs', null);
  assert.deepEqual(revoked, ['blob:old']);
  p.play('needs');
  assert.equal(osc.length, 2);
});

test('a suspended context is resumed and the notes are still scheduled', () => {
  const { ctx, osc } = fakeCtx();
  let resumed = 0;
  ctx.state = 'suspended';
  ctx.resume = () => { resumed++; return Promise.resolve(); };
  createPlayer({ makeContext: () => ctx }).play('needs');
  assert.equal(resumed, 1);
  assert.equal(osc.length, 2);
});

test('a synchronous throw from makeAudio falls back to the synth', () => {
  const { ctx, osc } = fakeCtx();
  const p = createPlayer({ makeContext: () => ctx, makeAudio: () => { throw new Error('boom'); }, makeUrl: () => 'blob:x', revokeUrl() {} });
  p.setCustom('needs', file);
  p.play('needs');
  assert.equal(osc.length, 2);
});

test('a synchronous throw from audio.play() falls back to the synth', () => {
  const { ctx, osc } = fakeCtx();
  const p = createPlayer({ makeContext: () => ctx, makeAudio: () => ({ play() { throw new Error('boom'); }, addEventListener() {} }), makeUrl: () => 'blob:x', revokeUrl() {} });
  p.setCustom('needs', file);
  p.play('needs');
  assert.equal(osc.length, 2);
});

test('setCustom with a new file revokes the old URL', () => {
  const revoked = []; let n = 0;
  const p = createPlayer({ makeContext: () => fakeCtx().ctx, makeAudio: () => ({ play: () => Promise.resolve(), addEventListener() {} }), makeUrl: () => 'blob:' + (++n), revokeUrl: (u) => revoked.push(u) });
  p.setCustom('needs', file);
  p.setCustom('needs', file);
  assert.deepEqual(revoked, ['blob:1']);
});
