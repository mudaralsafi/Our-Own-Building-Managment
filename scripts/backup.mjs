import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backupDatabases } from '../server/backup.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataPath = process.env.DATA_PATH || resolve(root, '.data/building.sqlite');
const authPath = process.env.AUTH_DATA_PATH || resolve(dirname(dataPath), 'auth.sqlite');
const backupPath = process.env.BACKUP_PATH || resolve(dirname(dataPath), 'backups');
const destination = await backupDatabases({ dataPath, authPath, backupPath });
console.log(`Consistent database backup saved to ${destination}`);
