# Put Our Building online

The website now includes owner registration, password sign-in, private server sessions, real page URLs, and production configuration. No public website has been deployed by this repository. The ChatGPT/Codex development workspace is not a permanent public hosting service; publishing a Codex environment saves the development environment, not a website or domain.

## Render deployment (prepared option)

`render.yaml` describes a Node web service with one instance and a persistent disk. This option requires a Render account and a paid service/disk; review the provider's current pricing before activating it. No hosting purchase or account creation has been made for you.

1. Open [Deploy on Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fmudaralsafi%2FOur-Own-Building-Managment) while signed in to your Render account. The source and `render.yaml` must be present on the repository's `main` branch.
2. Authorize Render to access `mudaralsafi/Our-Own-Building-Managment` when prompted. Review the web service, persistent disk, and displayed cost, then deploy the Blueprint. If the deployment link does not select the repository, use **New → Blueprint** in the Render dashboard and select this repository's `main` branch.
3. Render builds the frontend, runs the Node server, supplies an HTTPS service address, and generates `SETUP_TOKEN` in its private environment settings. This app uses `RENDER_EXTERNAL_URL` automatically, so no custom domain is required.
4. Open the HTTPS website. Copy the private setup code from the hosting dashboard into the first-owner form, then choose your own email and password. Never paste passwords or setup codes into chat or source files. Registration closes permanently after the first account is created.
5. Add a space, renter, and lease, record a payment, and restart the service. Sign back in and confirm those records remain. Verify a daily backup appears on the persistent disk. These live checks have not been run yet.

If you add a custom domain, configure DNS and HTTPS with the hosting provider, then set `PUBLIC_URL` to the exact HTTPS origin (for example, `https://building.example.com`). All browser traffic must use this one origin; redirect other aliases to it. Do not set an origin containing a path or a trailing query.

## Another Node host

Use Node.js 24 or later. Build with `npm ci --include=dev && npm run build`, then start with `npm start`. Set:

| Variable | Purpose |
| --- | --- |
| `NODE_ENV=production` | Enables production validation, secure cookies, and daily database backups. |
| `PUBLIC_URL` | Exact public HTTPS origin. Render can supply `RENDER_EXTERNAL_URL` instead. |
| `HOST=0.0.0.0` | Listen on the network interface behind the HTTPS reverse proxy. |
| `PORT` | The port your host routes to the Node server. Defaults to 3000. |
| `DATA_PATH` | Absolute path to `building.sqlite` on a persistent, private disk. |
| `SETUP_TOKEN` | A random secret of at least 32 characters, required before first-owner registration. |
| `AUTH_DATA_PATH` | Optional; defaults to `auth.sqlite` next to the building database. Keep it persistent too. |
| `BACKUP_PATH` | Optional; defaults to a private `backups` folder alongside the databases. |

The HTTPS proxy must preserve the public Host header. Only expose the proxy to the internet, not the Node HTTP port. `/api/health` is intentionally public for hosting health checks; all building records and mutations require an authenticated owner session.

Use one instance with one persistent volume. SQLite files must not be put on an ephemeral filesystem or independently copied to multiple application instances. A static-only or default serverless deployment is not suitable for this version.

## Account security and recovery

Passwords are hashed with scrypt and unique random salts. Session identifiers are random, stored as hashes, sent in HttpOnly/SameSite=Strict cookies, and expire after 12 hours. Production cookies also use Secure and the `__Host-` prefix. Sign-out revokes the server session. Password changes require the current password and revoke all other sessions. There is no public password-reset email flow or multi-user access.

Sign-in, setup, and password-change attempts are limited to ten per fifteen minutes per operation. Because this is a single-owner site, the limits are shared across clients and persist over restarts. Allow the time window to expire after a lockout.

If the owner loses access, run `npm run owner:reset` in an authenticated, interactive hosting terminal. It prompts for an email and a hidden password; nothing is accepted through command-line arguments. This command resets the account and revokes every session. It does not change building records. Do not run it from an untrusted terminal.

## Backups and restoration

Production creates a consistent SQLite backup one minute after startup and once every 24 hours, keeping the latest 14 copies. Each timestamped folder contains `building.sqlite` and `auth.sqlite`. You can also run `npm run backup` while the app is running.

These are local disk backups, not disaster recovery: regularly copy them to private storage outside the hosting service. Backups include renter details and authentication data. Logs report backup success or failure; monitor failures. The JSON export in Settings remains a portable record export, not an automated restore.

To restore, stop the service, preserve the existing complete data directory, and replace the two database files with a matched backup. Do not leave WAL/SHM companion files from a different database next to restored files. Start the service, use `npm run owner:reset` to invalidate restored sessions, then verify records and a payment balance. Never delete the current data until the backup has been verified.

## Validation completed locally

Run `npm run build`, then `npm test` and `npm run test:browser`. The HTTP integration check uses the built frontend. Authentication tests exercise setup protection, login/logout, expiry, throttling, password changes, stored hashes, restart persistence, and restorable SQLite backups. Browser checks use disposable records and accounts. Live HTTPS, provider provisioning, custom-domain DNS, and production disk persistence require a real hosting account and must be verified after deployment.
