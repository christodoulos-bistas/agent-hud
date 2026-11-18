// Sound cues for the HUD. soundCue() is pure (snapshot in, which cue to play out); createPlayer() plays
// a cue through a synthesised voice (harp call, sparkle resolve) or a custom file, with every browser object injected so the
// tests can fake them. This file must not import hud.js (hud.js imports it).

const STAGES = new Set(['needs', 'turn', 'thinking', 'working', 'idle']);
const STAGE_OF_MOOD = { needs: 'needs', done: 'turn', working: 'working', idle: 'idle' };
// Same rule as hud.js's inTurn: stage turn, or with no stage, mood done.
const inTurn = (a) => (STAGES.has(a?.stage) ? a.stage : STAGE_OF_MOOD[a?.mood]) === 'turn';

// state: { cards: card ids, turn: agent ids in turn, asking: session ids that had a card }. An agent
// entering turn because its card went (a reply sent or declined, a question handed back) already chimed
// "needs" for that card: it is not cued "finished" again (R2).
export function soundCue(prev, snap) {
  const list = Array.isArray(snap?.cards) ? snap.cards : [];
  const cards = new Set(list.map((c) => String(c.id)));
  const asking = new Set(list.filter((c) => c?.sessionId != null).map((c) => String(c.sessionId)));
  const turn = new Set((Array.isArray(snap?.agents) ? snap.agents : []).filter((a) => a && inTurn(a)).map((a) => String(a.id)));
  const state = { cards, turn, asking };
  if (prev == null) return { cue: null, state };
  let cue = null;
  if ([...cards].some((id) => !prev.cards.has(id))) cue = 'needs';
  else if ([...turn].some((id) => !prev.turn.has(id) && !prev.asking?.has(id))) cue = 'finished';
  if (snap?.sound?.muted || snap?.sound?.quiet) cue = null;
  return { cue, state };
}

// ---- The built-in voices (picked by the user from the 18 Nov preview): "Harp call" for needs,
// "Sparkle resolve" for finished. Synthesised, no files; the same notes every time.
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// A soft feedback echo that gives the voices their shimmer; returns the node voices connect to.
function room(c, mix) {
  const input = c.createGain();
  const delay = c.createDelay(1); delay.delayTime.value = 0.13;
  const fb = c.createGain(); fb.gain.value = 0.33;
  const tone = c.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3200;
  const wet = c.createGain(); wet.gain.value = mix;
  input.connect(c.destination);
  input.connect(delay); delay.connect(tone); tone.connect(fb); fb.connect(delay);
  tone.connect(wet); wet.connect(c.destination);
  return input;
}

// A plucked string: a triangle with a fast decay through a closing low-pass.
function pluck(c, out, hz, t, { gain, decay, bright = 4000 }) {
  const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = hz;
  const f = c.createBiquadFilter(); f.type = 'lowpass';
  f.frequency.setValueAtTime(bright, t); f.frequency.exponentialRampToValueAtTime(600, t + decay);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(f); f.connect(g); g.connect(out);
  o.start(t); o.stop(t + decay + 0.05);
}

// A bell: a few inharmonic sine partials, each decaying faster the higher it is.
const BELL = [[1, 1], [2.01, 0.45], [3.02, 0.22], [4.17, 0.12]];
function bell(c, out, hz, t, { gain, decay, partials = BELL }) {
  for (const [ratio, amp] of partials) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = hz * ratio;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * amp, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay / Math.sqrt(ratio));
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + decay + 0.05);
  }
}

// The sparkle: tiny high pings in a fixed pattern (offset s, Hz).
const SPARKLE = [[0, 3100], [0.09, 3900], [0.17, 2700], [0.27, 3500]];

const VOICES = {
  // Harp call: a quick four-note arpeggio, A4 C#5 E5 A5.
  needs(c) {
    const out = room(c, 0.18);
    const t = c.currentTime + 0.02;
    [69, 73, 76, 81].forEach((n, i) => pluck(c, out, midi(n), t + i * 0.075, { gain: 0.15, decay: 0.8 }));
  },
  // Sparkle resolve: three soft bells settling down, C6 A5 F5, then a little sparkle.
  finished(c) {
    const out = room(c, 0.28);
    const t = c.currentTime + 0.02;
    [84, 81, 77].forEach((n, i) => bell(c, out, midi(n), t + i * 0.12, { gain: 0.07, decay: 1.0 }));
    for (const [dt, hz] of SPARKLE) bell(c, out, hz, t + 0.35 + dt, { gain: 0.025, decay: 0.25, partials: [[1, 1], [2.7, 0.3]] });
  },
};

export function createPlayer({ makeContext, makeAudio, makeUrl, revokeUrl }) {
  let ctx = null;
  const custom = new Map(); // cue -> { url }

  function synth(cue) {
    const voice = VOICES[cue];
    if (!voice) return;
    ctx ??= makeContext();
    if (ctx.state === 'suspended') ctx.resume?.();
    voice(ctx);
  }

  function play(cue) {
    if (!cue) return;
    try {
      const c = custom.get(cue);
      if (!c) { synth(cue); return; }
      let fell = false;
      const fallback = () => { if (fell) return; fell = true; try { synth(cue); } catch { /* silent */ } };
      try {
        const audio = makeAudio(c.url);
        audio.addEventListener('error', fallback);
        Promise.resolve(audio.play()).catch(fallback);
      } catch { fallback(); }
    } catch { /* a sound failure never breaks the HUD */ }
  }

  function setCustom(cue, file) {
    const old = custom.get(cue);
    if (old) { revokeUrl(old.url); custom.delete(cue); }
    if (file) custom.set(cue, { url: makeUrl(new Blob([file.bytes], { type: file.mime })) });
  }

  return { play, setCustom };
}
