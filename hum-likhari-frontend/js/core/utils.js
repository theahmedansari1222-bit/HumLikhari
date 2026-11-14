"use strict";
/* Small, dependency-free helpers shared by every module. */

const $ = (selector, root) => (root || document).querySelector(selector);
const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

/* ---- safe HTML templates --------------------------------------------------
 * h`...` escapes every interpolated value unless it is itself the result of h`` (a Raw).
 * Strings from the network therefore can never become markup, and nested templates compose.
 */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(String(s));
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC[c]);
function part(v) {
  if (v == null || v === false || v === true) return "";
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join("");
  return esc(v);
}
function h(strings) {
  let out = strings[0];
  for (let i = 1; i < strings.length; i++) out += part(arguments[i]) + strings[i];
  return new Raw(out);
}

/* ---- numbers, time ------------------------------------------------------- */
const fm = (n) => {
  n = Number(n) || 0;
  return n >= 1000000 ? (n / 1000000).toFixed(1).replace(".0", "") + "M" : n >= 1000 ? (n / 1000).toFixed(1).replace(".0", "") + "K" : String(n);
};
const rupees = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

function ago(iso, now) {
  const t = Date.parse(iso);
  if (!t) return "";
  const s = Math.max(0, ((now || Date.now()) - t) / 1000);
  if (s < 60) return "ابھی";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " منٹ پہلے";
  const hr = Math.floor(m / 60);
  if (hr < 24) return hr === 1 ? "1 گھنٹہ پہلے" : hr + " گھنٹے پہلے";
  const d = Math.floor(hr / 24);
  if (d < 30) return d === 1 ? "1 دن پہلے" : d + " دن پہلے";
  const mo = Math.floor(d / 30);
  if (mo < 12) return mo === 1 ? "1 ماہ پہلے" : mo + " ماہ پہلے";
  const y = Math.floor(d / 365);
  return y <= 1 ? "1 سال پہلے" : y + " سال پہلے";
}

/* ---- deterministic look (no stored colours needed) -------------------------- */
function hash(str) {
  let x = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}
const GRADIENTS = [
  "linear-gradient(135deg,#14532d,#4f9a6b)", "linear-gradient(135deg,#e29a4b,#b5546b)",
  "linear-gradient(135deg,#143d6b,#3aa1cf)", "linear-gradient(135deg,#1f2a44,#6b5b95)",
  "linear-gradient(135deg,#a67c52,#5e4128)", "linear-gradient(135deg,#c9b08a,#7d6445)",
  "linear-gradient(#8fc1dd,#3f7f58)",
];
const gradientFor = (id) => GRADIENTS[hash(id) % GRADIENTS.length];
const avatarHue = (key) => hash(key) % 360;

/* ---- phone numbers (Pakistan-first, E.164 out) ------------------------------ */
function toE164(input) {
  let s = String(input || "").replace(/[\s\-().]/g, "");
  if (!s) return null;
  if (s.startsWith("+")) s = "+" + s.slice(1).replace(/\D/g, "");
  else if (s.startsWith("00")) s = "+" + s.slice(2).replace(/\D/g, "");
  else if (s.startsWith("0")) s = "+92" + s.slice(1).replace(/\D/g, "");
  else if (s.startsWith("92") && s.length >= 12) s = "+" + s.replace(/\D/g, "");
  else if (/^3\d{9}$/.test(s)) s = "+92" + s;
  else return null;
  if (!/^\+[1-9]\d{9,14}$/.test(s)) return null;
  if (s.startsWith("+92") && !/^\+923\d{9}$/.test(s)) return null;   // Pakistani mobile numbers only for +92
  return s;
}

/* ---- text formatting inside posts -------------------------------------------
 * Bodies are stored as plain text. Bold **x**, italic *x* and "> quote" are applied to ESCAPED text,
 * so the formatter cannot create tags that were not typed by us.
 */
function formatInline(text) {
  const safe = esc(text);
  if (/^&gt; /.test(safe)) {
    return raw('<span class="qt">' + safe.slice(5).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>") + "</span>");
  }
  return raw(safe.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>"));
}
const stripMarks = (s) => String(s || "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/^> /gm, "");
function lines(text) { return String(text || "").split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() !== ""); }
function teaser(text, max) {
  const first = stripMarks(lines(text)[0] || "");
  return first.length > max ? first.slice(0, max).trimEnd() + "…" : first;
}

/* ---- misc ---------------------------------------------------------------- */
let toastTimer;
function toast(message) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function debounce(fn, ms) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}
const ls = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } },
  del(key) { try { localStorage.removeItem(key); } catch (_) { /* ignore */ } },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clampText = (s, n) => String(s || "").slice(0, n);

/* Resize an image File to a JPEG/PNG File (keeps uploads small and strips EXIF by re-encoding). */
function resizeImage(file, maxSide, mime, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const g = c.getContext("2d");
      if (mime === "image/jpeg") { g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((blob) => {
        if (!blob) return reject(new Error("image_encode_failed"));
        resolve(new File([blob], "image." + (mime === "image/png" ? "png" : "jpg"), { type: mime }));
      }, mime, quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image_decode_failed")); };
    img.src = url;
  });
}
