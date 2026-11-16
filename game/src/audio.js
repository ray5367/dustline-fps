// Procedural WebAudio sounds only — no audio assets, no network.
// Every effect is synthesized from oscillators and filtered noise at call time.
export function createAudio() {
  let ctx = null;
  let master = null;
  let enabled = true;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function noiseBuffer(seconds) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function burst({ dur = 0.1, freq = 1200, type = 'lowpass', gain = 0.5, when = 0 }) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function tone({ freq = 440, dur = 0.08, type = 'square', gain = 0.2, slideTo = 0, when = 0 }) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    setEnabled(v) { enabled = v; },
    shot(kind) {
      if (kind === 'sniper') { burst({ dur: 0.28, freq: 900, gain: 0.7 }); tone({ freq: 160, dur: 0.18, type: 'sine', gain: 0.5, slideTo: 55 }); }
      else if (kind === 'shotgun') { burst({ dur: 0.22, freq: 700, gain: 0.65 }); tone({ freq: 120, dur: 0.15, type: 'sine', gain: 0.45, slideTo: 45 }); }
      else if (kind === 'smg') burst({ dur: 0.07, freq: 1800, gain: 0.35 });
      else if (kind === 'pistol') burst({ dur: 0.09, freq: 1400, gain: 0.4 });
      else burst({ dur: 0.11, freq: 1100, gain: 0.55 });
    },
    enemyShot(distance) {
      const g = Math.max(0.08, 0.4 - distance * 0.008);
      burst({ dur: 0.1, freq: 900, gain: g });
    },
    dryFire() { tone({ freq: 1200, dur: 0.03, type: 'square', gain: 0.12 }); },
    reload() {
      tone({ freq: 900, dur: 0.04, type: 'square', gain: 0.15 });
      tone({ freq: 600, dur: 0.04, type: 'square', gain: 0.15, when: 0.18 });
      tone({ freq: 1100, dur: 0.05, type: 'square', gain: 0.18, when: 0.55 });
    },
    hit(head) {
      tone({ freq: head ? 1500 : 1000, dur: 0.05, type: 'sine', gain: 0.3 });
    },
    kill() { tone({ freq: 700, dur: 0.07, type: 'sine', gain: 0.3 }); tone({ freq: 1050, dur: 0.09, type: 'sine', gain: 0.25, when: 0.07 }); },
    hurt() { tone({ freq: 200, dur: 0.12, type: 'sawtooth', gain: 0.25, slideTo: 90 }); },
    step() { burst({ dur: 0.04, freq: 500, gain: 0.06 }); },
    buy() { tone({ freq: 880, dur: 0.06, type: 'sine', gain: 0.25 }); tone({ freq: 1320, dur: 0.08, type: 'sine', gain: 0.22, when: 0.06 }); },
    denied() { tone({ freq: 220, dur: 0.12, type: 'square', gain: 0.2 }); },
    plantTick() { tone({ freq: 1800, dur: 0.05, type: 'square', gain: 0.2 }); },
    plantDone() { tone({ freq: 520, dur: 0.15, type: 'sine', gain: 0.3 }); tone({ freq: 780, dur: 0.2, type: 'sine', gain: 0.25, when: 0.12 }); },
    explosion() {
      burst({ dur: 0.7, freq: 300, gain: 0.9 });
      tone({ freq: 90, dur: 0.6, type: 'sine', gain: 0.7, slideTo: 30 });
    },
    roundStart() { tone({ freq: 440, dur: 0.1, type: 'sine', gain: 0.25 }); tone({ freq: 660, dur: 0.14, type: 'sine', gain: 0.25, when: 0.1 }); },
    roundWin() { [523, 659, 784].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'sine', gain: 0.25, when: i * 0.13 })); },
    roundLose() { [392, 330, 262].forEach((f, i) => tone({ freq: f, dur: 0.18, type: 'sine', gain: 0.22, when: i * 0.14 })); },
  };
}
