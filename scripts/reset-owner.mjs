import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from '../server/auth.mjs';

if (!process.stdin.isTTY) throw new Error('Run this command in an interactive server terminal. Passwords are not accepted as command-line arguments.');
let hidden = false;
const output = new Writable({ write(chunk, encoding, done) { if (!hidden) process.stdout.write(chunk, encoding); done(); } });
const terminal = createInterface({ input: process.stdin, output, terminal: true });
const root = fileURLToPath(new URL('../', import.meta.url));
const dataPath = process.env.DATA_PATH || resolve(root, '.data/building.sqlite');
const auth = createAuth(process.env.AUTH_DATA_PATH || resolve(dirname(dataPath), 'auth.sqlite'));
try {
  console.log('This replaces the owner password and signs out every existing session.');
  const email = await terminal.question('Owner email: ');
  process.stdout.write('New password (at least 12 characters; input hidden): ');
  hidden = true;
  const password = await terminal.question('');
  process.stdout.write('\nConfirm new password: ');
  const confirmation = await terminal.question('');
  hidden = false; process.stdout.write('\n');
  if (password !== confirmation) throw new Error('Passwords do not match. No account changes were made.');
  await auth.resetOwner(email, password);
  console.log('Owner account saved. Existing sessions have been signed out.');
} finally { terminal.close(); auth.close(); }
