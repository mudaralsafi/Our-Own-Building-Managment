# Building management rebuild

Requirements confirmed with the owner on 28 October 2026. This document describes
the replacement workflow and the implementation acceptance criteria.

## Purpose and users

One owner manages enquiries now, advance rent and agreements before completion,
and annual rent after opening. English interface, USD amounts, usable on a phone
and a computer. Fast call entry and clear next actions take priority over a large
dashboard. No staff roles or tenant portal are currently requested.

## Confirmed business rules

### Spaces and interest

- Shops, offices, and rooftop spaces are already divided and numbered.
- A tenant can rent and physically connect multiple spaces. Each numbered space
  remains a distinct inventory record.
- Several people can express interest in the same space. Recording a name does
  not exclusively reserve the space, and interest has no automatic expiry.
- The first agreement to receive the full initial half of its first annual rent
  secures its spaces. Signing paperwork alone does not secure them.
- One agreement can cover several spaces at one combined annual rent. Do not
  invent a per-space allocation of that rent or count it once for each space.

### Rent and commencement

- Rent is agreed annually. Contract length varies by agreement.
- Before opening, the first half of year-one rent is received when the parties
  agree. It is advance rent, not a refundable security deposit.
- The remaining half is due when the whole building is completed.
- For these initial tenants, the rental period begins on actual building
  completion. There is no rent-free fit-out period.
- An estimated completion date is planning information. Reaching that estimate
  must not automatically start leases or make completion-linked rent overdue.
- From year two onward, the full year's rent is due on the lease anniversary.
- Tenants joining after opening have their own lease start dates and anniversaries.
  The owner's phrase "owner's start date" was understood in context as each
  later tenant's own start date; the interface should make that date explicit.
- Annual rent can stay fixed, change in a particular year, or increase repeatedly
  starting in a later year. The owner must be able to represent different terms
  for different contracts and review the resulting year-by-year amounts.
- Signed contracts and other paperwork are handled outside the app. The owner
  uploads copies. Contract generation and a legal template are not requested.

## Proposed daily workflow

1. **Log a call:** name, phone, business/activity, spaces of interest, notes. The
   same person can be found again without re-entering their contact details.
2. **Prepare an agreement:** select the person and one or more spaces, enter the
   combined annual rent, contract duration, start basis, and future rent terms.
   Show the first two payments and the annual schedule in plain language.
3. **Record money received:** show the unpaid initial half and whether the
   agreement has secured its spaces. Check every included space together before
   allocating any of them. Concurrent submissions cannot double-allocate a space.
4. **Keep paperwork together:** attach copies to the agreement and retrieve them
   from its detail screen. Uploading a contract does not itself change allocation.
5. **Confirm building completion:** review the actual date and affected agreements
   before activating their rental periods and dating the remaining first-year
   payments. Repeating the action must not duplicate charges.
6. **Manage annual rent:** show due dates, received amounts, remaining balances,
   and the applicable annual amount. Later tenants retain their own anniversaries.

## Proposed navigation

- **Overview:** actions requiring attention, unpaid amounts due, advance rent
  received, and available/secured/occupied space counts with clear definitions.
- **Calls & interest:** searchable people and enquiries, notes, and an action to
  prepare an agreement. Multiple interested callers remain visible per space.
- **Spaces:** numbered inventory, floor, type, area, availability, interested
  callers, and linked agreement. Combined agreements do not merge inventory.
- **Agreements:** person, all spaces, combined price, stage, annual rent schedule,
  payments, uploaded documents, and history together.
- **Payments:** amounts due, amounts received, dates, payment method/reference,
  balances, and export. Manual recording only; no online collection is requested.
- **Settings:** building information, actual completion, owner account, and backups.

Labels should state what actually happened: "Interested", "Awaiting first
payment", "Secured — awaiting completion", and "Active". Avoid calling a
non-exclusive enquiry a confirmed reservation.

## Final confirmed rules

- Rent changes can mix percentages, fixed dollar increases, and newly agreed
  annual amounts. Show the resulting annual schedule before saving.
- Either first-year installment can be paid in smaller payments. Allocation
  happens only when the full initial half has been received.
- The owner decides each cancellation settlement individually. Record the amount
  to keep, the refund owed, and each refund actually paid without erasing receipts.

## Engineering implications and verification

- Replace the existing one-space, monthly-rent lease model with an agreement,
  agreement-to-space links, annual rent schedule, and completion-linked charges.
- Keep amounts in integer USD cents. Annual rule rounding, leap-day anniversaries,
  and splitting odd-cent annual totals need deterministic behavior and tests.
- Retain the owner sign-in, server-side authorization, and production deployment
  safeguards. Uploaded documents must be private, validated, size-limited, and
  included in the persistent storage and backup design.
- Preserve existing files and financial records during development. Existing
  monthly contracts, if any, cannot be silently interpreted as new annual terms.
  Inspect record counts without exposing tenant information before migration.
- Verify enquiry conversion, combined agreements without duplicate rent,
  competing interests, payment-triggered allocation, construction delays,
  completion activation, later tenant anniversaries, varying annual rents,
  document access, persistence, and phone/computer workflows.
- Build and test with disposable sample data. Do not create an owner account or
  test financial records in the owner's production workspace.
- Publishing the rebuilt site is a separate step from changing and validating
  its source. The existing Render deployment configuration must remain usable.
