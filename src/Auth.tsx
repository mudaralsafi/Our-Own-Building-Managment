import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Store,
  Sun,
} from "lucide-react";
import { request } from "./api";

type User = { email: string };
type Status = {
  configured: boolean;
  user: User | null;
  setupRequiresToken: boolean;
};

function PasswordInput({
  id,
  name,
  label,
  autoComplete = "new-password",
  minLength = 12,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete?: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          maxLength={128}
        />
        <button
          type="button"
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </div>
  );
}

export function OwnerGate({
  children,
}: {
  children: (user: User, signOut: () => Promise<void>) => ReactNode;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const refresh = () =>
    request("auth/status")
      .then(setStatus)
      .catch((e) => setError(e.message));
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    const handle = () => {
      setStatus((s) => (s ? { ...s, user: null, configured: true } : s));
      setExpired(true);
      window.history.replaceState({}, "", "/login");
    };
    window.addEventListener("session-expired", handle);
    return () => window.removeEventListener("session-expired", handle);
  }, []);
  useEffect(() => {
    if (!status?.user) document.title = "Sign in · Our Building";
  }, [status?.user]);
  const signOut = async () => {
    try {
      await request("auth/logout", "POST", {});
      setStatus((s) => (s ? { ...s, user: null } : s));
      setError("");
      setExpired(false);
      window.history.replaceState({}, "", "/login");
    } catch (e) {
      throw new Error((e as Error).message);
    }
  };
  if (status?.user) return children(status.user, signOut);
  const setup = status && !status.configured;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (setup && data.password !== data.confirm_password) {
      setError("The two passwords do not match.");
      setBusy(false);
      return;
    }
    delete data.confirm_password;
    try {
      const result = await request(
        setup ? "auth/setup" : "auth/login",
        "POST",
        data,
      );
      setStatus({
        configured: true,
        setupRequiresToken: false,
        user: result.user,
      });
      setExpired(false);
      if (["/", "/login"].includes(window.location.pathname))
        window.history.replaceState({}, "", "/overview");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-shell">
      <section className="auth-story">
        <div className="auth-wordmark">
          <span>
            <Building2 size={25} strokeWidth={1.5} />
          </span>
          our building.
        </div>
        <div className="auth-story-content">
          <span className="auth-kicker">A HOME FOR EVERY DETAIL</span>
          <h1>
            Your building.
            <br />
            In good hands.
          </h1>
          <p>
            From the first call to the next annual rent payment, keep your
            spaces and the people in them connected.
          </p>
          <div className="auth-property-art" aria-hidden="true">
            <Building2 size={158} strokeWidth={0.6} />
            <span className="art-line" />
            <span className="art-orbit" />
          </div>
          <div className="auth-space-types">
            <span>
              <Store size={15} />
              Shops
            </span>
            <span>
              <Building2 size={15} />
              Offices
            </span>
            <span>
              <Sun size={15} />
              Rooftop
            </span>
          </div>
        </div>
        <div className="auth-story-footer">
          <ShieldCheck size={16} />
          Your property. Your private workspace.
        </div>
      </section>
      <section className="auth-main">
        <div className="auth-card">
          <div className="auth-lock">
            <LockKeyhole size={24} strokeWidth={1.5} />
          </div>
          <span className="eyebrow">
            {setup ? "YOUR NEXT CHAPTER STARTS HERE" : "WELCOME BACK"}
          </span>
          <h2>
            {setup ? "Make yourself at home." : "Sign in to your building."}
          </h2>
          <p className="auth-description">
            {setup
              ? "Create the owner account to begin managing your spaces, agreements, and rent."
              : "One place for your spaces, agreements, and peace of mind."}
          </p>
          {!status ? (
            <div className="auth-loading">
              {error ? (
                <>
                  <p role="alert" className="form-error">
                    {error}
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setError("");
                      refresh();
                    }}
                  >
                    Try again
                  </button>
                </>
              ) : (
                "Opening your workspace…"
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="auth-form">
              {expired && (
                <div className="session-notice" role="status">
                  Your session ended. Sign in again to continue.
                </div>
              )}
              {setup && status.setupRequiresToken && (
                <div className="field">
                  <label htmlFor="setup-token">Private setup code</label>
                  <input
                    id="setup-token"
                    name="setup_token"
                    type="password"
                    autoComplete="off"
                    required
                    maxLength={256}
                    aria-describedby="setup-code-hint"
                  />
                  <small id="setup-code-hint">
                    Use the setup code from your hosting account. It is only
                    needed to create the first owner account.
                  </small>
                </div>
              )}
              <div className="field">
                <label htmlFor="owner-email">Email address</label>
                <input
                  id="owner-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={254}
                  placeholder="you@example.com"
                />
              </div>
              <PasswordInput
                id="owner-password"
                name="password"
                label="Password"
                autoComplete={setup ? "new-password" : "current-password"}
                minLength={setup ? 12 : 1}
              />
              {setup && (
                <>
                  <p className="password-hint">
                    Use at least 12 characters. A few memorable words work well.
                  </p>
                  <PasswordInput
                    id="confirm-password"
                    name="confirm_password"
                    label="Confirm password"
                  />
                </>
              )}
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="button primary auth-submit"
                type="submit"
                disabled={busy}
              >
                {busy
                  ? "Please wait…"
                  : setup
                    ? "Create owner account"
                    : "Sign in"}
                {!busy && <ArrowRight size={17} />}
              </button>
              <p className="auth-private">
                <ShieldCheck size={14} />
                {setup
                  ? "This account controls access to your building records."
                  : "Only your owner account can access building records."}
              </p>
            </form>
          )}
        </div>
        <div className="auth-footer">
          Our Building <span>·</span> Property management, with a little more
          clarity.
        </div>
      </section>
    </div>
  );
}

export function AccountSecurity({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel account-panel">
      <div className="account-panel-heading">
        <KeyRound size={20} />
        <h2>Account & security</h2>
      </div>
      <p className="account-email">{email}</p>
      {open ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            setMessage("");
            const form = event.currentTarget;
            const data = Object.fromEntries(new FormData(form));
            if (data.new_password !== data.confirm_password) {
              setError("The two new passwords do not match.");
              return;
            }
            delete data.confirm_password;
            setBusy(true);
            try {
              await request("auth/password", "POST", data);
              form.reset();
              setOpen(false);
              setMessage(
                "Password changed. Your other sessions have been signed out.",
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <PasswordInput
            id="current-password"
            name="current_password"
            label="Current password"
            autoComplete="current-password"
            minLength={1}
          />
          <PasswordInput
            id="new-password"
            name="new_password"
            label="New password"
          />
          <PasswordInput
            id="confirm-new-password"
            name="confirm_password"
            label="Confirm new password"
          />
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="account-buttons">
            <button
              className="button secondary"
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Change password"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <button
            className="button secondary"
            onClick={() => {
              setOpen(true);
              setMessage("");
              setError("");
            }}
          >
            Change password <KeyRound size={15} />
          </button>
          {message && (
            <p className="account-success" role="status">
              <CheckCircle2 size={16} />
              {message}
            </p>
          )}
        </>
      )}
    </section>
  );
}
