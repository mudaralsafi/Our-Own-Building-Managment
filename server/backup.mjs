import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, readdir, rm, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function backupDatabases({ dataPath, authPath, backupPath }) {
  await mkdir(backupPath, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = join(backupPath, stamp);
  const temporary = join(backupPath, '.pending-' + randomBytes(8).toString('hex'));
  await mkdir(temporary, { mode: 0o700 });
  try {
    for (const [source, name] of [[dataPath, 'building.sqlite'], [authPath, 'auth.sqlite']]) {
      const db = new DatabaseSync(source, { readOnly: true });
      try { await backup(db, join(temporary, name)); }
      finally { db.close(); }
      await chmod(join(temporary, name), 0o600);
    }
    await rename(temporary, destination);
    const copies = (await readdir(backupPath)).filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(name)).sort().reverse();
    for (const old of copies.slice(14)) await rm(join(backupPath, old), { recursive: true });
    return destination;
  } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
}
