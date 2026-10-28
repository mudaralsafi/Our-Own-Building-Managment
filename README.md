# Our Building

A private, single-owner website for managing commercial rentals from the first call to annual rent collection. English, USD, shops, offices, and rooftop spaces. Designed for phone and desktop use.

## The owner's workflow

1. **Log calls and interest.** Save a name, phone, business, notes, interested spaces, and an optional follow-up date. Multiple people can be interested in a space; interest neither expires automatically nor holds it.
2. **Prepare an agreement.** Select one or more numbered spaces and one combined annual rent. Review the contract's year-by-year rent before saving. A physically combined area retains its separate inventory numbers.
3. **Receive the first half.** Record any number of smaller payments. The full initial half secures all spaces together. A competing agreement cannot receive payments once another agreement has secured an overlapping period.
4. **Confirm actual building completion.** Initial leases begin on this date. The remaining half of year-one rent becomes due, and subsequent full annual payments fall on the anniversary. Changing the estimated date never starts a lease.
5. **Keep collecting annual rent.** Tenants who join after opening have their own start dates and anniversaries. Track balances, partial payments, overdue rent, and money actually received.

Rent changes can add a dollar amount, increase by a percentage, or set a new annual rent in a particular year. Any change can repeat yearly. Repeated changes use the previous year's amount; older rules apply before newer rules in the same year, in the displayed order. The preview uses the same calculation as the server. Contract lengths are currently whole years, from 1 to 50, with dates before 2100.

The first annual rent is split exactly into two installments; for an odd cent, the initial half receives that cent. Later tenants use the same two first-year installments, with the remaining half due on their own start date. From year two, each annual amount is due in full on the anniversary. Leap-day anniversaries clamp to February 28 in non-leap years and return to February 29 in leap years.

## Paperwork, cancellations, and corrections

Upload existing signed documents to each agreement: PDF, JPEG, or PNG, up to 10 MB each and 20 documents per agreement. Documents require owner authentication to download and are served as attachments. Their bytes are stored in SQLite, so database backups include them. The app does not generate legal contracts.

On cancellation, enter the individually agreed amount to keep. Unpaid rent is cancelled, the spaces are released, and original receipts remain. Refunds are recorded separately, including partial refunds. Cancelling does not transfer money. A mistaken payment can be voided with a reason; its history remains. Initial receipts securing an active lease, and receipts used by a cancellation settlement, are protected from voiding.

Paid agreements preserve their financial terms. Unpaid agreements can be edited. Use a new agreement for subsequently negotiated terms. Linked inventory and financial history cannot be silently deleted. The app records money received/refunded manually; it does not process online payments or automatically contact tenants. Follow-up dates are reminders inside the app.

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
npm run build
npm start
```

For development, `npm run dev` runs Vite on port 5173 and the API on port 3001. The production build uses one Node process, default port 3000. Local mode binds loopback. Create the owner account yourself through the local setup form; no default account, password, or sample records are installed.

## Deploy on Render

[Deploy on Render](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fmudaralsafi%2FOur-Own-Building-Managment)

The Blueprint uses the repository's `main` branch, one paid Node service, and a persistent disk. Connect the repository and review Render's price before deployment. The generated private `SETUP_TOKEN` is entered into the website once, when creating the owner account. See [DEPLOYMENT.md](DEPLOYMENT.md) for HTTPS, persistent storage, account recovery, and backups. A development workspace or a saved source change does not itself publish the website.

## Privacy, data, and backups

Owner passwords use scrypt hashes. Sessions are private HttpOnly cookies; production requires HTTPS and uses Secure cookies. All building APIs and documents require sign-in; writes also require the trusted website origin. Only health and account setup status are public. Registration closes after the first owner account.

Records and documents persist in `.data/building.sqlite`; hashed owner credentials and sessions persist in `.data/auth.sqlite`. Real data, environment files, dependencies, builds, and test outputs are ignored by Git. Production requires an explicit absolute `DATA_PATH` on persistent storage. Do not copy or delete a running database's WAL files independently.

Run `npm run backup` for a consistent database snapshot. Production also backs up after one minute and every 24 hours, retaining 14 snapshots. Keep private off-site copies and monitor disk capacity as document uploads and backups grow. The Settings JSON export includes record metadata; download document files individually or use the database backup for complete preservation. JSON import is not currently provided.

The rebuild creates separate agreement, annual-charge, payment, and document tables. Existing inventory and contacts are retained. Any earlier monthly leases remain unchanged and available in a protected legacy export; their overlapping spaces cannot be allocated again silently. Monthly contracts are never automatically converted into annual terms. A banner identifies records needing review.

## Validation

```sh
npm run build
npm test
npm run test:browser
```

Build before the production HTTP test. The browser check requires Chromium at `/usr/bin/chromium` or `CHROMIUM_PATH`. It creates disposable accounts and data under the temporary directory, never in the owner's workspace.

Checks cover exact annual calculations, mixed and repeating rent increases, overlapping interest, partial-payment allocation, competing agreements, idempotent payments, delayed and actual completion, individual anniversaries, cancellation settlements, refunds, protected corrections, document upload/download, backups including documents, persistence, preserved earlier records, owner authentication, origin checks, direct URLs, and phone layouts. Browser screenshots are written to ignored `test-results/`.

## Development environment

Use `/workspace/Our-Own-Building-Managment`; tasks already run in an isolated environment. Do not create a Git worktree unless explicitly requested. Start app processes again in a new task. Verify `/api/health` and `/api/auth/status` locally; anonymous `/api/state` and document downloads must return 401. Preserve both database files and all owner records. The [rebuild specification](REBUILD.md) records the owner's confirmed requirements.
