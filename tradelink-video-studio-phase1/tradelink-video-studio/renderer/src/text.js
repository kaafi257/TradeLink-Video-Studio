// Text helpers. Pure functions, no I/O.
const ETHIOPIC = /[\u1200-\u139F\u2D80-\u2DDF\uAB00-\uAB2F]/;

/** Replace characters the bundled fonts may lack, and collapse whitespace. */
export function sanitizeText(s) {
  return String(s ?? '')
    .replace(/[\u00b7\u2022]/g, ' - ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasEthiopic(s) {
  return ETHIOPIC.test(s);
}

/** Rough characters-per-line for a bold font at a given size inside a given width (px). */
export function charsPerLine(widthPx, fontSize, text) {
  const k = hasEthiopic(text) ? 1.0 : 0.62;
  return Math.max(4, Math.floor(widthPx / (fontSize * k)));
}

/** Greedy word wrap. Words longer than a line are broken. Returns at most maxLines lines (last one ends with "...") */
export function wrapText(text, maxChars, maxLines = 4) {
  const words = sanitizeText(text).split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  const push = () => { if (cur) lines.push(cur); cur = ''; };
  for (let w of words) {
    while (w.length > maxChars) { push(); lines.push(w.slice(0, maxChars)); w = w.slice(maxChars); }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += ' ' + w;
    else { push(); cur = w; }
  }
  push();
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].slice(0, Math.max(1, maxChars - 3)).trimEnd() + '...';
    return kept;
  }
  return lines;
}

/** Estimated rendered width in px of one line of bold text (Ethiopic syllables are wider than Latin letters). */
export function measure(text, size) {
  let em = 0;
  for (const ch of text) {
    if (ETHIOPIC.test(ch)) em += 0.86;
    else if (ch === ' ') em += 0.35;
    else if (/[0-9.,:+-]/.test(ch)) em += 0.7;
    else if (/[A-Z]/.test(ch)) em += 0.74;
    else em += 0.64;
  }
  return em * size;
}

/** Word wrap by estimated pixel width. Overlong words are broken; extra lines end with "...". */
export function wrapByWidth(text, size, widthPx, maxLines = 4) {
  const words = sanitizeText(text).split(' ').filter(Boolean);
  const lines = [];
  let cur = '';
  const fits = (t) => measure(t, size) <= widthPx;
  for (let w of words) {
    while (!fits(w) && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && !fits(w.slice(0, cut))) cut--;
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    if (!cur) cur = w;
    else if (fits(`${cur} ${w}`)) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && !fits(last + '...')) last = last.slice(0, -1);
    kept[maxLines - 1] = last.trimEnd() + '...';
    return kept;
  }
  return lines;
}
