# Our Building

A single-owner rental workspace for shops, offices, and rooftop spaces. English interface, USD amounts, and a configurable building completion date. Reserve spaces before opening and choose when rent starts independently.

[Deploy on Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fmudaralsafi%2FOur-Own-Building-Managment)

The deployment link opens Render's configuration review for the `main` branch. Sign in to Render and connect this GitHub repository when prompted. The configuration uses a paid web service and persistent disk; review Render's displayed price before deploying. See [DEPLOYMENT.md](DEPLOYMENT.md) for first-owner setup after the site is live.

## Run

Requires **Node.js 24+** and npm. No database service, API key, or external account is needed.

```sh
npm ci
npm run dev
```

Development uses Vite on port 5173 and the API on port 3001. To run the production build locally:

```sh
npm run build
npm start
```

Local startup uses port 3000 and binds to loopback. The first visit lets you create your owner account; later visits require sign-in. A live deployment uses production mode, HTTPS, persistent storage, and a private first-owner setup code. See [DEPLOYMENT.md](DEPLOYMENT.md) and the optional `render.yaml` blueprint. The website has not been publicly deployed.

## What works

- Private owner sign-in, sign-out, password changes, expiring sessions, and guarded first-time setup.
- Real page URLs with refresh, bookmarks, and browser back/forward navigation.

- Add and edit shops, offices, and rooftop spaces, including area, floor, readiness, and notes.
- Store renter names, business details, email, phone, and notes.
- Create leases and future reservations; overlapping allocations of the same space are blocked.
- Set lease dates, first rent date, monthly rent, and a separate security deposit.
- Track rent due, overdue balances, partial payments, payment method, and receipt references.
- View payment history, correct accidental payment records, and export the ledger as CSV.
- Edit unpaid leases, end leases early, and preserve records with payment history.
- Change the building name, address, completion date, and time zone.
- Download all records as JSON. This is an export, not an automated restore system.
- Use the interface on desktop and mobile.

The initial workspace is empty. No sample customers or financial transactions are inserted. The completion date initially defaults to six months from first startup and can be changed in Building settings. Date calculations default to `Asia/Baghdad`.

## Rent rules

Amounts are stored as integer USD cents. Rent is monthly, anchored to the first due date. A charge due on day 31 moves to the last day of a shorter month and returns to day 31 afterward. Start and end dates are inclusive; the next tenant's lease must start after the previous end date. A future start date marks a lease as reserved. A separate readiness field tracks construction, rather than treating a reservation as permission to occupy the space.

Full monthly charges apply on scheduled due dates; there is no automatic proration, tax, late fee, deposit refund accounting, or payment processing. Received payments are entered manually. Deposits are excluded from rent-income totals. Overdue balances include unpaid rent and deposits before today's date in the building's time zone. Rent received is cash received during the current month, which may cover a different month's charge. Financial lease terms lock after a payment is recorded.

Ending a lease removes unpaid rent charges after the new end date, keeps deposits and earlier charges, and refuses to remove rent charges with payments. Deleting a payment corrects the ledger and reopens the balance; it does not refund money. Deleting a space or renter with lease history is blocked.

## Data and backups

Building data persists in `.data/building.sqlite`; owner credentials and sessions are hashed and stored in `.data/auth.sqlite`, with SQLite WAL files alongside them. The directory is ignored by Git. Set `DATA_PATH` to choose another SQLite file, and `PORT` to choose a server port. Never commit real renter data or backups.

For a consistent backup while the site runs, use `npm run backup`. Production also keeps the latest 14 scheduled database snapshots. Copy backups to private off-site storage. Alternatively, stop the app gracefully and copy the **whole `.data` directory**. Follow the restoration steps in DEPLOYMENT.md. The Settings JSON download is useful for portable records and inspection; an import screen is not included yet.

## Validation

```sh
npm run build
npm test
npm run test:browser
```

The browser smoke test requires Chromium (`/usr/bin/chromium`, or set `CHROMIUM_PATH`). It runs its own server on port 3317 with a disposable database outside the checkout; it never inserts sample data into your real workspace. It exercises owner setup/sign-in/sign-out, space and renter creation, a lease, partial payment, reload persistence, CSV export, page URLs, and mobile editing. Screenshots are saved to the ignored `test-results/` directory.

Unit tests cover exact amounts, leap years and month ends, future reservations, overlapping leases, partial payments, duplicate submissions, financial-history protections, ending leases, and database persistence.

## Cloud environment

Use the checkout at `/workspace/Our-Own-Building-Managment`. Each task already has an isolated environment; do not create Git worktrees unless explicitly requested. Run `npm ci`, `npm test`, and `npm run build` to prepare a fresh checkout. Dependencies and files can be retained in the environment snapshot, but app processes must be restarted with `npm start` or `npm run dev` in each new task. Check `/api/health` and `/api/auth/status` locally after startup; `/api/state` must reject anonymous requests with 401. Onboarding does not publish or deploy the app.
