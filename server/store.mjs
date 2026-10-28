import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function todayIn(timeZone = 'Asia/Baghdad', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function addMonths(date, months) {
  const [year, month, day] = date.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}
function text(value, name, required = true, max = 250) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new AppError(`${name} is required and must be under ${max} characters.`);
  return value.trim();
}
function date(value, name) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new AppError(`Enter a valid ${name.toLowerCase()} between 2000 and 2099.`);
  return value;
}
function choice(value, choices, name) {
  if (!choices.includes(value)) throw new AppError(`Choose a valid ${name.toLowerCase()}.`);
  return value;
}
export function cents(value, name = 'Amount', allowZero = false) {
  const normalized = String(value ?? '').trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(normalized)) throw new AppError(`${name} must be a USD amount with up to two decimal places.`);
  const [whole, decimal = ''] = normalized.split('.');
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!allowZero && amount === 0) throw new AppError(`${name} must be greater than zero.`);
  return amount;
}

export function createStore(filename, clock) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', completion_date TEXT NOT NULL, time_zone TEXT NOT NULL DEFAULT 'Asia/Baghdad');
    CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, type TEXT NOT NULL, floor TEXT NOT NULL, area REAL NOT NULL, ready INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS renters (id TEXT PRIMARY KEY, name TEXT NOT NULL, company TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id), renter_id TEXT NOT NULL REFERENCES renters(id), start_date TEXT NOT NULL, end_date TEXT NOT NULL, first_due_date TEXT NOT NULL, monthly_rent INTEGER NOT NULL CHECK(monthly_rent>0), deposit INTEGER NOT NULL DEFAULT 0, deposit_due_date TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS charges (id TEXT PRIMARY KEY, lease_id TEXT NOT NULL REFERENCES leases(id) ON DELETE CASCADE, kind TEXT NOT NULL, due_date TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), UNIQUE(lease_id,kind,due_date));
    CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, charge_id TEXT NOT NULL REFERENCES charges(id), amount INTEGER NOT NULL CHECK(amount>0), paid_date TEXT NOT NULL, method TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS charge_dates ON charges(due_date);
    CREATE INDEX IF NOT EXISTS payment_charge ON payments(charge_id);
  `);
  const today = () => clock ? clock() : todayIn(db.prepare('SELECT time_zone FROM settings WHERE id=1').get()?.time_zone);
  db.prepare('INSERT OR IGNORE INTO settings(id,name,completion_date) VALUES(1,?,?)').run('Our Building', addMonths(today(), 6));
  const all = table => db.prepare(`SELECT * FROM ${table}`).all();
  const get = (table, id) => {
    if (typeof id !== 'string' || !id || id.length > 100) throw new AppError('Choose a valid record.');
    const record = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    if (!record) throw new AppError('This record could not be found. Refresh and try again.', 404);
    return record;
  };
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  function state() {
    const current = today();
    const charges = db.prepare(`SELECT c.*, COALESCE(SUM(p.amount),0) AS paid FROM charges c LEFT JOIN payments p ON p.charge_id=c.id GROUP BY c.id ORDER BY c.due_date`).all().map(c => ({ ...c, balance: c.amount - c.paid, status: c.paid === c.amount ? 'paid' : c.due_date < current ? 'overdue' : c.paid ? 'partial' : 'upcoming' }));
    return {
      today: current, settings: { ...db.prepare('SELECT * FROM settings WHERE id=1').get(), currency: 'USD' },
      spaces: all('spaces'), renters: all('renters'),
      leases: all('leases').map(l => ({ ...l, status: l.end_date < current ? 'ended' : l.start_date > current ? 'reserved' : 'active' })),
      charges, payments: db.prepare('SELECT * FROM payments ORDER BY paid_date DESC,created_at DESC').all(),
    };
  }
  function saveSettings(data) {
    const name = text(data.name, 'Building name', true, 100);
    const address = text(data.address, 'Address', false);
    const completion = date(data.completion_date, 'Completion date');
    const zone = text(data.time_zone, 'Time zone', true, 100);
    try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); }
    catch { throw new AppError('Enter a valid time zone, such as Asia/Baghdad.'); }
    db.prepare('UPDATE settings SET name=?,address=?,completion_date=?,time_zone=? WHERE id=1').run(name, address, completion, zone);
  }
  function saveSpace(data, id) {
    if (id) get('spaces', id);
    const name = text(data.name, 'Space name', true, 80);
    const type = choice(data.type, ['Shop', 'Office', 'Rooftop'], 'Space type');
    const floor = text(data.floor, 'Floor', true, 40);
    const area = Number(data.area);
    if (!Number.isFinite(area) || area <= 0 || area > 1000000) throw new AppError('Area must be greater than 0 and at most 1,000,000 m².');
    if (typeof data.ready !== 'boolean') throw new AppError('Choose whether the space is ready.');
    const notes = text(data.notes, 'Notes', false, 3000);
    const conflict = db.prepare('SELECT id FROM spaces WHERE name=? COLLATE NOCASE AND id!=?').get(name, id || '');
    if (conflict) throw new AppError('A space with this name already exists. Use a unique name.');
    const values = [name, type, floor, area, Number(data.ready), notes];
    if (id) db.prepare('UPDATE spaces SET name=?,type=?,floor=?,area=?,ready=?,notes=? WHERE id=?').run(...values, id);
    else { id = randomUUID(); db.prepare('INSERT INTO spaces(name,type,floor,area,ready,notes,id) VALUES(?,?,?,?,?,?,?)').run(...values, id); }
    return { id };
  }
  function saveRenter(data, id) {
    if (id) get('renters', id);
    const name = text(data.name, 'Renter name', true, 100);
    const email = text(data.email, 'Email', false);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('Enter a valid email address.');
    const values = [name, text(data.company, 'Company', false, 100), email, text(data.phone, 'Phone', false, 50), text(data.notes, 'Notes', false, 3000)];
    if (id) db.prepare('UPDATE renters SET name=?,company=?,email=?,phone=?,notes=? WHERE id=?').run(...values, id);
    else { id = randomUUID(); db.prepare('INSERT INTO renters(name,company,email,phone,notes,id) VALUES(?,?,?,?,?,?)').run(...values, id); }
    return { id };
  }
  function saveLease(data, id) {
    if (id) {
      get('leases', id);
      if (db.prepare('SELECT p.id FROM payments p JOIN charges c ON c.id=p.charge_id WHERE c.lease_id=? LIMIT 1').get(id)) throw new AppError('This lease has payments. Its financial terms are preserved; end the lease to stop future rent.');
    }
    const space = get('spaces', data.space_id); get('renters', data.renter_id);
    const start = date(data.start_date, 'Lease start date');
    const end = date(data.end_date, 'Lease end date');
    const firstDue = date(data.first_due_date, 'First rent due date');
    if (end < start || end > addMonths(start, 120)) throw new AppError('A lease must end on or after its start, within ten years.');
    if (firstDue < start || firstDue > end) throw new AppError('The first rent due date must fall within the lease dates.');
    if (db.prepare('SELECT id FROM leases WHERE space_id=? AND start_date<=? AND end_date>=? AND id!=?').get(space.id, end, start, id || '')) throw new AppError(`${space.name} is already allocated during these dates. Choose a different space or dates.`);
    const rent = cents(data.monthly_rent, 'Monthly rent');
    const deposit = cents(data.deposit || '0', 'Deposit', true);
    const depositDue = date(data.deposit_due_date || today(), 'Deposit due date');
    if (deposit && depositDue > end) throw new AppError('The deposit must be due on or before the lease end date.');
    const notes = text(data.notes, 'Notes', false, 3000);
    return transaction(() => {
      const values = [data.space_id, data.renter_id, start, end, firstDue, rent, deposit, depositDue, notes];
      if (id) {
        db.prepare('DELETE FROM charges WHERE lease_id=?').run(id);
        db.prepare('UPDATE leases SET space_id=?,renter_id=?,start_date=?,end_date=?,first_due_date=?,monthly_rent=?,deposit=?,deposit_due_date=?,notes=? WHERE id=?').run(...values, id);
      } else {
        id = randomUUID();
        db.prepare('INSERT INTO leases(space_id,renter_id,start_date,end_date,first_due_date,monthly_rent,deposit,deposit_due_date,notes,id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(...values, id);
      }
      const insert = db.prepare('INSERT INTO charges(id,lease_id,kind,due_date,amount) VALUES(?,?,?,?,?)');
      for (let offset = 0; ; offset++) {
        const due = addMonths(firstDue, offset);
        if (due > end) break;
        insert.run(randomUUID(), id, 'rent', due, rent);
      }
      if (deposit) insert.run(randomUUID(), id, 'deposit', depositDue, deposit);
      return { id };
    });
  }
  function endLease(id, data) {
    const lease = get('leases', id);
    const end = date(data.end_date, 'New end date');
    if (end < lease.start_date || end > lease.end_date) throw new AppError('Choose an end date within the existing lease dates.');
    if (db.prepare('SELECT p.id FROM payments p JOIN charges c ON c.id=p.charge_id WHERE c.lease_id=? AND c.kind=\'rent\' AND c.due_date>? LIMIT 1').get(id, end)) throw new AppError('There are payments against rent after this date. Resolve those payments before ending the lease.');
    transaction(() => {
      db.prepare('DELETE FROM charges WHERE lease_id=? AND kind=\'rent\' AND due_date>?').run(id, end);
      db.prepare('UPDATE leases SET end_date=? WHERE id=?').run(end, id);
    });
  }
  function recordPayment(data) {
    const id = text(data.id, 'Payment identifier', true, 100);
    const amount = cents(data.amount);
    const paidDate = date(data.paid_date, 'Payment date');
    if (paidDate > today()) throw new AppError('Record payments only after they have been received.');
    const method = choice(data.method, ['Cash', 'Bank transfer', 'Card', 'Other'], 'Payment method');
    const reference = text(data.reference, 'Reference', false);
    return transaction(() => {
      const existing = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
      if (existing) {
        if (existing.charge_id !== data.charge_id || existing.amount !== amount || existing.paid_date !== paidDate || existing.method !== method || existing.reference !== reference) throw new AppError('This payment identifier was already used. Refresh before recording another payment.', 409);
        return { id };
      }
      const charge = get('charges', data.charge_id);
      const paid = db.prepare('SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE charge_id=?').get(charge.id).paid;
      if (amount > charge.amount - paid) throw new AppError('The payment exceeds the remaining balance. Refresh to see recent payments.');
      db.prepare('INSERT INTO payments(id,charge_id,amount,paid_date,method,reference,created_at) VALUES(?,?,?,?,?,?,?)').run(id, charge.id, amount, paidDate, method, reference, new Date().toISOString());
      return { id };
    });
  }
  function remove(table, id) {
    choice(table, ['spaces', 'renters', 'leases', 'payments'], 'Record type'); get(table, id);
    if (table === 'spaces' && db.prepare('SELECT id FROM leases WHERE space_id=?').get(id)) throw new AppError('This space has lease history and cannot be deleted.');
    if (table === 'renters' && db.prepare('SELECT id FROM leases WHERE renter_id=?').get(id)) throw new AppError('This renter has lease history and cannot be deleted.');
    if (table === 'leases' && db.prepare('SELECT p.id FROM payments p JOIN charges c ON c.id=p.charge_id WHERE c.lease_id=?').get(id)) throw new AppError('A lease with recorded payments cannot be deleted.');
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
  }
  return { state, saveSettings, saveSpace, saveRenter, saveLease, endLease, recordPayment, remove, close: () => db.close() };
}
