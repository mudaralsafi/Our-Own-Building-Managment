import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createStore, addMonths, cents, todayIn } from "../server/store.mjs";
import { annualSchedule } from "../shared/rent.mjs";
function fixture(t, filename = ":memory:") {
  let now = "2026-10-28";
  const store = createStore(filename, () => now);
  t.after(() => store.close());
  const spaces = ["G01", "G02", "Roof"].map(
    (name, i) =>
      store.saveSpace({
        name,
        type: i === 2 ? "Rooftop" : "Shop",
        floor: i === 2 ? "Roof" : "Ground",
        area: 80 + i,
      }).id,
  );
  const person = store.savePerson({
    name: "Test Tenant",
    phone: "+964 000 0000",
    company: "Test Business",
  }).id;
  const terms = {
    person_id: person,
    space_ids: spaces.slice(0, 2),
    agreed_on: now,
    start_mode: "completion",
    years: 4,
    annual_rent: "12000",
    rules: [],
  };
  const payment = (a, amount, extra = {}) => {
    const charge = store
      .state()
      .charges.find((c) => c.agreement_id === a && c.kind === "initial");
    return store.recordPayment({
      id: crypto.randomUUID(),
      agreement_id: a,
      charge_id: charge.id,
      kind: "receipt",
      amount,
      paid_date: now,
      method: "Cash",
      reference: "",
      ...extra,
    });
  };
  return {
    store,
    spaces,
    person,
    terms,
    payment,
    setToday: (value) => {
      now = value;
    },
  };
}
test("exact USD amounts and annual rules handle fixed, additive, percentage and repeating increases", () => {
  assert.equal(cents("0.10"), 10);
  assert.equal(cents("1200.55"), 120055);
  for (const v of ["-1", "1e3", "1.001", "", "Infinity", "0"])
    assert.throws(() => cents(v));
  assert.deepEqual(
    annualSchedule("10000", 5, [
      { year: 2, type: "add", value: "1000", repeat: false },
      { year: 3, type: "percent", value: "5", repeat: true },
      { year: 5, type: "set", value: "20000", repeat: false },
    ]).map((r) => r.amount),
    [1000000, 1100000, 1155000, 1212750, 2000000],
  );
  assert.deepEqual(
    annualSchedule("10.01", 3, [
      { year: 2, type: "percent", value: "5", repeat: true },
    ]).map((r) => r.amount),
    [1001, 1051, 1104],
  );
  assert.throws(() =>
    annualSchedule("10", 2, [
      { year: 3, type: "percent", value: "5", repeat: true },
    ]),
  );
  assert.throws(() =>
    annualSchedule("999999999", 50, [
      { year: 2, type: "percent", value: "1000", repeat: true },
    ]),
  );
});
test("anniversaries preserve leap-day anchor; timezone is Baghdad", () => {
  assert.equal(addMonths("2028-02-29", 12), "2029-02-28");
  assert.equal(addMonths("2028-02-29", 48), "2032-02-29");
  assert.equal(
    todayIn("Asia/Baghdad", new Date("2026-10-27T22:00:00Z")),
    "2026-10-28",
  );
});
test("multiple interested callers can share spaces indefinitely without allocation", (t) => {
  const { store, spaces, person } = fixture(t);
  for (let i = 0; i < 3; i++)
    store.saveEnquiry({
      person_id: person,
      space_ids: spaces,
      called_on: "2026-10-28",
      archived: false,
      notes: "Interested",
    });
  assert.equal(store.state().enquiries.length, 3);
  assert.equal(store.state().agreements.length, 0);
  const before = store.state().people.length;
  assert.throws(() =>
    store.saveEnquiry({
      person: { name: "Invalid", phone: "123" },
      space_ids: ["missing"],
      called_on: "2026-10-28",
      archived: false,
    }),
  );
  assert.equal(
    store.state().people.length,
    before,
    "failed call must not leave an orphan contact",
  );
});
test("one combined annual price covers all spaces without duplicate rent or security deposits", (t) => {
  const { store, terms } = fixture(t);
  const a = store.saveAgreement(terms).id;
  const s = store.state();
  assert.equal(s.agreements[0].space_ids.length, 2);
  assert.equal(s.agreements[0].status, "awaiting-payment");
  assert.equal(s.charges.length, 5);
  assert.equal(
    s.charges.filter((c) => c.year === 1).reduce((n, c) => n + c.amount, 0),
    1200000,
  );
  assert.equal(s.charges.filter((c) => c.kind === "deposit").length, 0);
  assert.equal(s.charges.find((c) => c.kind === "completion").due_date, null);
  assert.ok(s.charges.every((c) => c.agreement_id === a));
});
test("partial payments secure all spaces only at the full first-half threshold", (t) => {
  const { store, terms, payment } = fixture(t);
  const a = store.saveAgreement(terms).id;
  payment(a, "2000");
  assert.equal(store.state().agreements[0].secured, false);
  payment(a, "3999.99");
  assert.equal(store.state().agreements[0].secured, false);
  payment(a, "0.01");
  assert.equal(store.state().agreements[0].status, "secured");
  assert.equal(store.state().agreements[0].received, 600000);
});
test("first fully paid agreement wins; a competing agreement cannot receive more money for taken spaces", (t) => {
  const { store, terms, payment } = fixture(t);
  const a = store.saveAgreement(terms).id,
    b = store.saveAgreement(terms).id;
  payment(b, "100");
  payment(a, "6000");
  assert.throws(() => payment(b, "5900"), /already secured/);
  assert.equal(
    store.state().agreements.find((x) => x.id === b).received,
    10000,
  );
  assert.equal(store.state().payments.length, 2);
});
test("duplicate receipt retries are idempotent and changed retries conflict", (t) => {
  const { store, terms, payment } = fixture(t);
  const a = store.saveAgreement(terms).id;
  payment(a, "100", { id: "same" });
  payment(a, "100", { id: "same" });
  assert.equal(store.state().payments.length, 1);
  assert.throws(() => payment(a, "101", { id: "same" }), /identifier/);
  assert.throws(() => payment(a, "6000"), /exceeds/);
});
test("delaying the estimate leaves real start dates and annual charges unset", (t) => {
  const { store, terms, payment } = fixture(t);
  const a = store.saveAgreement(terms).id;
  payment(a, "6000");
  store.saveSettings({
    name: "Test",
    address: "",
    completion_date: "2028-01-01",
    time_zone: "Asia/Baghdad",
  });
  const s = store.state();
  assert.equal(s.agreements[0].effective_start, "");
  assert.ok(
    s.charges
      .filter((c) => c.kind !== "initial")
      .every((c) => c.due_date === null && c.status === "awaiting-start"),
  );
});
test("actual completion activates secured agreements, dates charges once, and retains partial receipts", (t) => {
  const { store, terms, payment, setToday } = fixture(t);
  const a = store.saveAgreement(terms).id;
  payment(a, "6000");
  setToday("2027-04-29");
  store.completeBuilding({ completed_date: "2027-04-28" });
  store.completeBuilding({ completed_date: "2027-04-28" });
  let s = store.state();
  assert.equal(s.agreements[0].status, "active");
  assert.equal(s.agreements[0].effective_start, "2027-04-28");
  assert.equal(s.agreements[0].end_date, "2031-04-27");
  assert.equal(s.charges.length, 5);
  assert.equal(
    s.charges.find((c) => c.kind === "completion").status,
    "overdue",
  );
  assert.equal(s.charges.find((c) => c.year === 2).due_date, "2028-04-28");
  assert.equal(s.payments.length, 1);
  assert.throws(
    () => store.completeBuilding({ completed_date: "2027-04-29" }),
    /already/,
  );
});
test("completion cannot be guessed from a future date or put before agreement dates", (t) => {
  const { store, terms } = fixture(t);
  store.saveAgreement(terms);
  assert.throws(
    () => store.completeBuilding({ completed_date: "2027-04-28" }),
    /after/,
  );
  assert.throws(
    () => store.completeBuilding({ completed_date: "2026-10-27" }),
    /agreement dates/,
  );
  assert.equal(store.state().settings.completed_date, "");
});
test("later tenants get their own start dates, anniversary and rent increases", (t) => {
  const { store, spaces, terms, payment, setToday } = fixture(t);
  store.completeBuilding({ completed_date: "2026-10-28" });
  setToday("2027-01-15");
  const a = store.saveAgreement({
    ...terms,
    agreed_on: "2027-01-15",
    space_ids: [spaces[2]],
    start_mode: "date",
    start_date: "2027-02-01",
    rules: [{ year: 3, type: "percent", value: "10", repeat: true }],
  }).id;
  payment(a, "6000");
  const s = store.state();
  assert.equal(s.agreements[0].effective_start, "2027-02-01");
  assert.equal(s.charges.find((c) => c.year === 2).due_date, "2028-02-01");
  assert.equal(s.charges.find((c) => c.year === 3).amount, 1320000);
  assert.equal(s.charges.find((c) => c.year === 4).amount, 1452000);
  assert.throws(
    () => store.saveAgreement({ ...terms, agreed_on: "2027-01-15" }),
    /individual start/,
  );
});
test("later scheduled leases can use a space after the inclusive end of an existing lease", (t) => {
  const { store, terms, payment } = fixture(t);
  store.completeBuilding({ completed_date: "2026-10-28" });
  const a = store.saveAgreement({ ...terms, years: 1 }).id;
  payment(a, "6000");
  const b = store.saveAgreement({
    ...terms,
    years: 1,
    start_mode: "date",
    start_date: "2027-10-28",
  }).id;
  payment(b, "6000");
  assert.equal(store.state().agreements.filter((a) => a.secured).length, 2);
  const c = store.saveAgreement({
    ...terms,
    years: 1,
    start_mode: "date",
    start_date: "2027-10-27",
  }).id;
  assert.throws(() => payment(c, "6000"), /secured/);
});
test("cancellation preserves receipts, releases spaces and records partial refunds against individual settlement", (t) => {
  const { store, terms, payment } = fixture(t);
  const a = store.saveAgreement(terms).id;
  payment(a, "6000");
  store.cancelAgreement(a, {
    cancelled_on: "2026-10-28",
    retained: "1000",
    reason: "Agreed individual settlement",
  });
  let s = store.state();
  assert.equal(s.agreements[0].refund_due, 500000);
  assert.ok(
    s.charges.every((c) => c.balance === 0 && c.status === "cancelled"),
  );
  assert.equal(s.payments.length, 1);
  assert.throws(() => payment(a, "1"), /cancelled/);
  payment(a, "2000", { kind: "refund", charge_id: undefined, id: "refund-1" });
  payment(a, "2000", { kind: "refund", charge_id: undefined, id: "refund-1" });
  assert.equal(store.state().agreements[0].refund_due, 300000);
  assert.throws(
    () => payment(a, "3000.01", { kind: "refund", charge_id: undefined }),
    /refund/,
  );
  const b = store.saveAgreement(terms).id;
  payment(b, "6000");
  assert.equal(store.state().agreements.find((x) => x.id === b).secured, true);
});
test("financial terms cannot erase history; voided entry remains auditable and cannot be repeated", (t) => {
  const { store, terms, payment } = fixture(t);
  const a = store.saveAgreement(terms).id,
    p = payment(a, "100").id;
  assert.throws(
    () => store.saveAgreement({ ...terms, annual_rent: "1" }, a),
    /history/,
  );
  store.voidPayment(p, { reason: "Entered the wrong amount" });
  assert.equal(store.state().payments.length, 1);
  assert.equal(store.state().agreements[0].received, 0);
  assert.match(store.state().payments[0].void_reason, /wrong/);
  assert.throws(() => store.voidPayment(p, { reason: "Again" }), /already/);
});
test("active initial payments and settlement receipts cannot be voided", (t) => {
  const { store, terms, payment } = fixture(t);
  const a = store.saveAgreement(terms).id,
    p = payment(a, "6000").id;
  store.completeBuilding({ completed_date: "2026-10-28" });
  assert.throws(
    () => store.voidPayment(p, { reason: "Correction" }),
    /active lease/,
  );
  store.cancelAgreement(a, {
    cancelled_on: "2026-10-28",
    retained: "6000",
    reason: "Cancelled",
  });
  assert.throws(
    () => store.voidPayment(p, { reason: "Correction" }),
    /settlement/,
  );
});
test("unpaid agreements are editable, invalid changes roll back without destroying existing schedule", (t) => {
  const { store, terms } = fixture(t);
  const a = store.saveAgreement(terms).id;
  store.saveAgreement({ ...terms, annual_rent: "14000", years: 2 }, a);
  assert.equal(store.state().charges.length, 3);
  assert.equal(store.state().charges[0].amount, 700000);
  assert.throws(() =>
    store.saveAgreement({ ...terms, space_ids: ["missing"] }, a),
  );
  assert.equal(store.state().charges.length, 3);
});
test("odd-cent totals split without losing cents and later payments require full initial payment", (t) => {
  const { store, terms, payment } = fixture(t);
  const a = store.saveAgreement({
    ...terms,
    annual_rent: "10.01",
    years: 1,
  }).id;
  const charges = store.state().charges;
  assert.equal(charges.find((c) => c.kind === "initial").amount, 501);
  assert.equal(charges.find((c) => c.kind === "completion").amount, 500);
  assert.throws(
    () =>
      payment(a, "1", {
        charge_id: charges.find((c) => c.kind === "completion").id,
      }),
    /initial half/,
  );
  assert.throws(
    () => payment(a, "1", { paid_date: "2026-10-29" }),
    /received or refunded/,
  );
});
test("documents are validated, stored intact, metadata excludes bytes, and linked spaces are protected", (t) => {
  const { store, terms, spaces } = fixture(t);
  const a = store.saveAgreement(terms).id,
    bytes = Buffer.from("%PDF-1.7\nTest contract");
  const d = store.saveDocument(
    a,
    "Signed contract.pdf",
    "application/pdf",
    bytes,
  ).id;
  assert.deepEqual(Buffer.from(store.document(d).content), bytes);
  assert.equal(store.state().documents[0].content, undefined);
  assert.throws(
    () =>
      store.saveDocument(
        a,
        "attack.html",
        "text/html",
        Buffer.from("<script>"),
      ),
    /PDF/,
  );
  assert.throws(
    () => store.saveDocument(a, "../test.pdf", "application/pdf", bytes),
    /file name/,
  );
  assert.throws(
    () =>
      store.saveDocument(a, "fake.pdf", "application/pdf", Buffer.from("fake")),
    /matching/,
  );
  assert.throws(() => store.remove("spaces", spaces[0]), /history/);
  store.remove("documents", d);
  assert.equal(store.state().documents.length, 0);
});
test("agreements, receipts and attachments survive reopening SQLite", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "building-v2-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "db.sqlite");
  const first = createStore(path, () => "2026-10-28");
  const space = first.saveSpace({
    name: "G01",
    type: "Shop",
    floor: "G",
    area: 80,
  }).id;
  const p = first.savePerson({ name: "Tenant", phone: "123" }).id;
  const a = first.saveAgreement({
    person_id: p,
    space_ids: [space],
    agreed_on: "2026-10-28",
    start_mode: "completion",
    years: 1,
    annual_rent: "1000",
  }).id;
  const doc = first.saveDocument(
    a,
    "Lease.pdf",
    "application/pdf",
    Buffer.from("%PDF-1.4"),
  ).id;
  first.close();
  const second = createStore(path);
  assert.equal(second.state().agreements[0].id, a);
  assert.equal(second.document(doc).name, "Lease.pdf");
  second.close();
});
test("old monthly records stay readable and cannot be silently double allocated", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "building-legacy-"));
  const path = join(dir, "db.sqlite");
  const { store, terms, spaces, payment } = fixture(t, path);
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE leases(id TEXT,space_id TEXT,start_date TEXT,end_date TEXT);CREATE TABLE charges(id TEXT);CREATE TABLE payments(id TEXT)",
  );
  db.prepare("INSERT INTO leases VALUES(?,?,?,?)").run(
    "old",
    spaces[0],
    "2026-01-01",
    "2028-01-01",
  );
  db.close();
  store.close();
  const fresh = createStore(path, () => "2026-10-28");
  assert.equal(fresh.state().legacy_count, 1);
  assert.equal(fresh.legacy().leases[0].id, "old");
  const a = fresh.saveAgreement(terms).id;
  const c = fresh
    .state()
    .charges.find((c) => c.agreement_id === a && c.kind === "initial");
  assert.throws(
    () =>
      fresh.recordPayment({
        id: "p",
        agreement_id: a,
        charge_id: c.id,
        kind: "receipt",
        amount: "6000",
        paid_date: "2026-10-28",
        method: "Cash",
      }),
    /earlier monthly/,
  );
  fresh.close();
  rmSync(dir, { recursive: true, force: true });
});
