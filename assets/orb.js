// The reactor orb: Jarvis's face. Segmented rings that turn slowly when idle,
// breathe while listening, spin while thinking, and pulse with each spoken word.
export function createOrb(canvas) {
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let mode = 'idle', energy = 0, target = 0, last = 0, angle = 0, raf = 0;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  let col = { a: '#7fd8ff', b: '#f0b54a', dim: '#1b3347' };
  const refresh = () => { col = { a: css('--reactor') || col.a, b: css('--ingot') || col.b, dim: css('--seam') || col.dim }; };

  function size() {
    const r = Math.min(window.devicePixelRatio || 1, 2), w = canvas.clientWidth || 240;
    canvas.width = w * r; canvas.height = w * r; ctx.setTransform(r, 0, 0, r, 0, 0);
  }
  const ring = (cx, cy, rad, segs, gap, rot, width, color, alpha) => {
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.lineCap = 'butt';
    const step = (Math.PI * 2) / segs;
    for (let i = 0; i < segs; i++) {
      ctx.beginPath(); ctx.arc(cx, cy, rad, rot + i * step, rot + (i + 1) * step - gap); ctx.stroke();
    }
  };

  function frame(t) {
    const dt = Math.min(64, t - (last || t)); last = t;
    const w = canvas.clientWidth, c = w / 2;
    const speed = { idle: 0.00012, listening: 0.0004, thinking: 0.0016, speaking: 0.0005, alert: 0.0008 }[mode] || 0.0002;
    angle += reduce ? 0 : speed * dt;
    if (mode === 'listening') target = 0.45 + 0.25 * Math.sin(t / 260);
    else if (mode === 'thinking') target = 0.35;
    else if (mode === 'idle') target = 0.08 + 0.04 * Math.sin(t / 1800);
    energy += (target - energy) * 0.12;
    if (mode === 'speaking') target *= 0.93; // decays between word pulses

    ctx.clearRect(0, 0, w, w);
    const main = mode === 'alert' ? col.b : col.a;
    // glow core
    const g = ctx.createRadialGradient(c, c, 0, c, c, w * 0.42);
    g.addColorStop(0, hexA(main, 0.55 * (0.4 + energy)));
    g.addColorStop(0.35, hexA(main, 0.16 * (0.5 + energy)));
    g.addColorStop(1, hexA(main, 0));
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, w, w);
    // rings, outside in
    ring(c, c, w * 0.46, 64, 0.03, -angle * 0.5, 1, col.dim, 0.9);
    ring(c, c, w * 0.42, 3, 0.5, angle * 1.4, 2.2, main, 0.55 + energy * 0.4);
    ring(c, c, w * 0.37, 24, 0.12, -angle, 5 + energy * 5, main, 0.25 + energy * 0.5);
    ring(c, c, w * 0.30, 10, 0.18, angle * 2.2, 2, main, 0.5);
    ring(c, c, w * 0.24, 1, 0, 0, 1.2, main, 0.35);
    // core disc
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(c, c, w * (0.12 + energy * 0.05), 0, Math.PI * 2);
    ctx.fillStyle = hexA(main, 0.85); ctx.shadowColor = main; ctx.shadowBlur = 24 + energy * 40; ctx.fill(); ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(c, c, w * 0.07, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
    raf = requestAnimationFrame(frame);
  }

  size(); refresh();
  addEventListener('resize', size);
  raf = requestAnimationFrame(frame);
  return {
    setMode(m) { mode = m; if (m === 'speaking') target = 0.5; },
    pulse(x = 0.6) { target = Math.min(1, Math.max(target, x)); },
    refresh,
    destroy() { cancelAnimationFrame(raf); },
  };
}

function hexA(c, a) {
  if (c.startsWith('#')) {
    const h = c.length === 4 ? c.slice(1).split('').map(x => x + x).join('') : c.slice(1, 7);
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
  }
  return c;
}
