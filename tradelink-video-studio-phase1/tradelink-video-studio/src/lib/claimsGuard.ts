// Claims guard (app side). Mandatory for EVERY copy provider: rules, local AI or anything added later.
// It mirrors public.claims_problem() in migration 0006, which runs again inside the database.
// Text may only restate approved catalogue facts: no invented numbers, prices, percentages, links, handles or marketing claims.
// A banned word is accepted only when the approved facts themselves contain it.
// The Somali and Amharic word lists are DRAFT and unverified by a native speaker.

export const BANNED_CLAIMS: readonly string[] = [
  'best', 'cheapest', 'lowest price', 'number one', 'no. 1', 'guarantee', 'guaranteed', 'certified', 'organic', 'halal',
  'fda', 'iso', 'free', 'discount', 'limited time', 'only today', 'hurry', 'authentic', 'original', 'award', 'top rated',
  'ugu fiican', 'ugu jaban', 'dammaanad', 'bilaash', 'dhaqso',
  'ምርጥ', 'ርካሽ', 'ዋስትና', 'ነፃ', 'ነጻ',
];

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BANNED_RE = BANNED_CLAIMS.map((w) => ({ w, re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'iu') }));

/** Everything the facts say, as one string to compare against. Numbers also appear with two decimals, as the database stores prices. */
export function factsText(facts: unknown): string {
  const extra: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'number' && Number.isFinite(v)) extra.push(v.toFixed(2));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(facts);
  return `${JSON.stringify(facts)} ${extra.join(' ')}`;
}

/** Returns a plain reason when the text is not acceptable, or null when it is. */
export function claimsProblem(text: string | null | undefined, facts: string): string | null {
  const t = text ?? '';
  const f = facts.toLowerCase().replace(/,/g, '');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(t)) return 'contains control characters';
  if (/[<>]/.test(t)) return 'contains markup characters';
  if (t.includes('%')) return 'contains a percentage, which is not in the approved data';
  if (/[፩-፼]/.test(t)) return 'contains Ethiopic numerals, which cannot be checked against the data';
  if (/(https?:\/\/|www\.|@[a-z0-9_]+|[a-z0-9-]+\.(com|net|org|et|app|io)\b)/i.test(t)) return 'contains a link, e-mail or handle';
  for (const m of t.matchAll(/[0-9]+(?:[.,][0-9]+)*/g)) {
    if (!f.includes(m[0].replace(/,/g, ''))) return `number ${m[0]} is not in the approved data`;
  }
  for (const { w, re } of BANNED_RE) {
    if (re.test(t) && !f.includes(w)) return `claim "${w}" is not in the approved data`;
  }
  return null;
}
