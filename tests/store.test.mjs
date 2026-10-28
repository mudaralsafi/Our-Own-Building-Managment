import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, addMonths, cents, todayIn } from '../server/store.mjs';

function fixture(t, filename = ':memory:') {
  const store = createStore(filename, () => '2026-10-27');
  t.after(() => store.close());
  const space = store.saveSpace({ name: 'Shop G01', type: 'Shop', floor: 'Ground', area: 85.5, ready: false });
  const renter = store.saveRenter({ name: 'Test Renter', email: 'renter@example.test' });
  const terms = { space_id: space.id, renter_id: renter.id, start_date: '2026-10-01', end_date: '2027-09-30', first_due_date: '2026-10-01', monthly_rent: '1200.55', deposit: '1000', deposit_due_date: '2026-10-01' };
  return { store, space, renter, terms };
}
const payment = (charge, overrides = {}) => ({ id: 'payment-one', charge_id: charge.id, amount: '400.20', paid_date: '2026-10-27', method: 'Bank transfer', reference: 'Receipt 001', ...overrides });

test('money is stored exactly in cents and rejects ambiguous or negative amounts', () => {
  assert.equal(cents('1200.55'), 120055);
  assert.equal(cents('0.10'), 10);
  assert.equal(cents('123.4'), 12340);
  for (const invalid of ['-1', '1.001', '1e3', 'Infinity', '', '1,000', '0']) assert.throws(() => cents(invalid));
  assert.equal(cents('0', 'Deposit', true), 0);
});
test('month-end billing preserves its original anchor, including leap years', () => {
  assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addMonths('2027-01-31', 2), '2027-03-31');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(todayIn('Asia/Baghdad', new Date('2026-10-26T22:00:00Z')), '2026-10-27');
});
test('a future reservation can collect a deposit now without charging rent before opening', t => {
  const { store, terms } = fixture(t);
  const { id } = store.saveLease({ ...terms, start_date: '2027-04-01', end_date: '2028-03-31', first_due_date: '2027-05-01' });
  const state = store.state();
  assert.equal(state.leases[0].status, 'reserved');
  assert.equal(state.charges.filter(c => c.kind === 'rent').length, 11);
  assert.equal(state.charges.filter(c => c.kind === 'rent')[0].due_date, '2027-05-01');
  const deposit = state.charges.find(c => c.kind === 'deposit');
  assert.equal(deposit.amount, 100000);
  assert.equal(deposit.status, 'overdue');
  assert.equal(deposit.lease_id, id);
  assert.equal(state.charges.filter(c => c.kind === 'rent' && c.due_date < terms.start_date).length, 0);
});
test('overlapping space allocations are blocked, including inclusive end dates', t => {
  const { store, terms } = fixture(t);
  store.saveLease(terms);
  assert.throws(() => store.saveLease(terms), /already allocated/);
  assert.throws(() => store.saveLease({ ...terms, start_date: '2027-09-30', end_date: '2028-09-29', first_due_date: '2027-09-30' }), /already allocated/);
  store.saveLease({ ...terms, start_date: '2027-10-01', end_date: '2028-09-30', first_due_date: '2027-10-01' });
  assert.equal(store.state().leases.length, 2);
});
test('lease schedule clamps dates without drifting after February', t => {
  const { store, terms } = fixture(t);
  store.saveLease({ ...terms, start_date: '2027-01-31', end_date: '2027-04-30', first_due_date: '2027-01-31', deposit: 0 });
  assert.deepEqual(store.state().charges.map(c => c.due_date), ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
});
test('partial payments update exact balances; duplicate requests do not double-count', t => {
  const { store, terms } = fixture(t);
  store.saveLease(terms);
  const charge = store.state().charges.find(c => c.kind === 'rent');
  store.recordPayment(payment(charge));
  store.recordPayment(payment(charge));
  let state = store.state();
  assert.equal(state.payments.length, 1);
  let updated = state.charges.find(c => c.id === charge.id);
  assert.equal(updated.paid, 40020);
  assert.equal(updated.balance, 80035);
  assert.equal(updated.status, 'overdue');
  assert.throws(() => store.recordPayment(payment(charge, { amount: '12' })), /identifier was already used/);
  assert.throws(() => store.recordPayment(payment(charge, { id: 'too-much', amount: '800.36' })), /exceeds/);
  store.recordPayment(payment(charge, { id: 'remaining', amount: '800.35' }));
  updated = store.state().charges.find(c => c.id === charge.id);
  assert.equal(updated.balance, 0);
  assert.equal(updated.status, 'paid');
  store.remove('payments', 'remaining');
  assert.equal(store.state().charges.find(c => c.id === charge.id).balance, 80035);
});
test('rent due today is not overdue and future charges are upcoming or partially paid', t => {
  const { store, terms } = fixture(t);
  store.saveLease({ ...terms, start_date: '2026-10-27', first_due_date: '2026-10-27', deposit: 0 });
  assert.equal(store.state().charges[0].status, 'upcoming');
  store.recordPayment(payment(store.state().charges[0]));
  assert.equal(store.state().charges[0].status, 'partial');
  assert.throws(() => store.recordPayment(payment(store.state().charges[0], { id: 'future', paid_date: '2026-10-28' })), /already|received/);
});
test('paid financial terms and rental history are protected from editing or deletion', t => {
  const { store, terms, space, renter } = fixture(t);
  const lease = store.saveLease(terms);
  store.recordPayment(payment(store.state().charges.find(c => c.kind === 'rent')));
  assert.throws(() => store.saveLease({ ...terms, monthly_rent: '1' }, lease.id), /has payments/);
  assert.throws(() => store.remove('leases', lease.id), /recorded payments/);
  assert.throws(() => store.remove('spaces', space.id), /lease history/);
  assert.throws(() => store.remove('renters', renter.id), /lease history/);
});
test('editing an unpaid lease replaces its schedule without orphaned charges', t => {
  const { store, terms } = fixture(t);
  const lease = store.saveLease(terms);
  store.saveLease({ ...terms, monthly_rent: '1500', deposit: '0', end_date: '2026-12-31' }, lease.id);
  assert.equal(store.state().charges.length, 3);
  assert.ok(store.state().charges.every(c => c.amount === 150000));
});
test('ending a lease preserves deposits and earlier charges, and rejects removal of paid future rent', t => {
  const { store, terms } = fixture(t);
  const lease = store.saveLease(terms);
  const future = store.state().charges.find(c => c.kind === 'rent' && c.due_date === '2027-01-01');
  store.recordPayment(payment(future));
  assert.throws(() => store.endLease(lease.id, { end_date: '2026-12-31' }), /payments against rent/);
  store.remove('payments', 'payment-one');
  store.endLease(lease.id, { end_date: '2026-12-31' });
  const state = store.state();
  assert.equal(state.charges.filter(c => c.kind === 'rent').length, 3);
  assert.equal(state.charges.filter(c => c.kind === 'deposit').length, 1);
  assert.equal(state.leases[0].end_date, '2026-12-31');
});
test('invalid dates, spaces, amounts, and time zones are rejected without changes', t => {
  const { store, terms } = fixture(t);
  assert.throws(() => store.saveLease({ ...terms, start_date: '2026-02-31' }), /valid/);
  assert.throws(() => store.saveLease({ ...terms, first_due_date: '2026-09-01' }), /within/);
  assert.throws(() => store.saveLease({ ...terms, end_date: '2040-01-01' }), /ten years/);
  assert.throws(() => store.saveLease({ ...terms, monthly_rent: -1 }), /USD amount/);
  assert.throws(() => store.saveSpace({ name: 'Shop g01', type: 'Shop', floor: 'Ground', area: 20, ready: true }), /already exists/);
  assert.throws(() => store.saveSpace({ name: 'New', type: 'Shop', floor: 'Ground', area: -5, ready: true }), /Area/);
  assert.throws(() => store.saveSettings({ name: 'Test', completion_date: '2027-04-27', time_zone: 'invalid/zone' }), /time zone/);
  assert.equal(store.state().leases.length, 0);
  assert.equal(store.state().charges.length, 0);
});
test('SQLite persists records across server restarts', t => {
  const directory = mkdtempSync(join(tmpdir(), 'our-building-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'building.sqlite');
  const first = createStore(filename, () => '2026-10-27');
  const space = first.saveSpace({ name: 'Roof east', type: 'Rooftop', floor: 'Roof', area: 150, ready: true });
  first.close();
  const second = createStore(filename, () => '2026-10-27');
  assert.equal(second.state().spaces[0].id, space.id);
  assert.equal(second.state().spaces[0].type, 'Rooftop');
  second.close();
});
