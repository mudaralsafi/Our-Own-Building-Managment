import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createAuth } from '../server/auth.mjs';
import { createStore } from '../server/store.mjs';
import { configuration } from '../server/config.mjs';
import { backupDatabases } from '../server/backup.mjs';

const anon = { headers: {} };
const asUser = result => ({ headers: { cookie: result.cookie.split(';')[0] } });
const credentials = () => ({ email: 'owner@example.test', password: randomBytes(24).toString('hex') });
function authFor(t, options = {}) { const auth = createAuth(':memory:', options); t.after(() => auth.close()); return auth; }

test('private setup code protects the first account; registration closes afterward', async t => {
  const setupToken = randomBytes(32).toString('hex');
  const auth = authFor(t, { secure: true, setupToken });
  const user = credentials();
  await assert.rejects(auth.setup(user, anon), /setup code/);
  assert.equal(auth.configured(), false);
  const result = await auth.setup({ ...user, setup_token: setupToken }, anon);
  assert.equal(auth.session(asUser(result)).email, user.email);
  for (const flag of ['__Host-building_session=', 'HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(result.cookie.includes(flag));
  await assert.rejects(auth.setup({ ...user, setup_token: setupToken }, anon), /already exists/);
  assert.deepEqual(auth.status(anon).user, null);
});
test('sign-in rejects wrong credentials, rotates sessions, and supports sign-out', async t => {
  const auth = authFor(t); const user = credentials();
  const first = await auth.setup(user, anon);
  await assert.rejects(auth.login({ ...user, password: 'incorrect-password' }, anon), /incorrect/);
  await assert.rejects(auth.login({ ...user, email: 'someone@example.test' }, anon), /incorrect/);
  const signedIn = await auth.login(user, asUser(first));
  assert.equal(auth.session(asUser(first)), null);
  assert.equal(auth.session(asUser(signedIn)).email, user.email);
  assert.match(auth.logout(asUser(signedIn)), /Max-Age=0/);
  assert.equal(auth.session(asUser(signedIn)), null);
});
test('sessions expire after twelve hours', async t => {
  let now = 1000000;
  const auth = authFor(t, { clock: () => now });
  const signedIn = await auth.setup(credentials(), anon);
  now += 12 * 60 * 60 * 1000;
  assert.equal(auth.session(asUser(signedIn)), null);
});
test('changing a password requires the current password and invalidates other sessions', async t => {
  const auth = authFor(t); const user = credentials();
  const first = await auth.setup(user, anon);
  const other = await auth.login(user, anon);
  const next = credentials().password;
  await assert.rejects(auth.changePassword({ current_password: 'wrong', new_password: next }, asUser(first)), /current password/);
  const changed = await auth.changePassword({ current_password: user.password, new_password: next }, asUser(first));
  assert.equal(auth.session(asUser(other)), null);
  assert.equal(auth.session(asUser(first)), null);
  assert.ok(auth.session(asUser(changed)));
  await assert.rejects(auth.login(user, anon), /incorrect/);
  assert.ok((await auth.login({ ...user, password: next }, anon)).user);
});
test('repeated failed sign-ins are limited even without a client IP', async t => {
  let now = 1000000;
  const auth = authFor(t, { clock: () => now });
  await auth.setup(credentials(), anon);
  for (let i = 0; i < 10; i++) await assert.rejects(auth.login({ email: 'owner@example.test', password: 'wrong' }, anon), /incorrect/);
  await assert.rejects(auth.login(credentials(), anon), error => error.status === 429);
  now += 15 * 60 * 1000 + 1;
  await assert.rejects(auth.login(credentials(), anon), error => error.status === 401);
});
test('passwords and session tokens are hashed on disk, and login survives a restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'building-auth-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'auth.sqlite');
  const user = credentials();
  let auth = createAuth(filename);
  const first = await auth.setup(user, anon);
  auth.close();
  const inspect = new DatabaseSync(filename, { readOnly: true });
  const owner = inspect.prepare('SELECT * FROM owner').get();
  assert.notEqual(owner.password_hash, user.password);
  const session = inspect.prepare('SELECT * FROM sessions').get();
  assert.notEqual(session.token_hash, first.cookie.split(';')[0].split('=')[1]);
  inspect.close();
  auth = createAuth(filename);
  assert.ok(auth.session(asUser(first)));
  assert.ok((await auth.login(user, anon)).user);
  await auth.resetOwner(user.email, credentials().password);
  assert.equal(auth.session(asUser(first)), null);
  auth.close();
});
test('production configuration refuses unsafe URLs and ephemeral default storage', () => {
  assert.throws(() => configuration({ NODE_ENV: 'production' }, '/tmp'), /PUBLIC_URL/);
  assert.throws(() => configuration({ NODE_ENV: 'production', PUBLIC_URL: 'http://example.test' }, '/tmp'), /HTTPS/);
  assert.throws(() => configuration({ NODE_ENV: 'production', PUBLIC_URL: 'https://example.test' }, '/tmp'), /persistent disk/);
  assert.throws(() => configuration({ HOST: '0.0.0.0' }, '/tmp'), /production/);
  const config = configuration({ NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://example.test', DATA_PATH: '/var/data/building.sqlite' }, '/tmp');
  assert.equal(config.host, '0.0.0.0');
  assert.deepEqual(config.origins, ['https://example.test']);
  assert.equal(config.authPath, '/var/data/auth.sqlite');
});
test('database backups are consistent snapshots that can be reopened', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'building-backup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = { dataPath: join(directory, 'building.sqlite'), authPath: join(directory, 'auth.sqlite'), backupPath: join(directory, 'backups') };
  const store = createStore(config.dataPath);
  const auth = createAuth(config.authPath);
  await auth.setup(credentials(), anon);
  store.saveSpace({ name: 'Backup test', type: 'Office', floor: '1', area: 42, ready: true });
  const destination = await backupDatabases(config);
  const restored = createStore(join(destination, 'building.sqlite'));
  const restoredAuth = createAuth(join(destination, 'auth.sqlite'));
  assert.equal(restored.state().spaces[0].name, 'Backup test');
  assert.equal(restoredAuth.configured(), true);
  restored.close(); restoredAuth.close(); auth.close(); store.close();
});
