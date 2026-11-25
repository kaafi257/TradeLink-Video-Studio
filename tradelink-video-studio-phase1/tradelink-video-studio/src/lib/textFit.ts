// Text-width model used by the Quality Assistant. It mirrors renderer/src/text.js (measure and wrapByWidth, without the
// "..." truncation) so the app can warn BEFORE rendering that a line would be cut. A test compares it with the renderer.
const ETHIOPIC = /[ሀ-᎟ⶀ-⷟꬀-꬯]/;

export function sanitize(s: string): string {
  return String(s ?? '')
    .replace(/[·•]/g, ' - ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function measure(text: string, size: number): number {
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

/** How many lines the text needs at this size inside this width (no cut-off). */
export function wrapLineCount(text: string, size: number, widthPx: number): number {
  const words = sanitize(text).split(' ').filter(Boolean);
  const fits = (t: string) => measure(t, size) <= widthPx;
  let lines = 0;
  let cur = '';
  for (let w of words) {
    while (!fits(w) && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && !fits(w.slice(0, cut))) cut--;
      if (cur) { lines++; cur = ''; }
      lines++;
      w = w.slice(cut);
    }
    if (!cur) cur = w;
    else if (fits(`${cur} ${w}`)) cur += ` ${w}`;
    else { lines++; cur = w; }
  }
  if (cur) lines++;
  return lines;
}
