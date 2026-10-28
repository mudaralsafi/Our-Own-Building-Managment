import { useState, type FormEvent } from "react";
import { Plus, Trash2, Info } from "lucide-react";
import type {
  Agreement,
  Charge,
  Enquiry,
  Person,
  Space,
  State,
  Payment,
} from "./types";
import { annualSchedule, type RentChange } from "../shared/rent.mjs";
import { Button, Field, money, amountInput, dateLabel } from "./ui";
export type FormKind =
  | { kind: "space"; record?: Space }
  | { kind: "call"; record?: Enquiry; spaceId?: string }
  | { kind: "person"; record: Person }
  | { kind: "agreement"; record?: Agreement; enquiry?: Enquiry }
  | { kind: "payment"; agreement: Agreement; charge?: Charge; refund?: boolean }
  | { kind: "cancel"; agreement: Agreement }
  | { kind: "complete" }
  | { kind: "void"; payment: Payment }
  | { kind: "delete"; table: "documents" | "spaces"; id: string; name: string };
export const formTitles: Record<FormKind["kind"], string> = {
  space: "Space details",
  call: "Log a call",
  person: "Contact details",
  agreement: "Agreement terms",
  payment: "Record payment",
  cancel: "Cancel agreement",
  complete: "Confirm building completion",
  void: "Correct a payment entry",
  delete: "Remove record",
};
type Props = {
  spec: FormKind;
  state: State;
  submit: (path: string, method: string, data?: unknown) => Promise<void>;
  busy: boolean;
  error: string;
  close: () => void;
};
const dataFor = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget));
};
function SpacePicker({
  spaces,
  selected,
  onChange,
}: {
  spaces: Space[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="space-picker">
      <legend>Spaces</legend>
      {spaces.length ? (
        spaces.map((s) => (
          <label
            key={s.id}
            className={selected.includes(s.id) ? "selected" : ""}
          >
            <input
              type="checkbox"
              checked={selected.includes(s.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, s.id]
                    : selected.filter((id) => id !== s.id),
                )
              }
            />
            <span>
              <strong>{s.name}</strong>
              <small>
                {s.type} · {s.floor} · {s.area} m²
              </small>
            </span>
          </label>
        ))
      ) : (
        <p>Add your numbered spaces first.</p>
      )}
    </fieldset>
  );
}
export function RecordForm(props: Props) {
  const { spec, state, submit, busy, error, close } = props;
  const [selected, setSelected] = useState<string[]>(
    spec.kind === "agreement"
      ? spec.record?.space_ids || spec.enquiry?.space_ids || []
      : spec.kind === "call"
        ? spec.record?.space_ids || (spec.spaceId ? [spec.spaceId] : [])
        : [],
  );
  const [personId, setPersonId] = useState(
    spec.kind === "call"
      ? spec.record?.person_id || ""
      : spec.kind === "agreement"
        ? spec.record?.person_id || spec.enquiry?.person_id || ""
        : "",
  );
  const [startMode, setStartMode] = useState(
    spec.kind === "agreement"
      ? spec.record?.start_mode ||
          (state.settings.completed_date ? "date" : "completion")
      : "completion",
  );
  const [years, setYears] = useState(
    spec.kind === "agreement" ? spec.record?.years || 1 : 1,
  );
  const [rent, setRent] = useState(
    spec.kind === "agreement" ? amountInput(spec.record?.annual_rent) : "",
  );
  const [rules, setRules] = useState<RentChange[]>(
    spec.kind === "agreement" ? spec.record?.rules || [] : [],
  );
  const [chargeId, setChargeId] = useState(
    spec.kind === "payment"
      ? spec.charge?.id ||
          state.charges.find(
            (c) => c.agreement_id === spec.agreement.id && c.balance > 0,
          )?.id ||
          ""
      : "",
  );
  const [paymentId] = useState(() => crypto.randomUUID());
  const [keep, setKeep] = useState("0");
  const footer = (label = "Save") => (
    <>
      <div className="form-error" role={error ? "alert" : undefined}>
        {error}
      </div>
      <div className="form-footer">
        <Button variant="secondary" onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : label}
        </Button>
      </div>
    </>
  );
  if (spec.kind === "space") {
    const s = spec.record;
    return (
      <form
        onSubmit={(e) => {
          const d = dataFor(e);
          submit("spaces" + (s ? "/" + s.id : ""), s ? "PUT" : "POST", d);
        }}
      >
        <div className="form-grid">
          <Field label="Space number">
            <input
              name="name"
              defaultValue={s?.name}
              placeholder="e.g. G01"
              required
              maxLength={80}
            />
          </Field>
          <Field label="Type">
            <select name="type" defaultValue={s?.type || "Shop"}>
              <option>Shop</option>
              <option>Office</option>
              <option>Rooftop</option>
            </select>
          </Field>
          <Field label="Floor / level">
            <input
              name="floor"
              defaultValue={s?.floor}
              placeholder="Ground floor"
              required
              maxLength={40}
            />
          </Field>
          <Field label="Area (m²)">
            <input
              name="area"
              type="number"
              min="0.01"
              max="1000000"
              step="0.01"
              defaultValue={s?.area}
              required
            />
          </Field>
          <Field label="Notes" wide>
            <textarea name="notes" defaultValue={s?.notes} maxLength={3000} />
          </Field>
        </div>
        {footer("Save space")}
      </form>
    );
  }
  if (spec.kind === "person") {
    const p = spec.record;
    return (
      <form onSubmit={(e) => submit("people/" + p.id, "PUT", dataFor(e))}>
        <div className="form-grid">
          <Field label="Name">
            <input name="name" defaultValue={p.name} required maxLength={100} />
          </Field>
          <Field label="Phone">
            <input
              name="phone"
              type="tel"
              defaultValue={p.phone}
              required
              maxLength={50}
            />
          </Field>
          <Field label="Business / activity">
            <input name="company" defaultValue={p.company} maxLength={100} />
          </Field>
          <Field label="Email">
            <input name="email" type="email" defaultValue={p.email} />
          </Field>
          <Field label="Contact notes" wide>
            <textarea name="notes" defaultValue={p.notes} />
          </Field>
        </div>
        {footer("Save contact")}
      </form>
    );
  }
  if (spec.kind === "call") {
    const r = spec.record;
    return (
      <form
        onSubmit={(e) => {
          const d = dataFor(e);
          submit("enquiries" + (r ? "/" + r.id : ""), r ? "PUT" : "POST", {
            person_id: personId || undefined,
            person: personId
              ? undefined
              : {
                  name: d.name,
                  phone: d.phone,
                  company: d.company,
                  email: d.email,
                },
            space_ids: selected,
            called_on: d.called_on,
            follow_up: d.follow_up,
            notes: d.notes,
            archived: d.archived === "true",
          });
        }}
      >
        <div className="form-grid">
          <Field label="Caller" wide>
            <select
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
            >
              <option value="">New caller</option>
              {state.people.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name} · {p.phone}
                </option>
              ))}
            </select>
          </Field>
          {!personId && (
            <>
              <Field label="Name">
                <input
                  name="name"
                  required
                  placeholder="Caller's full name"
                  maxLength={100}
                />
              </Field>
              <Field label="Phone">
                <input
                  name="phone"
                  type="tel"
                  required
                  placeholder="Phone number"
                  maxLength={50}
                />
              </Field>
              <Field label="Business / activity">
                <input
                  name="company"
                  placeholder="e.g. Pharmacy"
                  maxLength={100}
                />
              </Field>
              <Field label="Email (optional)">
                <input name="email" type="email" />
              </Field>
            </>
          )}
          <Field label="Call date">
            <input
              type="date"
              name="called_on"
              defaultValue={r?.called_on || state.today}
              max={state.today}
              required
            />
          </Field>
          <Field label="Follow up on (optional)">
            <input type="date" name="follow_up" defaultValue={r?.follow_up} />
          </Field>
        </div>
        <SpacePicker
          spaces={state.spaces}
          selected={selected}
          onChange={setSelected}
        />
        <p className="hint">
          <Info size={14} />
          Interest keeps spaces available for other callers.
        </p>
        <Field label="Call notes">
          <textarea
            name="notes"
            defaultValue={r?.notes}
            placeholder="What are they looking for? Any terms discussed?"
            maxLength={5000}
          />
        </Field>
        {r && (
          <Field label="Enquiry status">
            <select name="archived" defaultValue={String(Boolean(r.archived))}>
              <option value="false">Open interest</option>
              <option value="true">Archived</option>
            </select>
          </Field>
        )}
        {footer(r ? "Save call" : "Log call")}
      </form>
    );
  }
  if (spec.kind === "agreement") {
    const a = spec.record;
    let schedule: { year: number; amount: number }[] = [];
    let previewError = "";
    try {
      if (rent) schedule = annualSchedule(rent, years, rules);
    } catch (e) {
      previewError = (e as Error).message;
    }
    const changeRule = (index: number, patch: Partial<RentChange>) =>
      setRules(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    return (
      <form
        onSubmit={(e) => {
          const d = dataFor(e);
          submit("agreements" + (a ? "/" + a.id : ""), a ? "PUT" : "POST", {
            ...d,
            person_id: personId,
            space_ids: selected,
            enquiry_id: a?.enquiry_id || spec.enquiry?.id,
            annual_rent: rent,
            years,
            rules,
            start_mode: startMode,
          });
        }}
      >
        <div className="section-label">01 · Person & spaces</div>
        <Field label="Tenant">
          <select
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            required
          >
            <option value="">Choose a person</option>
            {state.people.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name} · {p.company || p.phone}
              </option>
            ))}
          </select>
        </Field>
        <SpacePicker
          spaces={state.spaces}
          selected={selected}
          onChange={setSelected}
        />
        <p className="hint">
          One annual rent covers all {selected.length || "selected"} spaces.
          Each space stays separately numbered.
        </p>
        <div className="section-label">02 · Dates & annual rent</div>
        <div className="form-grid">
          <Field label="Agreement date">
            <input
              name="agreed_on"
              type="date"
              defaultValue={a?.agreed_on || state.today}
              max={state.today}
              required
            />
          </Field>
          <Field label="Lease starts">
            <select
              value={startMode}
              onChange={(e) =>
                setStartMode(e.target.value as "completion" | "date")
              }
            >
              <option value="completion">When the building is completed</option>
              {state.settings.completed_date && (
                <option value="date">On the tenant's own start date</option>
              )}
            </select>
          </Field>
          {startMode === "date" && (
            <Field label="Lease start date">
              <input
                name="start_date"
                type="date"
                defaultValue={a?.start_date || state.today}
                min={state.settings.completed_date}
                required
              />
            </Field>
          )}
          <Field label="Contract length (years)">
            <input
              type="number"
              min="1"
              max="50"
              step="1"
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
              required
            />
          </Field>
          <Field
            label="First annual rent (USD)"
            hint="Combined amount for all selected spaces."
          >
            <input
              type="number"
              min="0.02"
              step="0.01"
              value={rent}
              onChange={(e) => setRent(e.target.value)}
              required
            />
          </Field>
        </div>
        <div className="section-label section-between">
          <span>03 · Future rent changes</span>
          {years > 1 && (
            <Button
              variant="secondary"
              onClick={() =>
                setRules([
                  ...rules,
                  { year: 2, type: "percent", value: "5", repeat: false },
                ])
              }
            >
              <Plus size={14} />
              Add change
            </Button>
          )}
        </div>
        <p className="hint">
          Leave this empty for fixed rent. Repeated changes apply to the
          previous year's rent. Earlier rules apply before newer rules in the
          same year.
        </p>
        {rules.map((r, i) => (
          <div className="rule" key={i}>
            <Field label={`Change ${i + 1}: from year`}>
              <input
                type="number"
                min="2"
                max={years}
                value={r.year}
                onChange={(e) =>
                  changeRule(i, { year: Number(e.target.value) })
                }
                required
              />
            </Field>
            <Field label={`Change ${i + 1}: method`}>
              <select
                value={r.type}
                onChange={(e) =>
                  changeRule(i, { type: e.target.value as RentChange["type"] })
                }
              >
                <option value="percent">Increase by %</option>
                <option value="add">Add USD</option>
                <option value="set">Set annual rent to USD</option>
              </select>
            </Field>
            <Field label={`Change ${i + 1}: value`}>
              <input
                type="number"
                step="0.01"
                min="0"
                value={r.value}
                onChange={(e) => changeRule(i, { value: e.target.value })}
                required
              />
            </Field>
            <label className="check-line">
              <input
                type="checkbox"
                checked={r.repeat}
                onChange={(e) => changeRule(i, { repeat: e.target.checked })}
              />
              Repeat yearly
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove change ${i + 1}`}
              onClick={() => setRules(rules.filter((_, n) => n !== i))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {previewError && (
          <p className="form-error" role="alert">
            {previewError}
          </p>
        )}
        {schedule.length > 0 && (
          <div className="rent-preview">
            <h3>Review the rent schedule</h3>
            <div className="split-summary">
              <div>
                <small>First payment · secures spaces</small>
                <strong>{money(Math.ceil(schedule[0].amount / 2))}</strong>
              </div>
              <div>
                <small>Remaining half · at lease start</small>
                <strong>{money(Math.floor(schedule[0].amount / 2))}</strong>
              </div>
            </div>
            <div className="year-grid">
              {schedule.map((r) => (
                <div key={r.year}>
                  <span>Year {r.year}</span>
                  <strong>{money(r.amount)}</strong>
                  <small>
                    {r.year === 1
                      ? "Two installments"
                      : "Due on lease anniversary"}
                  </small>
                </div>
              ))}
            </div>
          </div>
        )}
        <Field label="Agreement notes">
          <textarea
            name="notes"
            defaultValue={a?.notes}
            maxLength={10000}
            placeholder="Other agreed terms and references to your paperwork"
          />
        </Field>
        <p className="hint">
          Attach your signed paperwork after saving. Spaces become secured only
          when the full first payment is received.
        </p>
        {footer("Save agreement")}
      </form>
    );
  }
  if (spec.kind === "payment") {
    const a = spec.agreement;
    const charges = state.charges.filter(
      (c) => c.agreement_id === a.id && c.balance > 0,
    );
    const charge = charges.find((c) => c.id === chargeId);
    const maximum = spec.refund ? a.refund_due : charge?.balance;
    return (
      <form
        onSubmit={(e) => {
          const d = dataFor(e);
          submit("payments", "POST", {
            ...d,
            id: paymentId,
            kind: spec.refund ? "refund" : "receipt",
            agreement_id: a.id,
            charge_id: spec.refund ? undefined : chargeId,
          });
        }}
      >
        <p className="form-intro">
          {state.people.find((p) => p.id === a.person_id)?.name} ·{" "}
          {a.space_ids
            .map((id) => state.spaces.find((s) => s.id === id)?.name)
            .join(" + ")}
        </p>
        {!spec.refund && (
          <Field label="Payment for">
            <select
              value={chargeId}
              onChange={(e) => setChargeId(e.target.value)}
              required
            >
              {charges.map((c) => (
                <option key={c.id} value={c.id}>
                  Year {c.year} ·{" "}
                  {c.kind === "initial"
                    ? "First half"
                    : c.kind === "completion"
                      ? "Remaining half"
                      : "Annual rent"}{" "}
                  · {money(c.balance)} left
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="payment-balance">
          <span>{spec.refund ? "Refund still owed" : "Remaining balance"}</span>
          <strong>{money(maximum || 0)}</strong>
        </div>
        <div className="form-grid">
          <Field
            label={
              spec.refund ? "Amount refunded (USD)" : "Amount received (USD)"
            }
          >
            <input
              key={chargeId}
              name="amount"
              type="number"
              min="0.01"
              max={amountInput(maximum)}
              step="0.01"
              defaultValue={amountInput(maximum)}
              required
            />
          </Field>
          <Field label="Payment date">
            <input
              name="paid_date"
              type="date"
              defaultValue={state.today}
              min={spec.refund ? a.cancelled_on : a.agreed_on}
              max={state.today}
              required
            />
          </Field>
          <Field label="Payment method">
            <select name="method">
              <option>Cash</option>
              <option>Bank transfer</option>
              <option>Card</option>
              <option>Other</option>
            </select>
          </Field>
          <Field label="Reference (optional)">
            <input
              name="reference"
              maxLength={500}
              placeholder="Receipt or transfer reference"
            />
          </Field>
        </div>
        <p className="hint">
          Record money already {spec.refund ? "refunded" : "received"}. This
          does not transfer money.
        </p>
        {footer(spec.refund ? "Record refund" : "Record payment")}
      </form>
    );
  }
  if (spec.kind === "cancel") {
    const a = spec.agreement;
    const parsed = Number(keep);
    return (
      <form
        onSubmit={(e) =>
          submit("agreements/" + a.id + "/cancel", "POST", dataFor(e))
        }
      >
        <p className="form-intro">
          Cancel this agreement and release its spaces. Existing receipts stay
          in the history. Unpaid rent is cancelled.
        </p>
        <div className="payment-balance">
          <span>Total received</span>
          <strong>{money(a.received)}</strong>
        </div>
        <div className="form-grid">
          <Field label="Cancellation date">
            <input
              type="date"
              name="cancelled_on"
              defaultValue={state.today}
              min={a.agreed_on}
              max={state.today}
              required
            />
          </Field>
          <Field label="Agreed amount to keep (USD)">
            <input
              type="number"
              name="retained"
              value={keep}
              onChange={(e) => setKeep(e.target.value)}
              min="0"
              max={amountInput(a.received)}
              step="0.01"
              required
            />
          </Field>
          <Field label="Reason / settlement notes" wide>
            <textarea name="reason" required maxLength={3000} />
          </Field>
        </div>
        <div className="notice">
          Refund to record separately:{" "}
          <strong>
            {money(
              Math.max(
                0,
                a.received -
                  Math.round((Number.isFinite(parsed) ? parsed : 0) * 100),
              ),
            )}
          </strong>
        </div>
        {footer("Cancel agreement")}
      </form>
    );
  }
  if (spec.kind === "complete") {
    const affected = state.agreements.filter(
      (a) => a.start_mode === "completion" && !a.cancelled_on,
    );
    return (
      <form onSubmit={(e) => submit("completion", "POST", dataFor(e))}>
        <p className="form-intro">
          This sets the actual start date for {affected.length} agreement
          {affected.length !== 1 ? "s" : ""}, makes the remaining first-year
          rent due, and sets future anniversaries. Spaces become active only
          after the initial half is paid.
        </p>
        <div className="notice">
          Confirm the actual completion date carefully. Once recorded, it is
          preserved with the lease history.
        </div>
        <Field label="Actual completion date">
          <input
            type="date"
            name="completed_date"
            defaultValue={state.today}
            max={state.today}
            required
          />
        </Field>
        {affected.length > 0 && (
          <ul className="affected-list">
            {affected.map((a) => (
              <li key={a.id}>
                {state.people.find((p) => p.id === a.person_id)?.name} ·{" "}
                {a.space_ids
                  .map((id) => state.spaces.find((s) => s.id === id)?.name)
                  .join(" + ")}{" "}
                · remaining{" "}
                {money(
                  state.charges.find(
                    (c) => c.agreement_id === a.id && c.kind === "completion",
                  )?.balance || 0,
                )}
              </li>
            ))}
          </ul>
        )}
        {footer("Confirm completion")}
      </form>
    );
  }
  if (spec.kind === "void")
    return (
      <form
        onSubmit={(e) =>
          submit("payments/" + spec.payment.id + "/void", "POST", dataFor(e))
        }
      >
        <p className="form-intro">
          Use this only for an incorrectly entered payment. It preserves the
          original entry with a correction reason and reopens the balance. It
          does not refund money.
        </p>
        <Field label="Correction reason">
          <textarea name="reason" required maxLength={1000} />
        </Field>
        {footer("Void entry")}
      </form>
    );
  if (spec.kind === "delete")
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(spec.table + "/" + spec.id, "DELETE");
        }}
      >
        <p className="form-intro">
          Remove “{spec.name}”? This removes the saved record.
        </p>
        {footer("Remove")}
      </form>
    );
  return null;
}
