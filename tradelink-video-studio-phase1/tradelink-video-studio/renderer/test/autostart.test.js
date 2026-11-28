import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const bat = (n) => readFileSync(join(ROOT, n), 'latin1');
const FILES = ['install-autostart.bat', 'uninstall-autostart.bat', 'renderer-status.bat', 'start-renderer-background.bat', 'start-renderer.bat'];

test('Windows scripts exist, are plain ASCII and use Windows (CRLF) line endings', () => {
  for (const f of FILES) {
    assert.ok(existsSync(join(ROOT, f)), `${f} missing`);
    const t = bat(f);
    assert.ok([...t].every((c) => c === '\t' || c === '\n' || c === '\r' || (c >= ' ' && c <= '~')), `${f} must be plain ASCII`);
    assert.ok(!/[^\r]\n/.test(t), `${f} must use CRLF line endings (LF-only breaks labels in batch files)`);
  }
});

test('install: needs .env, runs the setup check first, needs no admin rights, writes only a Startup-folder launcher', () => {
  const t = bat('install-autostart.bat');
  assert.ok(t.indexOf('.env') < t.indexOf('npm run check') && t.indexOf('npm run check') < t.indexOf('Startup'));
  assert.match(t, /%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup/);
  assert.ok(!/schtasks|runas|reg add|HKLM|sc create/i.test(t), 'no admin-level changes');
  assert.match(t, /start-renderer-background\.bat/);
});

test('background start: logs to renderer.log, rotates it, restarts after a stop', () => {
  const t = bat('start-renderer-background.bat');
  assert.match(t, />>renderer\.log 2>&1/); assert.match(t, /renderer\.old\.log/); assert.match(t, /goto loop/);
});

test('uninstall stops the restart loop before the renderer and removes only its own launcher', () => {
  const t = bat('uninstall-autostart.bat');
  assert.ok(t.indexOf('start-renderer-background.bat') < t.indexOf('src\\main.js'));
  assert.match(t, /del \/f \/q "%LAUNCHER%"/);
  assert.ok(!/rd |rmdir|del .*\.env|del \*/i.test(t), 'never deletes user files');
});
