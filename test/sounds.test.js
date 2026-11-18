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

const param = (v = 0) => { const p = { value: v, setValueAtTime(x) { p.value = x; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }; return p; };
const fakeCtx = () => {
  const osc = [];
  const gains = [];
  const node = (extra = {}) => ({ connect(n) { return n; }, ...extra });
  const ctx = {
    currentTime: 0, destination: node(),
    createOscillator() {
      const o = node({ type: '', frequency: param(), start() {}, stop() {} });
      osc.push(o); return o;
    },
    createGain() { const g = node({ gain: param(1) }); gains.push(g); return g; },
    createDelay() { return node({ delayTime: param() }); },
    createBiquadFilter() { return node({ type: '', frequency: param(350), Q: param(1) }); },
  };
  return { ctx, osc, gains };
};
const file = { bytes: new Uint8Array([1, 2]), mime: 'audio/wav' };
const near = (a, b) => Math.abs(a - b) < 0.05;

test('needs plays the harp call: four plucked notes, A4 C#5 E5 A5, rising', () => {
  const { ctx, osc } = fakeCtx();
  createPlayer({ makeContext: () => ctx }).play('needs');
  assert.equal(osc.length, 4);
  assert.ok(osc.every((o) => o.type === 'triangle'));
  [440, 554.37, 659.26, 880].forEach((hz, i) => assert.ok(near(osc[i].frequency.value, hz), `note ${i}: ${osc[i].frequency.value}`));
});

test('finished plays sparkle resolve: three soft bells settling down (C6 A5 F5) plus a sparkle', () => {
  const { ctx, osc } = fakeCtx();
  createPlayer({ makeContext: () => ctx }).play('finished');
  assert.ok(osc.length > 4);
  assert.ok(osc.every((o) => o.type === 'sine'));
  const hz = osc.map((o) => o.frequency.value);
  for (const f of [1046.5, 880, 698.46]) assert.ok(hz.some((h) => near(h, f)), `bell ${f}`);
  assert.ok(hz.some((h) => h > 2400), 'a sparkle above the bells');
});

test('the voices are the same every time (no randomness)', () => {
  const a = fakeCtx(); const b = fakeCtx();
  createPlayer({ makeContext: () => a.ctx }).play('finished');
  createPlayer({ makeContext: () => b.ctx }).play('finished');
  assert.deepEqual(a.osc.map((o) => o.frequency.value), b.osc.map((o) => o.frequency.value));
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
  assert.ok(osc.length > 0);
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
  assert.ok(osc.length > 0);
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
  assert.ok(osc.length > 0);
});

test('a suspended context is resumed and the notes are still scheduled', () => {
  const { ctx, osc } = fakeCtx();
  let resumed = 0;
  ctx.state = 'suspended';
  ctx.resume = () => { resumed++; return Promise.resolve(); };
  createPlayer({ makeContext: () => ctx }).play('needs');
  assert.equal(resumed, 1);
  assert.ok(osc.length > 0);
});

test('a synchronous throw from makeAudio falls back to the synth', () => {
  const { ctx, osc } = fakeCtx();
  const p = createPlayer({ makeContext: () => ctx, makeAudio: () => { throw new Error('boom'); }, makeUrl: () => 'blob:x', revokeUrl() {} });
  p.setCustom('needs', file);
  p.play('needs');
  assert.ok(osc.length > 0);
});

test('a synchronous throw from audio.play() falls back to the synth', () => {
  const { ctx, osc } = fakeCtx();
  const p = createPlayer({ makeContext: () => ctx, makeAudio: () => ({ play() { throw new Error('boom'); }, addEventListener() {} }), makeUrl: () => 'blob:x', revokeUrl() {} });
  p.setCustom('needs', file);
  p.play('needs');
  assert.ok(osc.length > 0);
});

test('setCustom with a new file revokes the old URL', () => {
  const revoked = []; let n = 0;
  const p = createPlayer({ makeContext: () => fakeCtx().ctx, makeAudio: () => ({ play: () => Promise.resolve(), addEventListener() {} }), makeUrl: () => 'blob:' + (++n), revokeUrl: (u) => revoked.push(u) });
  p.setCustom('needs', file);
  p.setCustom('needs', file);
  assert.deepEqual(revoked, ['blob:1']);
});

test('R2: an agent whose card just went (reply sent, "No reply", hand-back) entering turn is not cued finished', () => {
  const s0 = soundCue(null, snap()).state;
  const asked = soundCue(s0, snap({ cards: [{ id: 'r1', sessionId: 'a' }], agents: [{ id: 'a', stage: 'needs' }, { id: 'b', stage: 'working' }] }));
  assert.equal(asked.cue, 'needs');
  assert.deepEqual([...asked.state.asking], ['a']);
  const gone = soundCue(asked.state, snap({ agents: [{ id: 'a', stage: 'turn' }, { id: 'b', stage: 'working' }] }));
  assert.equal(gone.cue, null, 'the reply card going away is not a second chime');
  assert.deepEqual([...gone.state.asking], [], 'the state still advances');
  assert.deepEqual([...gone.state.turn], ['a']);
  // Another agent finishing in the same push still chimes.
  const both = soundCue(asked.state, snap({ agents: [{ id: 'a', stage: 'turn' }, { id: 'b', stage: 'turn' }] }));
  assert.equal(both.cue, 'finished');
  // Later, a turn that ends with no card in the snapshot before it chimes as usual.
  const work = soundCue(gone.state, snap({ agents: [{ id: 'a', stage: 'working' }, { id: 'b', stage: 'working' }] }));
  assert.equal(soundCue(work.state, snap({ agents: [{ id: 'a', stage: 'turn' }, { id: 'b', stage: 'working' }] })).cue, 'finished');
});
