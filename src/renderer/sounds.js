// Sound cues for the HUD. soundCue() is pure (snapshot in, which cue to play out); createPlayer() plays
// a cue through a synthesised two-note chime or a custom file, with every browser object injected so the
// tests can fake them. This file must not import hud.js (hud.js imports it).

const STAGES = new Set(['needs', 'turn', 'thinking', 'working', 'idle']);
const STAGE_OF_MOOD = { needs: 'needs', done: 'turn', working: 'working', idle: 'idle' };
// Same rule as hud.js's inTurn: stage turn, or with no stage, mood done.
const inTurn = (a) => (STAGES.has(a?.stage) ? a.stage : STAGE_OF_MOOD[a?.mood]) === 'turn';

export function soundCue(prev, snap) {
  const cards = new Set((Array.isArray(snap?.cards) ? snap.cards : []).map((c) => String(c.id)));
  const turn = new Set((Array.isArray(snap?.agents) ? snap.agents : []).filter((a) => a && inTurn(a)).map((a) => String(a.id)));
  const state = { cards, turn };
  if (prev == null) return { cue: null, state };
  let cue = null;
  if ([...cards].some((id) => !prev.cards.has(id))) cue = 'needs';
  else if ([...turn].some((id) => !prev.turn.has(id))) cue = 'finished';
  if (snap?.sound?.muted || snap?.sound?.quiet) cue = null;
  return { cue, state };
}

const NOTES = { needs: { freqs: [660, 880], gain: 0.15 }, finished: { freqs: [523, 784], gain: 0.1 } };
const NOTE_S = 0.12;

export function createPlayer({ makeContext, makeAudio, makeUrl, revokeUrl }) {
  let ctx = null;
  const custom = new Map(); // cue -> { url, mime }

  function synth(cue) {
    const spec = NOTES[cue];
    if (!spec) return;
    ctx ??= makeContext();
    const t0 = ctx.currentTime;
    spec.freqs.forEach((hz, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      const start = t0 + i * NOTE_S;
      g.gain.setValueAtTime(spec.gain, start);
      g.gain.linearRampToValueAtTime(0, start + NOTE_S);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + NOTE_S);
    });
  }

  function play(cue) {
    if (!cue) return;
    try {
      const c = custom.get(cue);
      if (!c) { synth(cue); return; }
      let fell = false;
      const fallback = () => { if (fell) return; fell = true; try { synth(cue); } catch { /* silent */ } };
      const audio = makeAudio(c.url);
      audio.addEventListener('error', fallback);
      Promise.resolve(audio.play()).catch(fallback);
    } catch { /* a sound failure never breaks the HUD */ }
  }

  function setCustom(cue, file) {
    const old = custom.get(cue);
    if (old) { revokeUrl(old.url); custom.delete(cue); }
    if (file) custom.set(cue, { url: makeUrl(new Blob([file.bytes], { type: file.mime })) });
  }

  return { play, setCustom };
}
