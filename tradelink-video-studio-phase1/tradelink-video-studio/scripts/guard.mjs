import { Buffer } from 'node:buffer';
// Repository guard. Fails the build if a secret or a marketplace reference is found where it must not be.
// Dependency-free so it runs anywhere:  node scripts/guard.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.vercel']);
const SKIP_FILES = new Set(['package-lock.json']);
const BINARY = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|mp4|mp3|pdf|zip)$/i;

const MARKETPLACE_REF = 'gqjdferuonclqgpugxjr';
const MARKETPLACE_REF_ALLOWED = [
  'src/lib/config.ts', 'src/lib/config.test.ts', 'scripts/guard.mjs',
  'CLAUDE.md', 'README.md',
];
const MARKETPLACE_VIEWS =
  /public_(products|product_images|categories|industries|suppliers|supplier_categories|campaign|promotions|promo_products|contact)\b/;

const problems = [];
const add = (file, msg) => problems.push(`${file}: ${msg}`);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function jwtRole(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(part, 'base64').toString('utf8')).role ?? null;
  } catch {
    return null;
  }
}

for (const full of walk(ROOT)) {
  const rel = relative(ROOT, full).split(sep).join('/');
  const base = rel.split('/').pop();
  if (SKIP_FILES.has(base) || BINARY.test(base)) continue;
  if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') {
    add(rel, 'an environment file must not be committed');
    continue;
  }
  const text = readFileSync(full, 'utf8');

  if (rel !== 'scripts/guard.mjs') {
    if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) add(rel, 'looks like a Supabase secret key');
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) add(rel, 'contains a private key');
    if (/(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/.test(text)) add(rel, 'looks like a GitHub token');
    for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
      const role = jwtRole(m[0]);
      if (role !== 'anon') add(rel, `contains a JWT with role "${role}" (only public anon keys may appear)`);
    }
  }

  if (text.includes(MARKETPLACE_REF) && !MARKETPLACE_REF_ALLOWED.includes(rel) && !rel.startsWith('docs/')) {
    add(rel, 'mentions the marketplace project address');
  }
  // Phase 1 must not contain any marketplace data access.
  if (rel.startsWith('src/') && !rel.endsWith('.test.ts') && MARKETPLACE_VIEWS.test(text)) {
    add(rel, 'references a marketplace view; the marketplace link is not allowed in this phase');
  }
}

if (problems.length) {
  console.error('GUARD FAILED:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('Guard passed: no secrets, no committed env files, no marketplace access found.');
