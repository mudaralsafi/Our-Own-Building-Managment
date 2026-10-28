import { resolve, dirname } from 'node:path';

export function configuration(env, root) {
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const host = env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
  if (!production && !['127.0.0.1', 'localhost'].includes(host)) throw new Error('Use production mode for a publicly accessible server.');
  let publicUrl;
  if (production) {
    try { publicUrl = new URL(env.PUBLIC_URL || env.RENDER_EXTERNAL_URL); }
    catch { throw new Error('Set PUBLIC_URL to the HTTPS website address. Render can supply RENDER_EXTERNAL_URL automatically.'); }
    if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/') throw new Error('PUBLIC_URL must be an HTTPS origin, without a path, credentials, or query.');
    if (!env.DATA_PATH || !env.DATA_PATH.startsWith('/')) throw new Error('Set DATA_PATH to an absolute path on a persistent disk.');
  }
  const dataPath = env.DATA_PATH || resolve(root, '.data/building.sqlite');
  const authPath = env.AUTH_DATA_PATH || resolve(dirname(dataPath), 'auth.sqlite');
  if (resolve(dataPath) === resolve(authPath)) throw new Error('The application and authentication databases need different paths.');
  const setupToken = env.SETUP_TOKEN || '';
  const origins = production ? [publicUrl.origin] : [port, 5173].flatMap(p => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]);
  return { production, port, host, origins, dataPath, authPath, setupToken, publicUrl, backupPath: env.BACKUP_PATH || resolve(dirname(dataPath), 'backups') };
}
