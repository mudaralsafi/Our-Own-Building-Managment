import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  FileText,
  HardHat,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Settings2,
  Upload,
  Users,
  Wallet,
  X,
  Pencil,
  Trash2,
  ArrowUpRight,
} from "lucide-react";
import type { Agreement, Charge, Page, State } from "./types";
import { request } from "./api";
import { AccountSecurity } from "./Auth";
import {
  Badge,
  Button,
  Empty,
  Field,
  Modal,
  dateLabel,
  download,
  money,
} from "./ui";
import { RecordForm, formTitles, type FormKind } from "./forms";
const paths: Record<Page, string> = {
  Overview: "/overview",
  "Calls & interest": "/calls",
  Spaces: "/spaces",
  Agreements: "/agreements",
  Payments: "/payments",
  Settings: "/settings",
};
const pageFromUrl = () =>
  (Object.entries(paths).find(([, p]) => p === location.pathname)?.[0] ||
    { "/renters": "Calls & interest", "/leases": "Agreements" }[
      location.pathname
    ] ||
    "Overview") as Page;
const nav = [
  { name: "Overview" as Page, icon: LayoutDashboard },
  { name: "Calls & interest" as Page, icon: Phone },
  { name: "Spaces" as Page, icon: Building2 },
  { name: "Agreements" as Page, icon: FileText },
  { name: "Payments" as Page, icon: Wallet },
];
const chargeLabel = (c: Charge) =>
  c.kind === "initial"
    ? "First half"
    : c.kind === "completion"
      ? "Remaining half"
      : `Year ${c.year} rent`;
function csv(value: unknown) {
  let s = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export default function App({
  ownerEmail,
  onSignOut,
}: {
  ownerEmail: string;
  onSignOut: () => Promise<void>;
}) {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState("");
  const [page, setPage] = useState<Page>(pageFromUrl),
    [selectedId, setSelectedId] = useState(
      new URLSearchParams(location.search).get("id") || "",
    );
  const [form, setForm] = useState<FormKind | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All"),
    [tab, setTab] = useState("Due"),
    [mobile, setMobile] = useState(false),
    [contacts, setContacts] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const refresh = async () => {
    const next = await request("state");
    setState(next);
  };
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const sync = () => {
      setPage(pageFromUrl());
      setSelectedId(new URLSearchParams(location.search).get("id") || "");
      setSearch("");
      setFilter("All");
      setForm(null);
      setMobile(false);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  useEffect(() => {
    document.title = `${page} · Our Building`;
  }, [page]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    };
    const timer = setInterval(visible, 60000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  const go = (next: Page, id = "") => {
    history.pushState(
      {},
      "",
      paths[next] + (id ? "?id=" + encodeURIComponent(id) : ""),
    );
    setPage(next);
    setSelectedId(id);
    setSearch("");
    setFilter("All");
    setForm(null);
    setError("");
    setMobile(false);
    window.scrollTo(0, 0);
  };
  const open = (spec: FormKind) => {
    setError("");
    setForm(spec);
  };
  const mutate = async (path: string, method: string, data?: unknown) => {
    setBusy(true);
    setError("");
    try {
      const result = await request(path, method, data);
      await refresh();
      setForm(null);
      setToast("Saved");
      if (path === "agreements" && method === "POST")
        go("Agreements", result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!state)
    return (
      <div className="loading-screen">
        <Building2 size={34} />
        <h1>Our Building</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button onClick={() => refresh().catch((e) => setError(e.message))}>
              Try again
            </Button>
          </>
        ) : (
          <p>Opening your workspace…</p>
        )}
      </div>
    );
  const {
    today,
    settings,
    spaces,
    people,
    enquiries,
    agreements,
    charges,
    payments,
    documents,
  } = state;
  const person = (id: string) => people.find((p) => p.id === id)!;
  const spaceNames = (ids: string[]) =>
    ids
      .map((id) => spaces.find((s) => s.id === id)?.name || "Unknown space")
      .join(" + ");
  const agreement = (id: string) => agreements.find((a) => a.id === id)!;
  const matches = (...values: (string | undefined)[]) =>
    values.some((v) => v?.toLowerCase().includes(search.toLowerCase()));
  const selected = agreements.find((a) => a.id === selectedId);
  const securedAgreements = agreements.filter((a) =>
    ["secured", "active"].includes(a.status),
  );
  const allocation = (id: string) =>
    securedAgreements.find((a) => a.space_ids.includes(id));
  const allocated = spaces.filter((s) => allocation(s.id)).length;
  const openCalls = enquiries.filter(
    (e) =>
      !e.archived &&
      !agreements.some(
        (a) => a.enquiry_id === e.id && a.secured && !a.cancelled_on,
      ),
  );
  const activePayments = payments.filter((p) => !p.void_reason);
  const received = activePayments
      .filter((p) => p.kind === "receipt")
      .reduce((sum, p) => sum + p.amount, 0),
    refunded = activePayments
      .filter((p) => p.kind === "refund")
      .reduce((sum, p) => sum + p.amount, 0);
  const payable = charges.filter(
    (c) =>
      c.balance > 0 &&
      (c.kind === "initial" || agreement(c.agreement_id).secured),
  );
  const overdue = payable.filter((c) => c.due_date && c.due_date < today);
  const firstHalf = charges.filter(
    (c) => c.kind === "initial" && c.balance > 0 && c.status !== "cancelled",
  );
  const downloadLedger = () => {
    const rows = [
      [
        "Tenant",
        "Spaces",
        "Year",
        "Installment",
        "Due date",
        "Amount USD",
        "Received USD",
        "Outstanding USD",
        "Status",
      ],
      ...charges.map((c) => {
        const a = agreement(c.agreement_id);
        return [
          person(a.person_id).name,
          spaceNames(a.space_ids),
          c.year,
          chargeLabel(c),
          c.due_date || "Awaiting start",
          (c.amount / 100).toFixed(2),
          (c.paid / 100).toFixed(2),
          (c.balance / 100).toFixed(2),
          c.status,
        ];
      }),
    ];
    download(
      `annual-rent-ledger-${today}.csv`,
      "\uFEFF" + rows.map((row) => row.map(csv).join(",")).join("\r\n"),
      "text/csv;charset=utf-8",
    );
  };
  const record = (c: Charge) =>
    open({ kind: "payment", agreement: agreement(c.agreement_id), charge: c });
  const rentTable = (list: Charge[], compact = false) => (
    <div className="table-scroll rent-table">
      <table>
        <thead>
          <tr>
            {!compact && <th>Tenant / spaces</th>}
            <th>Payment</th>
            <th>Due</th>
            <th>Remaining</th>
            <th>Status</th>
            <th>
              <span className="sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((c) => {
            const a = agreement(c.agreement_id);
            return (
              <tr key={c.id}>
                {!compact && (
                  <td className="tenant-cell">
                    <button
                      className="text-button strong"
                      onClick={() => go("Agreements", a.id)}
                    >
                      {person(a.person_id).name}
                    </button>
                    <small>{spaceNames(a.space_ids)}</small>
                  </td>
                )}
                <td data-label="Payment">
                  {chargeLabel(c)}
                  <small>
                    Year {c.year} · {money(c.amount)} total
                  </small>
                </td>
                <td data-label="Due">{dateLabel(c.due_date)}</td>
                <td className="money" data-label="Remaining">
                  {money(c.balance)}
                  {c.paid > 0 && <small>{money(c.paid)} received</small>}
                </td>
                <td data-label="Status">
                  <Badge status={c.status} />
                </td>
                <td className="payment-action">
                  {c.balance > 0 && (
                    <Button variant="secondary small" onClick={() => record(c)}>
                      Record
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!list.length && (
        <div className="table-empty">No payments in this view.</div>
      )}
    </div>
  );
  const headers: Record<Page, { title: string; description: string }> = {
    Overview: {
      title: "Your building, at a glance.",
      description:
        "Keep the next conversation, agreement, and payment in view.",
    },
    "Calls & interest": {
      title: "Every conversation, remembered.",
      description:
        "Capture interest. Follow up. Turn a conversation into an agreement.",
    },
    Spaces: {
      title: "A clear view of every space.",
      description: "Your numbered shops, offices, and rooftop areas.",
    },
    Agreements: {
      title: "Every agreement, in one place.",
      description:
        "Combined spaces, annual rent terms, payments, and paperwork.",
    },
    Payments: {
      title: "Know what’s due. Know what’s paid.",
      description: "Track annual rent, installments, and refunds.",
    },
    Settings: {
      title: "Building settings",
      description: "Building dates, records, and your owner account.",
    },
  };
  const overview = (
    <>
      <div
        className={`completion-strip ${settings.completed_date ? "completed" : ""}`}
      >
        <div className="strip-icon">
          {settings.completed_date ? (
            <CheckCircle2 size={23} />
          ) : (
            <HardHat size={23} />
          )}
        </div>
        <div>
          <strong>
            {settings.completed_date
              ? "The building is open"
              : "Preparing for opening"}
          </strong>
          <p>
            {settings.completed_date
              ? `Completed ${dateLabel(settings.completed_date)} · initial leases share this anniversary.`
              : `Estimated completion ${dateLabel(settings.completion_date)} · leases start when you confirm completion.`}
          </p>
        </div>
        {!settings.completed_date && (
          <Button
            variant="secondary"
            onClick={() => open({ kind: "complete" })}
          >
            Confirm completion
            <ArrowRight size={15} />
          </Button>
        )}
      </div>
      <div className="metrics">
        <div>
          <span>
            Open enquiries
            <Phone size={16} />
          </span>
          <strong>{openCalls.length}</strong>
          <small>People interested in your spaces</small>
        </div>
        <div>
          <span>
            Spaces secured
            <Building2 size={16} />
          </span>
          <strong>
            {allocated}
            <em> / {spaces.length}</em>
          </strong>
          <small>
            {spaces.length - allocated} available ·{" "}
            {agreements.filter((a) => a.status === "active").length} active
            agreements
          </small>
        </div>
        <div>
          <span>
            Net rent received
            <Wallet size={16} />
          </span>
          <strong>{money(received - refunded)}</strong>
          <small>All time · {money(refunded)} refunded</small>
        </div>
        <div>
          <span>
            Overdue balance
            <CalendarDays size={16} />
          </span>
          <strong className={overdue.length ? "warning-text" : ""}>
            {money(overdue.reduce((s, c) => s + c.balance, 0))}
          </strong>
          <small>
            {overdue.length} overdue payment{overdue.length === 1 ? "" : "s"}
          </small>
        </div>
      </div>
      {!spaces.length && (
        <div className="getting-started panel">
          <div>
            <span className="eyebrow">START WITH YOUR BUILDING</span>
            <h2>Ready for your first rental.</h2>
            <p>
              Add your numbered spaces, log interested callers, then agree the
              terms.
            </p>
          </div>
          <Button onClick={() => open({ kind: "space" })}>
            <Plus size={16} />
            Add your first space
          </Button>
        </div>
      )}
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Conversations to follow up</h2>
              <p>Interest stays open until a space is secured.</p>
            </div>
            <button
              className="text-button"
              onClick={() => go("Calls & interest")}
            >
              View all
              <ArrowUpRight size={14} />
            </button>
          </div>
          {openCalls.length ? (
            <div className="call-list">
              {[...openCalls]
                .sort((a, b) =>
                  (a.follow_up || "9999").localeCompare(b.follow_up || "9999"),
                )
                .slice(0, 5)
                .map((e) => (
                  <div key={e.id} className="call-row">
                    <span className="avatar">
                      {person(e.person_id).name.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <strong>{person(e.person_id).name}</strong>
                      <small>
                        {spaceNames(e.space_ids) || "Spaces not chosen"} ·{" "}
                        {person(e.person_id).company ||
                          person(e.person_id).phone}
                      </small>
                    </div>
                    <div className="call-followup">
                      <small>
                        {e.follow_up
                          ? dateLabel(e.follow_up)
                          : "No follow-up date"}
                      </small>
                      <button
                        className="text-button"
                        onClick={() => open({ kind: "call", record: e })}
                      >
                        View call
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <Empty
              title="No open conversations"
              description="Log a call as soon as someone asks about renting."
              action="Log a call"
              onClick={() => open({ kind: "call" })}
            />
          )}
        </section>
        <section className="panel next-actions">
          <div className="panel-heading">
            <div>
              <h2>Your next steps</h2>
              <p>Move each agreement forward.</p>
            </div>
          </div>
          <button
            onClick={() => {
              go("Agreements");
              setFilter("awaiting-payment");
            }}
          >
            <span className="step-number">01</span>
            <span>
              <strong>{firstHalf.length} awaiting first payment</strong>
              <small>Full first half secures the spaces</small>
            </span>
            <ArrowRight size={17} />
          </button>
          <button
            onClick={() => {
              go("Agreements");
              setFilter("secured");
            }}
          >
            <span className="step-number">02</span>
            <span>
              <strong>
                {agreements.filter((a) => a.status === "secured").length}{" "}
                secured agreement
                {agreements.filter((a) => a.status === "secured").length === 1
                  ? ""
                  : "s"}
              </strong>
              <small>Ready for their lease start</small>
            </span>
            <ArrowRight size={17} />
          </button>
          <button onClick={() => go("Payments")}>
            <span className="step-number">03</span>
            <span>
              <strong>
                {agreements.filter((a) => a.refund_due > 0).length} refunds to
                settle
              </strong>
              <small>Based on your cancellation decisions</small>
            </span>
            <ArrowRight size={17} />
          </button>
          <div className="next-note">
            <FileText size={18} />
            <p>
              Keep the signed contract and payment records together in each
              agreement.
            </p>
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Payments needing attention</h2>
            <p>Overdue amounts and rent due in the next 30 days.</p>
          </div>
          <button className="text-button" onClick={() => go("Payments")}>
            All payments
            <ArrowUpRight size={14} />
          </button>
        </div>
        {rentTable(
          payable
            .filter(
              (c) =>
                c.due_date &&
                c.due_date <=
                  new Date(Date.parse(today) + 30 * 86400000)
                    .toISOString()
                    .slice(0, 10),
            )
            .slice(0, 6),
        )}
      </section>
    </>
  );
  const callsView = (
    <>
      <div className="toolbar">
        <div className="search-box">
          <Search size={17} />
          <input
            aria-label="Search calls"
            placeholder="Search name, phone, business, or notes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="tabs">
          <button
            className={!contacts ? "active" : ""}
            onClick={() => setContacts(false)}
          >
            Calls & interest
          </button>
          <button
            className={contacts ? "active" : ""}
            onClick={() => setContacts(true)}
          >
            Contacts
          </button>
        </div>
        {!contacts && (
          <select
            aria-label="Enquiry filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option>All</option>
            <option>Open</option>
            <option>Archived</option>
          </select>
        )}
      </div>
      {contacts ? (
        <section className="panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Business</th>
                  <th>Email</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {people
                  .filter((p) => matches(p.name, p.phone, p.company, p.email))
                  .map((p) => (
                    <tr key={p.id}>
                      <td className="strong">{p.name}</td>
                      <td>
                        <a href={"tel:" + p.phone}>{p.phone}</a>
                      </td>
                      <td>{p.company || "—"}</td>
                      <td>{p.email || "—"}</td>
                      <td>
                        <Button
                          variant="secondary small"
                          onClick={() => open({ kind: "person", record: p })}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!people.length && (
            <Empty
              title="Your contacts will appear here"
              description="Log your first call to save the caller's details."
            />
          )}
        </section>
      ) : (
        <div className="enquiry-grid">
          {enquiries
            .filter(
              (e) =>
                (filter === "All" ||
                  (filter === "Archived" ? e.archived : !e.archived)) &&
                matches(
                  person(e.person_id).name,
                  person(e.person_id).phone,
                  person(e.person_id).company,
                  e.notes,
                  spaceNames(e.space_ids),
                ),
            )
            .map((e) => {
              const p = person(e.person_id),
                linked = agreements.filter((a) => a.enquiry_id === e.id);
              return (
                <article className="panel enquiry-card" key={e.id}>
                  <div className="card-top">
                    <span className="avatar">
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <h3>{p.name}</h3>
                      <p>{p.company || "Business not specified"}</p>
                    </div>
                    <Badge status={e.archived ? "ended" : "interested"}>
                      {e.archived ? "Archived" : "Interested"}
                    </Badge>
                  </div>
                  <a className="phone-link" href={"tel:" + p.phone}>
                    <Phone size={14} />
                    {p.phone}
                  </a>
                  <div className="space-tags">
                    {e.space_ids.length ? (
                      e.space_ids.map((id) => (
                        <span key={id}>
                          {spaceNames([id])}
                          {allocation(id) && <small> · taken</small>}
                        </span>
                      ))
                    ) : (
                      <span>Spaces not chosen yet</span>
                    )}
                  </div>
                  <p className="notes">{e.notes || "No call notes yet."}</p>
                  <div className="card-dates">
                    <span>Called {dateLabel(e.called_on)}</span>
                    <span>
                      {e.follow_up
                        ? "Follow up " + dateLabel(e.follow_up)
                        : "No follow-up date"}
                    </span>
                  </div>
                  {linked.map((a) => (
                    <button
                      key={a.id}
                      className="linked-agreement"
                      onClick={() => go("Agreements", a.id)}
                    >
                      View agreement
                      <Badge status={a.status} />
                      <ArrowRight size={15} />
                    </button>
                  ))}
                  <div className="card-footer">
                    <Button
                      variant="secondary small"
                      onClick={() => open({ kind: "call", record: e })}
                    >
                      Edit call
                    </Button>
                    <Button
                      variant="small"
                      onClick={() => open({ kind: "agreement", enquiry: e })}
                    >
                      Prepare agreement
                      <ArrowRight size={14} />
                    </Button>
                  </div>
                </article>
              );
            })}
          {!enquiries.length && (
            <Empty
              title="Start with a conversation"
              description="Capture a caller's name, phone, and the spaces they like. No space is held at this stage."
              action="Log a call"
              onClick={() => open({ kind: "call" })}
            />
          )}
        </div>
      )}
    </>
  );
  const spacesView = (
    <>
      <div className="toolbar">
        <div className="search-box">
          <Search size={17} />
          <input
            aria-label="Search spaces"
            placeholder="Search space number or floor"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Space filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {["All", "Available", "Taken", "Shop", "Office", "Rooftop"].map(
            (s) => (
              <option key={s}>{s}</option>
            ),
          )}
        </select>
        <span className="muted">
          {spaces.length} spaces ·{" "}
          {spaces.reduce((sum, s) => sum + s.area, 0).toLocaleString()} m²
        </span>
      </div>
      <div className="space-grid">
        {spaces
          .filter(
            (s) =>
              matches(s.name, s.floor, s.type) &&
              (filter === "All" ||
                filter === s.type ||
                (filter === "Taken"
                  ? allocation(s.id)
                  : filter === "Available"
                    ? !allocation(s.id)
                    : false)),
          )
          .map((s) => {
            const a = allocation(s.id),
              interest = enquiries.filter(
                (e) => !e.archived && e.space_ids.includes(s.id),
              );
            return (
              <article className="panel space-card" key={s.id}>
                <div className="space-card-heading">
                  <div className="space-icon">
                    <Building2 size={23} />
                  </div>
                  <Badge status={a?.status || "available"} />
                </div>
                <h2>{s.name}</h2>
                <p>
                  {s.type} · {s.floor}
                </p>
                <strong className="area">
                  {s.area.toLocaleString()} <small>m²</small>
                </strong>
                {a ? (
                  <button
                    className="space-tenant"
                    onClick={() => go("Agreements", a.id)}
                  >
                    <Users size={16} />
                    <span>
                      {person(a.person_id).name}
                      <small>
                        {a.space_ids.length > 1
                          ? `Part of ${a.space_ids.length}-space agreement`
                          : dateLabel(a.effective_start)}
                      </small>
                    </span>
                    <ArrowRight size={15} />
                  </button>
                ) : (
                  <button
                    className="space-tenant"
                    onClick={() => {
                      go("Calls & interest");
                      setSearch(s.name);
                    }}
                  >
                    <Phone size={16} />
                    <span>
                      {interest.length} interested caller
                      {interest.length === 1 ? "" : "s"}
                      <small>Available until the first half is paid</small>
                    </span>
                    <ArrowRight size={15} />
                  </button>
                )}
                {s.notes && <p className="notes">{s.notes}</p>}
                <div className="card-footer">
                  <Button
                    variant="secondary small"
                    onClick={() => open({ kind: "space", record: s })}
                  >
                    <Pencil size={13} />
                    Edit
                  </Button>
                  <Button
                    variant="secondary small"
                    onClick={() => open({ kind: "call", spaceId: s.id })}
                  >
                    Log interest
                  </Button>
                  {!interest.length &&
                    !agreements.some((a) => a.space_ids.includes(s.id)) && (
                      <button
                        className="icon-button"
                        aria-label={`Delete ${s.name}`}
                        onClick={() =>
                          open({
                            kind: "delete",
                            table: "spaces",
                            id: s.id,
                            name: s.name,
                          })
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                </div>
              </article>
            );
          })}
        {!spaces.length && (
          <Empty
            title="Add your numbered spaces"
            description="Each shop, office, and rooftop area stays separate, even when rented together."
            action="Add space"
            onClick={() => open({ kind: "space" })}
          />
        )}
      </div>
    </>
  );
  const agreementsView = (
    <>
      <div className="toolbar">
        <div className="search-box">
          <Search size={17} />
          <input
            aria-label="Search agreements"
            placeholder="Search tenant, spaces, or notes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Agreement filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="All">All agreements</option>
          <option value="awaiting-payment">Awaiting first payment</option>
          <option value="secured">Secured</option>
          <option value="active">Active</option>
          <option value="ended">Ended</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      <section className="panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tenant / spaces</th>
                <th>Annual rent</th>
                <th>Lease start</th>
                <th>Received</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {agreements
                .filter(
                  (a) =>
                    (filter === "All" || a.status === filter) &&
                    matches(
                      person(a.person_id).name,
                      spaceNames(a.space_ids),
                      a.notes,
                    ),
                )
                .map((a) => (
                  <tr key={a.id}>
                    <td>
                      <button
                        className="text-button strong"
                        onClick={() => go("Agreements", a.id)}
                      >
                        {person(a.person_id).name}
                      </button>
                      <small>{spaceNames(a.space_ids)}</small>
                    </td>
                    <td className="money">
                      {money(a.annual_rent)}
                      <small>
                        Year 1 · {a.years} year{a.years === 1 ? "" : "s"}
                        {a.rules.length ? " · varies by year" : ""}
                      </small>
                    </td>
                    <td>{dateLabel(a.effective_start)}</td>
                    <td className="money">
                      {money(a.received - a.refunded)}
                      {a.refund_due > 0 && (
                        <small className="warning-text">
                          {money(a.refund_due)} refund owed
                        </small>
                      )}
                    </td>
                    <td>
                      <Badge status={a.status} />
                    </td>
                    <td>
                      <Button
                        variant="secondary small"
                        onClick={() => go("Agreements", a.id)}
                      >
                        View agreement
                      </Button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!agreements.length && (
          <Empty
            title="From interest to agreement"
            description="Choose a caller and their spaces, then set one combined annual rent."
            action={
              people.length && spaces.length ? "New agreement" : undefined
            }
            onClick={() => open({ kind: "agreement" })}
          />
        )}
      </section>
    </>
  );
  const detail = (a: Agreement) => {
    const p = person(a.person_id),
      list = charges.filter((c) => c.agreement_id === a.id),
      files = documents.filter((d) => d.agreement_id === a.id),
      history = payments.filter((p) => p.agreement_id === a.id);
    return (
      <>
        <button
          className="text-button back-link"
          onClick={() => go("Agreements")}
        >
          <ChevronLeft size={16} />
          All agreements
        </button>
        <div className="agreement-heading">
          <div>
            <span className="eyebrow">
              AGREEMENT · {spaceNames(a.space_ids)}
            </span>
            <h1>{p.name}</h1>
            <p>
              {p.company || "Tenant"} · <a href={"tel:" + p.phone}>{p.phone}</a>
            </p>
          </div>
          <Badge status={a.status} />
        </div>
        <div className="detail-summary">
          <div>
            <small>Combined first-year rent</small>
            <strong>{money(a.annual_rent)}</strong>
          </div>
          <div>
            <small>Contract length</small>
            <strong>
              {a.years} year{a.years === 1 ? "" : "s"}
            </strong>
          </div>
          <div>
            <small>Lease starts</small>
            <strong>{dateLabel(a.effective_start)}</strong>
          </div>
          <div>
            <small>Lease ends</small>
            <strong>
              {a.end_date ? dateLabel(a.end_date) : "Set at completion"}
            </strong>
          </div>
        </div>
        {a.status === "awaiting-payment" && (
          <div className="notice">
            <strong>
              {money(list.find((c) => c.kind === "initial")?.balance || 0)}{" "}
              still needed to secure these spaces.
            </strong>{" "}
            Other interested people can still take them by paying first.
          </div>
        )}
        {a.status === "secured" && (
          <div className="notice success">
            Spaces secured.{" "}
            {a.effective_start
              ? `The lease starts ${dateLabel(a.effective_start)}.`
              : "The lease begins when you confirm building completion."}
          </div>
        )}
        {a.cancelled_on && (
          <div className="notice">
            <strong>Cancelled {dateLabel(a.cancelled_on)}.</strong>{" "}
            {a.cancel_reason}
            <br />
            Agreed amount kept: {money(a.retained)} · Refunded:{" "}
            {money(a.refunded)} · Refund owed: {money(a.refund_due)}
            {a.refund_due > 0 && (
              <Button
                variant="secondary"
                onClick={() =>
                  open({ kind: "payment", agreement: a, refund: true })
                }
              >
                Record refund
              </Button>
            )}
          </div>
        )}
        <div className="detail-actions">
          {!a.cancelled_on && list.some((c) => c.balance > 0) && (
            <Button onClick={() => open({ kind: "payment", agreement: a })}>
              <Plus size={16} />
              Record payment
            </Button>
          )}
          {!a.cancelled_on && !history.length && (
            <Button
              variant="secondary"
              onClick={() => open({ kind: "agreement", record: a })}
            >
              <Pencil size={15} />
              Edit terms
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => open({ kind: "person", record: p })}
          >
            Edit contact
          </Button>
          {!a.cancelled_on && (
            <Button
              variant="ghost danger"
              onClick={() => open({ kind: "cancel", agreement: a })}
            >
              Cancel agreement
            </Button>
          )}
        </div>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Rent schedule</h2>
              <p>
                First year in two installments. Later years are due on the lease
                anniversary.
              </p>
            </div>
          </div>
          {rentTable(list, true)}
        </section>
        <div className="overview-grid">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Payment history</h2>
                <p>Receipts and refunds are kept with the agreement.</p>
              </div>
            </div>
            {history.length ? (
              <div className="payment-history">
                {history.map((p) => (
                  <div key={p.id} className={p.void_reason ? "voided" : ""}>
                    <div>
                      <strong>
                        {p.kind === "refund" ? "Refund" : "Received"}{" "}
                        {money(p.amount)}
                      </strong>
                      <small>
                        {dateLabel(p.paid_date)} · {p.method} ·{" "}
                        {p.reference || "No reference"}
                      </small>
                      {p.void_reason && <small>Voided: {p.void_reason}</small>}
                    </div>
                    {!p.void_reason &&
                      !(p.kind === "receipt" && a.cancelled_on) &&
                      !(
                        p.kind === "receipt" &&
                        list.find((c) => c.id === p.charge_id)?.kind ===
                          "initial" &&
                        a.secured &&
                        a.effective_start &&
                        a.effective_start <= today
                      ) && (
                        <button
                          className="text-button"
                          onClick={() => open({ kind: "void", payment: p })}
                        >
                          Correct entry
                        </button>
                      )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="No payments recorded"
                description="Record the first payment when the money arrives."
              />
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Documents</h2>
                <p>PDF, JPEG, or PNG · up to 10 MB each</p>
              </div>
              <Button
                variant="secondary small"
                disabled={busy}
                onClick={() => uploadRef.current?.click()}
              >
                <Upload size={14} />
                Upload copy
              </Button>
              <input
                ref={uploadRef}
                type="file"
                className="sr-only"
                aria-label="Upload agreement document"
                accept="application/pdf,image/jpeg,image/png"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setError("");
                  if (file.size > 10 * 1024 * 1024) {
                    setError("Upload a file up to 10 MB.");
                    return;
                  }
                  setBusy(true);
                  try {
                    const response = await fetch(
                      "/api/agreements/" + a.id + "/documents",
                      {
                        method: "POST",
                        headers: {
                          "Content-Type": file.type,
                          "X-File-Name": encodeURIComponent(file.name),
                        },
                        body: file,
                        credentials: "same-origin",
                      },
                    );
                    if (!response.ok) {
                      if (response.status === 401)
                        window.dispatchEvent(new Event("session-expired"));
                      throw new Error((await response.json()).error);
                    }
                    await refresh();
                    setToast("Document uploaded");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </div>
            {files.length ? (
              <div className="document-list">
                {files.map((f) => (
                  <div key={f.id}>
                    <FileText size={21} />
                    <a href={"/api/documents/" + f.id} download>
                      <strong>{f.name}</strong>
                      <small>
                        {Math.ceil(f.size / 1024)} KB ·{" "}
                        {f.created_at.slice(0, 10)}
                      </small>
                    </a>
                    <button
                      className="icon-button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() =>
                        open({
                          kind: "delete",
                          table: "documents",
                          id: f.id,
                          name: f.name,
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                title="Your paperwork belongs here"
                description="Upload copies of signed contracts and payment receipts."
              />
            )}
          </section>
        </div>
        {a.notes && (
          <section className="panel note-panel">
            <h2>Agreement notes</h2>
            <p className="notes">{a.notes}</p>
          </section>
        )}
        <section className="panel">
          <div className="panel-heading">
            <h2>Agreement activity</h2>
          </div>
          <div className="activity-list">
            {state.activity
              .filter((e) => e.agreement_id === a.id)
              .map((e) => (
                <div key={e.id}>
                  <span />
                  <p>
                    {e.message}
                    <small>
                      {new Date(e.created_at).toLocaleString("en-GB", {
                        timeZone: settings.time_zone,
                      })}
                    </small>
                  </p>
                </div>
              ))}
          </div>
        </section>
      </>
    );
  };
  const paymentsView = (
    <>
      <div className="toolbar">
        <div className="search-box">
          <Search size={17} />
          <input
            aria-label="Search payments"
            placeholder="Search tenant or space"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="tabs">
          {["Due", "All scheduled", "History", "Refunds"].map((t) => (
            <button
              key={t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <section className="panel">
        {tab === "Due" || tab === "All scheduled" ? (
          rentTable(
            (tab === "Due"
              ? payable.filter((c) => c.due_date && c.due_date <= today)
              : charges
            ).filter((c) => {
              const a = agreement(c.agreement_id);
              return matches(person(a.person_id).name, spaceNames(a.space_ids));
            }),
          )
        ) : tab === "Refunds" ? (
          <div className="payment-history">
            {agreements
              .filter(
                (a) =>
                  a.refund_due > 0 &&
                  matches(person(a.person_id).name, spaceNames(a.space_ids)),
              )
              .map((a) => (
                <div key={a.id}>
                  <div>
                    <button
                      className="text-button strong"
                      onClick={() => go("Agreements", a.id)}
                    >
                      {person(a.person_id).name}
                    </button>
                    <small>
                      {spaceNames(a.space_ids)} · {money(a.refund_due)} still
                      owed
                    </small>
                  </div>
                  <Button
                    variant="secondary small"
                    onClick={() =>
                      open({ kind: "payment", agreement: a, refund: true })
                    }
                  >
                    Record refund
                  </Button>
                </div>
              ))}
            {!agreements.some((a) => a.refund_due > 0) && (
              <Empty
                title="No refunds outstanding"
                description="Any refund you agree on cancellation will appear here."
              />
            )}
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Tenant / spaces</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Method / reference</th>
                </tr>
              </thead>
              <tbody>
                {payments
                  .filter((p) => {
                    const a = agreement(p.agreement_id);
                    return matches(
                      person(a.person_id).name,
                      spaceNames(a.space_ids),
                      p.reference,
                    );
                  })
                  .map((p) => {
                    const a = agreement(p.agreement_id);
                    return (
                      <tr key={p.id} className={p.void_reason ? "voided" : ""}>
                        <td>
                          <button
                            className="text-button strong"
                            onClick={() => go("Agreements", a.id)}
                          >
                            {person(a.person_id).name}
                          </button>
                          <small>{spaceNames(a.space_ids)}</small>
                        </td>
                        <td>
                          {p.void_reason
                            ? "Voided"
                            : p.kind === "receipt"
                              ? "Received"
                              : "Refund"}
                        </td>
                        <td className="money">{money(p.amount)}</td>
                        <td>{dateLabel(p.paid_date)}</td>
                        <td>
                          {p.method}
                          <small>{p.reference || "—"}</small>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {!payments.length && (
              <Empty
                title="No payment history yet"
                description="Record payments from the agreement or its rent schedule."
              />
            )}
          </div>
        )}
      </section>
    </>
  );
  const settingsView = (
    <div className="settings-grid">
      <section className="panel settings-panel">
        <h2>Building information</h2>
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            mutate(
              "settings",
              "PUT",
              Object.fromEntries(new FormData(e.currentTarget)),
            );
          }}
        >
          <Field label="Building name">
            <input
              name="name"
              defaultValue={settings.name}
              required
              maxLength={100}
            />
          </Field>
          <Field label="Address">
            <input
              name="address"
              defaultValue={settings.address}
              maxLength={250}
            />
          </Field>
          <Field
            label="Estimated completion date"
            hint="Planning only. Actual completion is confirmed separately."
          >
            <input
              type="date"
              name="completion_date"
              defaultValue={settings.completion_date}
              required
            />
          </Field>
          <Field label="Time zone">
            <input
              name="time_zone"
              defaultValue={settings.time_zone}
              required
            />
          </Field>
          <Button type="submit" disabled={busy}>
            Save building details
          </Button>
        </form>
        <div className="settings-completion">
          <strong>
            {settings.completed_date
              ? "Completed " + dateLabel(settings.completed_date)
              : "Building completion is not yet confirmed"}
          </strong>
          {!settings.completed_date && (
            <Button
              variant="secondary"
              onClick={() => open({ kind: "complete" })}
            >
              Confirm completion
            </Button>
          )}
        </div>
      </section>
      <div className="settings-stack">
        <AccountSecurity email={ownerEmail} />
        <section className="panel settings-panel">
          <h2>Your records</h2>
          <p>
            Download a copy of your records or the rent ledger. Uploaded files
            can be downloaded from each agreement.
          </p>
          <Button
            variant="secondary"
            onClick={() =>
              download(
                `building-records-${today}.json`,
                JSON.stringify(state, null, 2),
              )
            }
          >
            <ArrowDownToLine size={16} />
            Export records
          </Button>
          <Button variant="secondary" onClick={downloadLedger}>
            <ArrowDownToLine size={16} />
            Export rent ledger
          </Button>
          <small>
            Exports contain private tenant information. Documents are included
            in server database backups, not in this JSON export.
          </small>
        </section>
      </div>
    </div>
  );
  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a
          className="wordmark"
          href="/overview"
          onClick={(e) => {
            e.preventDefault();
            go("Overview");
          }}
        >
          <span>
            <Building2 size={24} />
          </span>
          our building<span className="brand-dot">.</span>
        </a>
        <div className="property-label">
          <Building2 size={20} />
          <span>
            <strong>{settings.name}</strong>
            <small>Owner workspace</small>
          </span>
        </div>
        <span className="nav-label">MANAGE YOUR BUILDING</span>
        <nav aria-label="Main navigation">
          {nav.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={page === name ? "active" : ""}
              onClick={() => go(name)}
            >
              <Icon size={19} />
              <span>{name}</span>
              {name === "Calls & interest" && openCalls.length > 0 && (
                <em aria-hidden="true">{openCalls.length}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="owner-card">
            <span className="avatar">OB</span>
            <span>
              <strong>Building owner</strong>
              <small>Private workspace · USD</small>
            </span>
          </div>
          <button
            className={page === "Settings" ? "active" : ""}
            onClick={() => go("Settings")}
          >
            <Settings2 size={18} />
            Building settings
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSignOut();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={22} />
            </button>
            <span>{settings.name}</span>
            <span className="crumb">/</span>
            <strong>{page}</strong>
          </div>
          <div>
            <CalendarDays size={15} />
            <span>{dateLabel(today)}</span>
            <span className="top-owner">OB</span>
          </div>
        </header>
        <div className="workspace">
          {!(page === "Agreements" && selected) && (
            <div className="page-heading">
              <div>
                <span className="eyebrow">
                  {page === "Overview"
                    ? "YOUR OWNER WORKSPACE"
                    : page.toUpperCase()}
                </span>
                <h1>{headers[page].title}</h1>
                <p>{headers[page].description}</p>
              </div>
              {page === "Overview" || page === "Calls & interest" ? (
                <Button onClick={() => open({ kind: "call" })}>
                  <Plus size={17} />
                  Log a call
                </Button>
              ) : page === "Spaces" ? (
                <Button onClick={() => open({ kind: "space" })}>
                  <Plus size={17} />
                  Add space
                </Button>
              ) : page === "Agreements" ? (
                <Button
                  disabled={!people.length || !spaces.length}
                  onClick={() => open({ kind: "agreement" })}
                >
                  <Plus size={17} />
                  New agreement
                </Button>
              ) : page === "Payments" ? (
                <Button variant="secondary" onClick={downloadLedger}>
                  <ArrowDownToLine size={16} />
                  Export ledger
                </Button>
              ) : null}
            </div>
          )}
          {error && !form && (
            <div role="alert" className="form-error global-error">
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {state.legacy_count > 0 && (
            <div className="notice">
              {state.legacy_count} earlier monthly lease record(s) are preserved
              separately and need review.{" "}
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    download(
                      "earlier-records.json",
                      JSON.stringify(await request("legacy"), null, 2),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Download earlier records
              </button>
            </div>
          )}
          {page === "Overview" ? (
            overview
          ) : page === "Calls & interest" ? (
            callsView
          ) : page === "Spaces" ? (
            spacesView
          ) : page === "Agreements" ? (
            selected ? (
              detail(selected)
            ) : selectedId ? (
              <Empty
                title="Agreement not found"
                description="Return to your agreements to select an existing record."
                action="View agreements"
                onClick={() => go("Agreements")}
              />
            ) : (
              agreementsView
            )
          ) : page === "Payments" ? (
            paymentsView
          ) : (
            settingsView
          )}
          <footer className="workspace-footer">
            <span>Your building. Every detail in place.</span>
            <span>English · USD</span>
          </footer>
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {form && (
        <Modal
          title={formTitles[form.kind]}
          close={() => {
            setForm(null);
            setError("");
          }}
          busy={busy}
        >
          <RecordForm
            spec={form}
            state={state}
            submit={mutate}
            busy={busy}
            error={error}
            close={() => {
              setForm(null);
              setError("");
            }}
          />
        </Modal>
      )}
    </div>
  );
}
