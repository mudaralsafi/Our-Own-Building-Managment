import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { annualSchedule, moneyCents } from "../shared/rent.mjs";

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const todayIn = (timeZone = "Asia/Baghdad", now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
export function addMonths(date, months) {
  const [y, m, d] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  first.setUTCDate(
    Math.min(
      d,
      new Date(
        Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
      ).getUTCDate(),
    ),
  );
  return first.toISOString().slice(0, 10);
}
const previousDay = (value) =>
  new Date(Date.parse(value) - 86400000).toISOString().slice(0, 10);
export function cents(value, name = "Amount", allowZero = false) {
  try {
    return moneyCents(value, allowZero);
  } catch (e) {
    throw new AppError(`${name}: ${e.message}`);
  }
}
function text(v, name, required = true, max = 250) {
  if (v == null && !required) return "";
  if (typeof v !== "string" || v.trim().length > max || (required && !v.trim()))
    throw new AppError(
      `${name} is required and must be under ${max} characters.`,
    );
  return v.trim();
}
function date(v, name) {
  if (
    typeof v !== "string" ||
    !/^20\d{2}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw new AppError(
      `Enter a valid ${name.toLowerCase()} between 2000 and 2099.`,
    );
  return v;
}
function choice(v, values, name) {
  if (!values.includes(v)) throw new AppError(`Choose a valid ${name}.`);
  return v;
}
export function createStore(filename, clock) {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1),name TEXT NOT NULL,address TEXT NOT NULL DEFAULT '',completion_date TEXT NOT NULL,time_zone TEXT NOT NULL DEFAULT 'Asia/Baghdad');
    CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,type TEXT NOT NULL,floor TEXT NOT NULL,area REAL NOT NULL,ready INTEGER NOT NULL DEFAULT 0,notes TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS renters(id TEXT PRIMARY KEY,name TEXT NOT NULL,company TEXT NOT NULL DEFAULT '',email TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS enquiries(id TEXT PRIMARY KEY,person_id TEXT NOT NULL REFERENCES renters(id),called_on TEXT NOT NULL,follow_up TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS enquiry_spaces(enquiry_id TEXT REFERENCES enquiries(id) ON DELETE CASCADE,space_id TEXT REFERENCES spaces(id),PRIMARY KEY(enquiry_id,space_id));
    CREATE TABLE IF NOT EXISTS agreements(id TEXT PRIMARY KEY,person_id TEXT NOT NULL REFERENCES renters(id),enquiry_id TEXT REFERENCES enquiries(id),agreed_on TEXT NOT NULL,start_mode TEXT NOT NULL,start_date TEXT NOT NULL DEFAULT '',years INTEGER NOT NULL,annual_rent INTEGER NOT NULL,rules TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',cancelled_on TEXT NOT NULL DEFAULT '',cancel_reason TEXT NOT NULL DEFAULT '',retained INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agreement_spaces(agreement_id TEXT REFERENCES agreements(id) ON DELETE CASCADE,space_id TEXT REFERENCES spaces(id),PRIMARY KEY(agreement_id,space_id));
    CREATE TABLE IF NOT EXISTS annual_rents(agreement_id TEXT REFERENCES agreements(id) ON DELETE CASCADE,year INTEGER NOT NULL,amount INTEGER NOT NULL,PRIMARY KEY(agreement_id,year));
    CREATE TABLE IF NOT EXISTS rent_charges(id TEXT PRIMARY KEY,agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,year INTEGER NOT NULL,kind TEXT NOT NULL,due_date TEXT,amount INTEGER NOT NULL CHECK(amount>0),UNIQUE(agreement_id,year,kind));
    CREATE TABLE IF NOT EXISTS rent_payments(id TEXT PRIMARY KEY,agreement_id TEXT NOT NULL REFERENCES agreements(id),charge_id TEXT REFERENCES rent_charges(id),kind TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),paid_date TEXT NOT NULL,method TEXT NOT NULL,reference TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,void_reason TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,agreement_id TEXT NOT NULL REFERENCES agreements(id),name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,created_at TEXT NOT NULL,content BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY AUTOINCREMENT,agreement_id TEXT REFERENCES agreements(id),message TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS payment_agreement ON rent_payments(agreement_id);
    CREATE INDEX IF NOT EXISTS payment_charge_v2 ON rent_payments(charge_id);
  `);
  if (
    !db
      .prepare("PRAGMA table_info(settings)")
      .all()
      .some((c) => c.name === "completed_date")
  )
    db.exec(
      "ALTER TABLE settings ADD COLUMN completed_date TEXT NOT NULL DEFAULT ''",
    );
  const today = () =>
    clock
      ? clock()
      : todayIn(
          db.prepare("SELECT time_zone FROM settings WHERE id=1").get()
            ?.time_zone,
        );
  db.prepare(
    "INSERT OR IGNORE INTO settings(id,name,completion_date) VALUES(1,?,?)",
  ).run("Our Building", addMonths(today(), 6));
  const all = (table) => db.prepare(`SELECT * FROM ${table}`).all();
  const settings = () => db.prepare("SELECT * FROM settings WHERE id=1").get();
  const get = (table, id) => {
    if (typeof id !== "string" || !id || id.length > 100)
      throw new AppError("Choose a valid record.");
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    if (!row) throw new AppError("This record could not be found.", 404);
    return row;
  };
  const transaction = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const audit = (id, message) =>
    db
      .prepare(
        "INSERT INTO activity(agreement_id,message,created_at) VALUES(?,?,?)",
      )
      .run(id, message, new Date().toISOString());
  const ids = (values, required = true) => {
    if (
      !Array.isArray(values) ||
      values.length > 100 ||
      (required && !values.length) ||
      new Set(values).size !== values.length
    )
      throw new AppError("Choose unique spaces, up to 100.");
    values.forEach((id) => get("spaces", id));
    return values;
  };
  const spaceIds = (id) =>
    db
      .prepare("SELECT space_id FROM agreement_spaces WHERE agreement_id=?")
      .all(id)
      .map((r) => r.space_id);
  const startFor = (a) =>
    a.start_mode === "completion" ? settings().completed_date : a.start_date;
  const paidFor = (id) =>
    db
      .prepare(
        "SELECT COALESCE(SUM(amount),0) AS paid FROM rent_payments WHERE charge_id=? AND kind='receipt' AND void_reason=''",
      )
      .get(id).paid;
  const secured = (id) => {
    const c = db
      .prepare(
        "SELECT * FROM rent_charges WHERE agreement_id=? AND kind='initial'",
      )
      .get(id);
    return Boolean(c && paidFor(c.id) >= c.amount);
  };
  const totals = (id) =>
    db
      .prepare(
        "SELECT COALESCE(SUM(CASE WHEN kind='receipt' THEN amount ELSE 0 END),0) AS received,COALESCE(SUM(CASE WHEN kind='refund' THEN amount ELSE 0 END),0) AS refunded FROM rent_payments WHERE agreement_id=? AND void_reason=''",
      )
      .get(id);
  const legacyExists = Boolean(
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='leases'",
      )
      .get(),
  );
  function legacy() {
    return legacyExists
      ? {
          leases: all("leases"),
          charges: all("charges"),
          payments: all("payments"),
          spaces: all("spaces"),
          renters: all("renters"),
        }
      : { leases: [], charges: [], payments: [] };
  }
  function assertAvailable(a) {
    const selected = spaceIds(a.id),
      start = startFor(a),
      end = start ? previousDay(addMonths(start, a.years * 12)) : "";
    for (const other of all("agreements")) {
      if (other.id === a.id || other.cancelled_on || !secured(other.id))
        continue;
      const otherStart = startFor(other),
        otherEnd = otherStart
          ? previousDay(addMonths(otherStart, other.years * 12))
          : "";
      if (start && otherStart && (start > otherEnd || otherStart > end))
        continue;
      const clash = spaceIds(other.id).find((id) => selected.includes(id));
      if (clash)
        throw new AppError(
          `${get("spaces", clash).name} is already secured by another agreement.`,
          409,
        );
    }
    if (legacyExists)
      for (const l of all("leases"))
        if (
          selected.includes(l.space_id) &&
          (!start || (l.start_date <= end && l.end_date >= start))
        )
          throw new AppError(
            "This space has an earlier monthly lease. Review the preserved records before allocating it.",
            409,
          );
  }
  function state() {
    const current = today();
    const agreements = all("agreements").map((a) => {
      const start = startFor(a),
        end = start ? previousDay(addMonths(start, a.years * 12)) : "",
        isSecured = secured(a.id),
        cash = totals(a.id);
      const status = a.cancelled_on
        ? "cancelled"
        : !isSecured
          ? "awaiting-payment"
          : !start
            ? "secured"
            : end < current
              ? "ended"
              : start > current
                ? "secured"
                : "active";
      return {
        ...a,
        rules: JSON.parse(a.rules),
        space_ids: spaceIds(a.id),
        effective_start: start,
        end_date: end,
        secured: isSecured,
        status,
        ...cash,
        refund_due: a.cancelled_on
          ? cash.received - a.retained - cash.refunded
          : 0,
        rents: db
          .prepare(
            "SELECT year,amount FROM annual_rents WHERE agreement_id=? ORDER BY year",
          )
          .all(a.id),
      };
    });
    const charges = all("rent_charges")
      .map((c) => {
        const paid = paidFor(c.id),
          a = agreements.find((a) => a.id === c.agreement_id),
          cancelled = Boolean(a.cancelled_on),
          balance = cancelled ? 0 : c.amount - paid;
        return {
          ...c,
          paid,
          balance,
          status: cancelled
            ? "cancelled"
            : !balance
              ? "paid"
              : !c.due_date
                ? "awaiting-start"
                : c.due_date < current
                  ? "overdue"
                  : paid
                    ? "partial"
                    : "upcoming",
        };
      })
      .sort(
        (a, b) =>
          (a.due_date || "9999").localeCompare(b.due_date || "9999") ||
          a.year - b.year,
      );
    return {
      today: current,
      settings: { ...settings(), currency: "USD" },
      spaces: all("spaces"),
      people: all("renters"),
      enquiries: all("enquiries").map((e) => ({
        ...e,
        space_ids: db
          .prepare("SELECT space_id FROM enquiry_spaces WHERE enquiry_id=?")
          .all(e.id)
          .map((r) => r.space_id),
      })),
      agreements,
      charges,
      payments: db
        .prepare(
          "SELECT * FROM rent_payments ORDER BY paid_date DESC,created_at DESC",
        )
        .all(),
      documents: db
        .prepare(
          "SELECT id,agreement_id,name,mime,size,sha256,created_at FROM documents ORDER BY created_at DESC",
        )
        .all(),
      activity: db.prepare("SELECT * FROM activity ORDER BY id DESC").all(),
      legacy_count: legacyExists
        ? db.prepare("SELECT COUNT(*) AS n FROM leases").get().n
        : 0,
    };
  }
  function saveSettings(data) {
    const name = text(data.name, "Building name", true, 100),
      address = text(data.address, "Address", false),
      completion = date(data.completion_date, "Estimated completion date"),
      zone = text(data.time_zone, "Time zone");
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone }).format();
    } catch {
      throw new AppError("Enter a valid time zone, such as Asia/Baghdad.");
    }
    db.prepare(
      "UPDATE settings SET name=?,address=?,completion_date=?,time_zone=? WHERE id=1",
    ).run(name, address, completion, zone);
  }
  function saveSpace(data, id) {
    if (id) get("spaces", id);
    const name = text(data.name, "Space number", true, 80),
      type = choice(data.type, ["Shop", "Office", "Rooftop"], "space type"),
      floor = text(data.floor, "Floor", true, 40),
      area = Number(data.area),
      notes = text(data.notes, "Notes", false, 3000);
    if (!Number.isFinite(area) || area <= 0 || area > 1000000)
      throw new AppError(
        "Enter an area greater than zero and at most 1,000,000 m².",
      );
    if (
      db
        .prepare("SELECT id FROM spaces WHERE name=? COLLATE NOCASE AND id!=?")
        .get(name, id || "")
    )
      throw new AppError("This space number already exists.");
    if (id)
      db.prepare(
        "UPDATE spaces SET name=?,type=?,floor=?,area=?,notes=? WHERE id=?",
      ).run(name, type, floor, area, notes, id);
    else {
      id = randomUUID();
      db.prepare(
        "INSERT INTO spaces(id,name,type,floor,area,notes) VALUES(?,?,?,?,?,?)",
      ).run(id, name, type, floor, area, notes);
    }
    return { id };
  }
  function savePerson(data, id) {
    if (id) get("renters", id);
    const name = text(data.name, "Name", true, 100),
      phone = text(data.phone, "Phone", true, 50),
      company = text(data.company, "Business", false, 100),
      email = text(data.email, "Email", false),
      notes = text(data.notes, "Notes", false, 3000);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new AppError("Enter a valid email address.");
    if (id)
      db.prepare(
        "UPDATE renters SET name=?,phone=?,company=?,email=?,notes=? WHERE id=?",
      ).run(name, phone, company, email, notes, id);
    else {
      id = randomUUID();
      db.prepare(
        "INSERT INTO renters(id,name,phone,company,email,notes) VALUES(?,?,?,?,?,?)",
      ).run(id, name, phone, company, email, notes);
    }
    return { id };
  }
  function saveEnquiry(data, id) {
    return transaction(() => {
      if (id) get("enquiries", id);
      const personId = data.person_id
        ? get("renters", data.person_id).id
        : savePerson(data.person || {}).id;
      const selected = ids(data.space_ids || [], false),
        called = date(data.called_on, "Call date"),
        follow = data.follow_up ? date(data.follow_up, "Follow-up date") : "",
        notes = text(data.notes, "Call notes", false, 5000);
      if (called > today())
        throw new AppError("The call date cannot be in the future.");
      if (typeof data.archived !== "boolean")
        throw new AppError("Choose an enquiry status.");
      if (id) {
        db.prepare(
          "UPDATE enquiries SET person_id=?,called_on=?,follow_up=?,notes=?,archived=? WHERE id=?",
        ).run(personId, called, follow, notes, Number(data.archived), id);
        db.prepare("DELETE FROM enquiry_spaces WHERE enquiry_id=?").run(id);
      } else {
        id = randomUUID();
        db.prepare(
          "INSERT INTO enquiries(id,person_id,called_on,follow_up,notes,archived) VALUES(?,?,?,?,?,?)",
        ).run(id, personId, called, follow, notes, Number(data.archived));
      }
      for (const sid of selected)
        db.prepare("INSERT INTO enquiry_spaces VALUES(?,?)").run(id, sid);
      return { id, person_id: personId };
    });
  }
  function saveAgreement(data, id) {
    if (id) {
      const old = get("agreements", id);
      if (
        old.cancelled_on ||
        db
          .prepare("SELECT id FROM rent_payments WHERE agreement_id=? LIMIT 1")
          .get(id)
      )
        throw new AppError(
          "Agreements with financial history are preserved. Create a new agreement for new terms.",
        );
    }
    get("renters", data.person_id);
    const selected = ids(data.space_ids),
      agreed = date(data.agreed_on, "Agreement date"),
      mode = choice(data.start_mode, ["completion", "date"], "start basis");
    if (agreed > today())
      throw new AppError("The agreement date cannot be in the future.");
    let start = "";
    if (mode === "date") {
      start = date(data.start_date, "Lease start date");
      if (!settings().completed_date || start < settings().completed_date)
        throw new AppError(
          "Confirm building completion before choosing an individual start date.",
        );
    }
    if (
      mode === "completion" &&
      settings().completed_date &&
      agreed > settings().completed_date
    )
      throw new AppError(
        "For an agreement made after completion, choose an individual start date.",
      );
    const effectiveStart =
      mode === "completion" ? settings().completed_date : start;
    if (effectiveStart && agreed > effectiveStart)
      throw new AppError(
        "The lease start cannot be before the agreement date.",
      );
    const notes = text(data.notes, "Agreement notes", false, 10000);
    let rents;
    try {
      rents = annualSchedule(
        data.annual_rent,
        Number(data.years),
        data.rules || [],
      );
    } catch (e) {
      throw new AppError(e.message);
    }
    if (
      effectiveStart &&
      addMonths(effectiveStart, rents.length * 12) > "2099-12-31"
    )
      throw new AppError("The contract must finish before 2100.");
    if (rents[0].amount < 2)
      throw new AppError(
        "Annual rent must be at least $0.02 to split into two payments.",
      );
    const enquiry = data.enquiry_id || null;
    if (enquiry && get("enquiries", enquiry).person_id !== data.person_id)
      throw new AppError("The enquiry belongs to another person.");
    return transaction(() => {
      const values = [
        data.person_id,
        enquiry,
        agreed,
        mode,
        start,
        rents.length,
        rents[0].amount,
        JSON.stringify(data.rules || []),
        notes,
      ];
      if (id) {
        db.prepare("DELETE FROM rent_charges WHERE agreement_id=?").run(id);
        db.prepare("DELETE FROM annual_rents WHERE agreement_id=?").run(id);
        db.prepare("DELETE FROM agreement_spaces WHERE agreement_id=?").run(id);
        db.prepare(
          "UPDATE agreements SET person_id=?,enquiry_id=?,agreed_on=?,start_mode=?,start_date=?,years=?,annual_rent=?,rules=?,notes=? WHERE id=?",
        ).run(...values, id);
      } else {
        id = randomUUID();
        db.prepare(
          "INSERT INTO agreements(person_id,enquiry_id,agreed_on,start_mode,start_date,years,annual_rent,rules,notes,id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ).run(...values, id, new Date().toISOString());
      }
      for (const sid of selected)
        db.prepare("INSERT INTO agreement_spaces VALUES(?,?)").run(id, sid);
      for (const r of rents)
        db.prepare("INSERT INTO annual_rents VALUES(?,?,?)").run(
          id,
          r.year,
          r.amount,
        );
      const insert = (year, kind, due, amount) =>
        db
          .prepare("INSERT INTO rent_charges VALUES(?,?,?,?,?,?)")
          .run(randomUUID(), id, year, kind, due, amount);
      const first = Math.ceil(rents[0].amount / 2);
      insert(1, "initial", agreed, first);
      insert(1, "completion", effectiveStart || null, rents[0].amount - first);
      for (const r of rents.slice(1))
        insert(
          r.year,
          "annual",
          effectiveStart ? addMonths(effectiveStart, (r.year - 1) * 12) : null,
          r.amount,
        );
      audit(
        id,
        "Agreement terms saved. Spaces remain available until the initial half is fully received.",
      );
      return { id };
    });
  }
  function completeBuilding(data) {
    const completed = date(data.completed_date, "Actual completion date");
    if (completed > today())
      throw new AppError(
        "Confirm completion only after the building is finished.",
      );
    return transaction(() => {
      const old = settings().completed_date;
      if (old) {
        if (old === completed) return { ok: true };
        throw new AppError(
          "Completion has already been confirmed. The recorded lease dates are preserved.",
        );
      }
      const pending = all("agreements").filter(
        (a) => a.start_mode === "completion" && !a.cancelled_on,
      );
      if (
        pending.some(
          (a) =>
            a.agreed_on > completed ||
            addMonths(completed, a.years * 12) > "2099-12-31",
        )
      )
        throw new AppError(
          "Completion must be on or after all agreement dates, and contracts must finish before 2100.",
        );
      db.prepare("UPDATE settings SET completed_date=? WHERE id=1").run(
        completed,
      );
      for (const a of pending) {
        if (secured(a.id)) assertAvailable(a);
        db.prepare(
          "UPDATE rent_charges SET due_date=? WHERE agreement_id=? AND kind='completion'",
        ).run(completed, a.id);
        for (const c of db
          .prepare(
            "SELECT * FROM rent_charges WHERE agreement_id=? AND kind='annual'",
          )
          .all(a.id))
          db.prepare("UPDATE rent_charges SET due_date=? WHERE id=?").run(
            addMonths(completed, (c.year - 1) * 12),
            c.id,
          );
        audit(
          a.id,
          `Building completion confirmed: ${completed}. Lease anniversary and rent due dates set.`,
        );
      }
      return { ok: true };
    });
  }
  function recordPayment(data) {
    const id = text(data.id, "Payment identifier", true, 100),
      kind = choice(data.kind, ["receipt", "refund"], "payment type"),
      amount = cents(data.amount),
      paid = date(data.paid_date, "Payment date"),
      method = choice(
        data.method,
        ["Cash", "Bank transfer", "Card", "Other"],
        "payment method",
      ),
      reference = text(data.reference, "Reference", false, 500);
    if (paid > today())
      throw new AppError(
        "Record money only after it has been received or refunded.",
      );
    return transaction(() => {
      const a = get("agreements", data.agreement_id),
        chargeId = kind === "receipt" ? data.charge_id : null;
      const existing = db
        .prepare("SELECT * FROM rent_payments WHERE id=?")
        .get(id);
      if (existing) {
        if (
          existing.agreement_id !== a.id ||
          existing.charge_id !== chargeId ||
          existing.kind !== kind ||
          existing.amount !== amount ||
          existing.paid_date !== paid ||
          existing.method !== method ||
          existing.reference !== reference
        )
          throw new AppError(
            "This payment identifier has already been used.",
            409,
          );
        return { id };
      }
      if (paid < a.agreed_on)
        throw new AppError("The payment cannot predate the agreement.");
      if (kind === "receipt") {
        if (a.cancelled_on)
          throw new AppError("This agreement has been cancelled.");
        const c = get("rent_charges", chargeId);
        if (c.agreement_id !== a.id)
          throw new AppError("Choose a charge from this agreement.");
        if (amount > c.amount - paidFor(c.id))
          throw new AppError("The amount exceeds the remaining balance.");
        if (c.kind !== "initial" && !secured(a.id))
          throw new AppError(
            "Receive the full initial half before recording later rent.",
          );
        assertAvailable(a);
      } else {
        const cash = totals(a.id);
        if (
          !a.cancelled_on ||
          amount > cash.received - a.retained - cash.refunded
        )
          throw new AppError("The refund exceeds the agreed refund balance.");
        if (paid < a.cancelled_on)
          throw new AppError("The refund cannot predate cancellation.");
      }
      db.prepare(
        "INSERT INTO rent_payments(id,agreement_id,charge_id,kind,amount,paid_date,method,reference,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        a.id,
        chargeId,
        kind,
        amount,
        paid,
        method,
        reference,
        new Date().toISOString(),
      );
      audit(
        a.id,
        `${kind === "receipt" ? "Payment received" : "Refund recorded"}: $${(amount / 100).toFixed(2)} on ${paid}.`,
      );
      return { id };
    });
  }
  function cancelAgreement(id, data) {
    const reason = text(data.reason, "Cancellation reason", true, 3000),
      cancelled = date(data.cancelled_on, "Cancellation date"),
      retained = cents(data.retained, "Amount to keep", true);
    return transaction(() => {
      const a = get("agreements", id);
      if (a.cancelled_on)
        throw new AppError("This agreement is already cancelled.");
      if (cancelled > today() || cancelled < a.agreed_on)
        throw new AppError(
          "Choose a cancellation date from the agreement date through today.",
        );
      const cash = totals(id);
      if (retained > cash.received)
        throw new AppError("The amount kept cannot exceed money received.");
      db.prepare(
        "UPDATE agreements SET cancelled_on=?,cancel_reason=?,retained=? WHERE id=?",
      ).run(cancelled, reason, retained, id);
      audit(
        id,
        `Agreement cancelled: ${reason}. Agreed amount to keep: $${(retained / 100).toFixed(2)}. Unpaid charges cancelled; receipts preserved.`,
      );
    });
  }
  function voidPayment(id, data) {
    const reason = text(data.reason, "Correction reason", true, 1000);
    return transaction(() => {
      const p = get("rent_payments", id),
        a = get("agreements", p.agreement_id);
      if (p.void_reason) throw new AppError("This entry is already voided.");
      if (a.cancelled_on && p.kind === "receipt")
        throw new AppError(
          "The cancellation settlement uses this receipt. Its history is preserved.",
        );
      const c = p.charge_id ? get("rent_charges", p.charge_id) : null;
      if (
        c?.kind === "initial" &&
        secured(a.id) &&
        startFor(a) &&
        startFor(a) <= today()
      )
        throw new AppError(
          "This initial payment secured an active lease and cannot be voided.",
        );
      db.prepare("UPDATE rent_payments SET void_reason=? WHERE id=?").run(
        reason,
        id,
      );
      audit(
        a.id,
        `Payment entry voided: ${reason}. This corrects the record; it does not transfer money.`,
      );
    });
  }
  function saveDocument(agreementId, name, mime, content) {
    get("agreements", agreementId);
    name = text(name, "File name", true, 180);
    if (/[\x00-\x1f\x7f/\\]/.test(name))
      throw new AppError(
        "Use a file name without slashes or control characters.",
      );
    if (
      !Buffer.isBuffer(content) ||
      !content.length ||
      content.length > 10 * 1024 * 1024
    )
      throw new AppError("Upload a file up to 10 MB.", 413);
    const valid =
      (mime === "application/pdf" &&
        content.subarray(0, 5).toString() === "%PDF-") ||
      (mime === "image/png" &&
        content
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (mime === "image/jpeg" &&
        content[0] === 255 &&
        content[1] === 216 &&
        content[2] === 255);
    if (!valid)
      throw new AppError(
        "Upload a PDF, JPEG, or PNG file with a matching file type.",
      );
    if (
      db
        .prepare("SELECT COUNT(*) AS n FROM documents WHERE agreement_id=?")
        .get(agreementId).n >= 20
    )
      throw new AppError("Each agreement can have up to 20 documents.");
    const id = randomUUID();
    db.prepare("INSERT INTO documents VALUES(?,?,?,?,?,?,?,?)").run(
      id,
      agreementId,
      name,
      mime,
      content.length,
      createHash("sha256").update(content).digest("hex"),
      new Date().toISOString(),
      content,
    );
    audit(agreementId, `Document attached: ${name}.`);
    return { id };
  }
  function remove(table, id) {
    choice(table, ["spaces", "enquiries", "documents"], "record type");
    get(table, id);
    if (
      table === "spaces" &&
      (db.prepare("SELECT 1 FROM agreement_spaces WHERE space_id=?").get(id) ||
        db.prepare("SELECT 1 FROM enquiry_spaces WHERE space_id=?").get(id) ||
        (legacyExists &&
          db.prepare("SELECT 1 FROM leases WHERE space_id=?").get(id)))
    )
      throw new AppError(
        "This space has history. Keep it to preserve linked records.",
      );
    if (
      table === "enquiries" &&
      db.prepare("SELECT 1 FROM agreements WHERE enquiry_id=?").get(id)
    )
      throw new AppError(
        "This enquiry is linked to an agreement. Archive it instead.",
      );
    if (table === "documents")
      audit(
        get("documents", id).agreement_id,
        "An attached document was removed.",
      );
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
  }
  return {
    state,
    legacy,
    saveSettings,
    saveSpace,
    savePerson,
    saveEnquiry,
    saveAgreement,
    completeBuilding,
    recordPayment,
    cancelAgreement,
    voidPayment,
    saveDocument,
    document: (id) => get("documents", id),
    remove,
    close: () => {
      if (db.isOpen) db.close();
    },
  };
}
