// Small helpers shared by the pages. All text goes in through textContent, never innerHTML.

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

export const $ = (sel) => document.querySelector(sel);
export const LETTERS = ['A', 'B', 'C', 'D'];

export function show(root, ...kids) { root.replaceChildren(...kids.flat().filter(Boolean)); }

export function toast(text) {
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

// A WebSocket that reconnects by itself. `hello()` returns the first message to send
// on every (re)connection, so a dropped phone picks up where it left off.
export function live({ hello, onMessage, onStatus = () => {} }) {
  let ws = null; let tries = 0; let stopped = false;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const open = () => {
    if (stopped) return;
    ws = new WebSocket(url);
    ws.onopen = () => { tries = 0; onStatus('open'); const first = hello(); if (first) ws.send(JSON.stringify(first)); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
    ws.onclose = () => { if (stopped) return; onStatus('closed'); tries++; setTimeout(open, Math.min(8000, 500 * 2 ** Math.min(tries, 4))); };
  };
  open();
  return {
    send: (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); },
    stop: () => { stopped = true; try { ws.close(); } catch {} },
  };
}

// Saved quizzes live in this browser only.
const KEY = 'blurt-quizzes';
export const saved = {
  all() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } },
  put(item) {
    const list = saved.all().filter(x => x.id !== item.id);
    list.unshift({ ...item, updated: Date.now() });
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 200))); return true; } catch { return false; }
  },
  get(id) { return saved.all().find(x => x.id === id) || null; },
  remove(id) { try { localStorage.setItem(KEY, JSON.stringify(saved.all().filter(x => x.id !== id))); } catch {} },
};

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export async function api(path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch { return { error: 'Could not reach the server. Check your connection.' }; }
  try { return await res.json(); } catch { return { error: `The server had a problem (${res.status}).` }; }
}

// Rows -> a CSV file download that opens cleanly in Excel and Google Sheets.
export function downloadCsv(filename, rows) {
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: filename });
  document.body.append(a); a.click(); a.remove();
}

export const slug = (s) => String(s || 'quiz').toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'quiz';

// Share buttons that need no sign-in or API key: they open the service's own share page.
export function shareButtons(url, title) {
  const enc = encodeURIComponent;
  return h('div', { class: 'row' },
    h('a', { class: 'btn ghost small', target: '_blank', rel: 'noopener', href: `https://classroom.google.com/share?url=${enc(url)}&title=${enc(title)}` }, 'Share to Google Classroom'),
    h('a', { class: 'btn ghost small', target: '_blank', rel: 'noopener', href: `https://teams.microsoft.com/share?href=${enc(url)}&msgText=${enc(title)}` }, 'Share to Teams'),
    h('button', { class: 'btn ghost small', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link:', url); } } }, 'Copy link'));
}

// Shrink a picture in the browser so it fits in the quiz (no upload server needed).
export function resizeImage(file, max = 900, quality = 0.78) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error('That is not a picture.'));
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      let q = quality; let url = c.toDataURL('image/jpeg', q);
      while (url.length > 500 * 1024 && q > 0.4) { q -= 0.1; url = c.toDataURL('image/jpeg', q); }
      resolve(url);
    };
    img.onerror = () => reject(new Error('Could not read that picture.'));
    img.src = URL.createObjectURL(file);
  });
}

export function qrImage(text, size = 6) {
  if (typeof window.qrcode !== 'function') return null;
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return h('img', { src: qr.createDataURL(size, 2), alt: `QR code for ${text}`, class: 'qr' });
}

export const youtubeEmbed = (v, autoplay = true) =>
  `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?rel=0&modestbranding=1&playsinline=1${autoplay ? '&autoplay=1' : ''}${v.start ? `&start=${v.start}` : ''}${v.end ? `&end=${v.end}` : ''}`;
