import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError } from './store.mjs';

const derive = promisify(scrypt);
const SESSION_MS = 12 * 60 * 60 * 1000;
const LIMIT_MS = 15 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => timingSafeEqual(Buffer.from(digest(a), 'hex'), Buffer.from(digest(b), 'hex'));
function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new AppError('Enter a valid email address.');
  return value.trim().toLowerCase();
}
function passwordPolicy(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw new AppError('Use a password with 12 to 128 characters.');
  return value;
}
async function hashPassword(password, salt = randomBytes(32).toString('hex')) {
  const key = await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return { salt, hash: key.toString('hex') };
}
async function verifyPassword(password, owner) {
  const safePassword = typeof password === 'string' && password.length <= 128 ? password : '';
  const candidate = await hashPassword(safePassword, owner?.salt || '0'.repeat(64));
  return Boolean(owner) && equal(candidate.hash, owner.password_hash);
}

export function createAuth(filename, { secure = false, setupToken = '', clock = () => Date.now() } = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), email TEXT NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_attempts (scope TEXT NOT NULL, attempted_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS attempt_dates ON auth_attempts(scope,attempted_at);
  `);
  const cookieName = secure ? '__Host-building_session' : 'building_session';
  const owner = () => db.prepare('SELECT * FROM owner WHERE id=1').get();
  const limited = scope => {
    db.prepare('DELETE FROM auth_attempts WHERE attempted_at<=?').run(clock() - LIMIT_MS);
    if (db.prepare('SELECT COUNT(*) AS total FROM auth_attempts WHERE scope=?').get(scope).total >= 10) throw new AppError('Too many attempts. Please try again in 15 minutes.', 429);
    db.prepare('INSERT INTO auth_attempts(scope,attempted_at) VALUES(?,?)').run(scope, clock());
  };
  function cookie(token = '', maxAge = SESSION_MS / 1000) {
    return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }
  function tokenFrom(request) {
    const value = (request.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
  }
  function revoke(request) {
    const token = tokenFrom(request);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
  }
  function session(request) {
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(clock());
    const token = tokenFrom(request);
    if (!token) return null;
    const existing = db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?').get(digest(token), clock());
    return existing && owner() ? { email: owner().email } : null;
  }
  function newSession(request) {
    revoke(request);
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(clock());
    db.prepare('INSERT INTO sessions(token_hash,expires_at,created_at) VALUES(?,?,?)').run(digest(token), clock() + SESSION_MS, clock());
    return { user: { email: owner().email }, cookie: cookie(token) };
  }
  async function setup(data, request) {
    if (owner()) throw new AppError('An owner account already exists. Sign in instead.', 409);
    limited('setup');
    if (setupToken && (typeof data.setup_token !== 'string' || !equal(data.setup_token, setupToken))) throw new AppError('The setup code is not correct.', 403);
    const email = emailAddress(data.email);
    const password = passwordPolicy(data.password);
    const hashed = await hashPassword(password);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (owner()) throw new AppError('An owner account already exists. Sign in instead.', 409);
      db.prepare('INSERT INTO owner(id,email,password_hash,salt) VALUES(1,?,?,?)').run(email, hashed.hash, hashed.salt);
      db.prepare('DELETE FROM auth_attempts').run();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return newSession(request);
  }
  async function login(data, request) {
    limited('login');
    const current = owner();
    const passwordValid = await verifyPassword(data.password, current);
    const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
    if (!current || !passwordValid || !equal(email, current.email)) throw new AppError('The email or password is incorrect.', 401);
    if (owner()?.revision !== current.revision) throw new AppError('The account changed. Please sign in again.', 401);
    db.prepare('DELETE FROM auth_attempts WHERE scope=\'login\'').run();
    return newSession(request);
  }
  async function changePassword(data, request) {
    if (!session(request)) throw new AppError('Please sign in to continue.', 401);
    limited('password');
    const current = owner();
    if (!await verifyPassword(data.current_password, current)) throw new AppError('Your current password is incorrect.');
    const next = await hashPassword(passwordPolicy(data.new_password));
    db.exec('BEGIN IMMEDIATE');
    try {
      if (owner()?.revision !== current.revision || !session(request)) throw new AppError('The account changed. Please sign in again.', 401);
      db.prepare('UPDATE owner SET password_hash=?,salt=?,revision=revision+1 WHERE id=1').run(next.hash, next.salt);
      db.prepare('DELETE FROM sessions').run();
      db.prepare('DELETE FROM auth_attempts WHERE scope=\'password\'').run();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return newSession(request);
  }
  async function resetOwner(email, password) {
    const normalized = emailAddress(email);
    const hashed = await hashPassword(passwordPolicy(password));
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO owner(id,email,password_hash,salt) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,password_hash=excluded.password_hash,salt=excluded.salt,revision=owner.revision+1').run(normalized, hashed.hash, hashed.salt);
      db.prepare('DELETE FROM sessions').run();
      db.prepare('DELETE FROM auth_attempts').run();
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {
    configured: () => Boolean(owner()),
    status: request => ({ configured: Boolean(owner()), user: session(request), setupRequiresToken: Boolean(setupToken) }),
    session, setup, login, changePassword, resetOwner,
    logout: request => { revoke(request); return cookie('', 0); },
    close: () => db.close(),
  };
}
