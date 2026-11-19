// A short burst of confetti on a full-screen canvas.
export function confetti({ count = 180, colors = ['#ff4d7d', '#23b8f0', '#ffb020', '#3ddc84', '#ffe9a8', '#a77bff'], duration = 4000 } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:20';
  document.body.append(c);
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const resize = () => { c.width = innerWidth * dpr; c.height = innerHeight * dpr; };
  resize();
  const bits = Array.from({ length: count }, () => ({
    x: Math.random() * c.width, y: -Math.random() * c.height * 0.6,
    vx: (Math.random() - 0.5) * 4 * dpr, vy: (2 + Math.random() * 4) * dpr,
    w: (6 + Math.random() * 8) * dpr, h: (4 + Math.random() * 6) * dpr,
    a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const end = performance.now() + duration;
  const frame = (t) => {
    ctx.clearRect(0, 0, c.width, c.height);
    for (const b of bits) {
      b.x += b.vx; b.y += b.vy; b.vy += 0.04 * dpr; b.a += b.va;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a);
      ctx.fillStyle = b.color; ctx.globalAlpha = Math.max(0, Math.min(1, (end - t) / 800));
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
    }
    if (t < end) requestAnimationFrame(frame); else c.remove();
  };
  requestAnimationFrame(frame);
}
