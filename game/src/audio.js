// All sound is synthesized with WebAudio: no audio files, no network.
// Engine hum, sirens, gunshots, pickups and a small synthwave radio loop.
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this.engineOsc = null;
    this.engineGain = null;
    this.musicTimer = null;
    this.step = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    this.startEngine();
    this.startMusic();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    return this.musicOn;
  }

  startEngine() {
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    this.engineOsc.connect(filter);
    filter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
  }

  // speedRatio 0..1 while driving; 0 when on foot.
  setEngine(speedRatio, driving) {
    if (!this.ctx || !this.engineGain) return;
    const target = driving ? 0.05 + speedRatio * 0.09 : 0.0;
    this.engineGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
    this.engineOsc.frequency.setTargetAtTime(52 + speedRatio * 130, this.ctx.currentTime, 0.08);
  }

  blip(freq, dur, type, vol, when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur, vol, filterFreq = 1200) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
  }

  pickup() { this.blip(660, 0.09, 'sine', 0.25); this.blip(990, 0.14, 'sine', 0.22, 0.08); }
  punch() { this.noise(0.12, 0.4, 500); this.blip(120, 0.1, 'sine', 0.3); }
  gunshot() { this.noise(0.16, 0.55, 2400); this.blip(180, 0.08, 'square', 0.2); }
  crash() { this.noise(0.3, 0.5, 700); this.blip(70, 0.25, 'sine', 0.35); }
  siren() { this.blip(720, 0.22, 'sine', 0.12); this.blip(540, 0.22, 'sine', 0.12, 0.22); }
  missionDone() {
    [523, 659, 784, 1046].forEach((f, i) => this.blip(f, 0.22, 'triangle', 0.22, i * 0.11));
  }
  busted() { this.blip(392, 0.3, 'square', 0.18); this.blip(311, 0.4, 'square', 0.18, 0.3); }
  click() { this.blip(880, 0.05, 'sine', 0.15); }
  door() { this.blip(240, 0.08, 'square', 0.18); this.noise(0.08, 0.15, 900); }

  // A laid-back synthwave loop: bass line + sparse arpeggio, scheduled per bar.
  startMusic() {
    if (this.musicTimer) return;
    const bass = [55, 55, 65.4, 49, 55, 55, 82.4, 73.4];
    const arp = [220, 277, 330, 415, 330, 277];
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted || !this.musicOn) return;
      const bar = this.step;
      this.step += 1;
      const root = bass[bar % bass.length];
      this.blip(root, 0.5, 'triangle', 0.16);
      this.blip(root / 2, 0.5, 'sine', 0.14);
      if (bar % 2 === 0) {
        const note = arp[(bar / 2) % arp.length];
        this.blip(note, 0.18, 'square', 0.05);
        this.blip(note * 2, 0.18, 'sine', 0.04, 0.12);
      }
      if (bar % 8 === 7) this.noise(0.2, 0.05, 4000);
    }, 340);
  }
}
