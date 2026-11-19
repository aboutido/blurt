// All the game sounds are made here with the Web Audio API: no audio files,
// nothing borrowed. Browsers only allow sound after a click, so call unlock()
// from a click handler first.

let ctx = null;
let master = null;
let loop = null;
let muted = false;
try { muted = localStorage.getItem('blurt-muted') === '1'; } catch {}

export const sound = {
  get muted() { return muted; },
  toggle() {
    muted = !muted;
    try { localStorage.setItem('blurt-muted', muted ? '1' : '0'); } catch {}
    if (master) master.gain.value = muted ? 0 : 0.5;
    return muted;
  },
  unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  },
  lobby() { start(lobbyPattern, 0.22); },
  thinking() { start(thinkPattern, 0.16); },
  stop() { if (loop) { clearInterval(loop.timer); loop = null; } },
  tick(urgent) { blip(urgent ? 880 : 660, 0.05, 'square', 0.18); },
  join() { blip(988, 0.06, 'triangle', 0.3); setTimeout(() => blip(1319, 0.08, 'triangle', 0.3), 60); },
  answer() { blip(520, 0.04, 'sine', 0.2); },
  reveal() { arp([523, 659, 784, 1047], 0.09, 'triangle', 0.35); },
  timesUp() { arp([392, 330, 262], 0.12, 'sawtooth', 0.18); },
  fanfare() { arp([523, 523, 523, 659, 784, 659, 784, 1047], 0.13, 'square', 0.22); },
  drumroll(ms = 1600) { const end = Date.now() + ms; const hit = () => { if (Date.now() > end) return; noise(0.04, 0.12); setTimeout(hit, 55); }; hit(); },
};

function blip(freq, dur, type = 'sine', vol = 0.3, at = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, vol) {
  if (!ctx || muted) return;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource(); const g = ctx.createGain();
  g.gain.value = vol; src.buffer = buf; src.connect(g); g.connect(master); src.start();
}

function arp(notes, step, type, vol) { notes.forEach((f, i) => blip(f, step * 1.6, type, vol, i * step)); }

// Two original little loops: a bouncy one for the lobby, a ticking one while thinking.
const lobbyPattern = { bpm: 132, notes: [523, 0, 659, 784, 0, 659, 587, 0, 523, 0, 440, 523, 587, 0, 659, 0], bass: [131, 0, 0, 0, 175, 0, 0, 0, 147, 0, 0, 0, 196, 0, 0, 0] };
const thinkPattern = { bpm: 150, notes: [0, 392, 0, 440, 0, 392, 0, 349, 0, 392, 0, 440, 0, 494, 0, 440], bass: [98, 0, 98, 0, 110, 0, 110, 0, 87, 0, 87, 0, 98, 0, 98, 0] };

function start(pattern, vol) {
  sound.stop();
  if (!ctx) return;
  let i = 0;
  const step = 60000 / pattern.bpm / 2;
  const play = () => {
    const n = pattern.notes[i % pattern.notes.length];
    const b = pattern.bass[i % pattern.bass.length];
    if (n) blip(n, step / 1000 * 0.9, 'triangle', vol);
    if (b) blip(b, step / 1000 * 1.8, 'sine', vol * 1.4);
    i++;
  };
  play();
  loop = { timer: setInterval(play, step) };
}
