import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { X, Plus, FolderOpen } from "lucide-react";
export const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n % 100 ? 2 : 0,
  }).format(n / 100);
export const dateLabel = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value + "T12:00:00Z"))
    : "Awaiting completion";
export const amountInput = (n?: number) =>
  n === undefined ? "" : (n / 100).toFixed(2);
export const labels: Record<string, string> = {
  "awaiting-payment": "Awaiting first payment",
  secured: "Secured",
  active: "Active",
  ended: "Ended",
  cancelled: "Cancelled",
  "awaiting-start": "Awaiting start",
  paid: "Paid",
  overdue: "Overdue",
  partial: "Part paid",
  upcoming: "Upcoming",
  available: "Available",
  interested: "Interested",
};
export function Badge({
  status,
  children,
}: {
  status: string;
  children?: ReactNode;
}) {
  return (
    <span className={`badge ${status}`}>
      {children || labels[status] || status}
    </span>
  );
}
export function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      className={`button ${variant}`}
      type={type}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  wide?: boolean;
}) {
  const id = useId();
  return (
    <div className={`field ${wide ? "wide" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {cloneElement(
        children as ReactElement<{ id: string; "aria-describedby"?: string }>,
        { id, "aria-describedby": hint ? id + "-hint" : undefined },
      )}
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
  onClick,
}: {
  title: string;
  description: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="empty-state">
      <FolderOpen size={28} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action && (
        <Button onClick={onClick}>
          <Plus size={16} />
          {action}
        </Button>
      )}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  close,
  busy = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    document.body.style.overflow = "hidden";
    const timer = setTimeout(
      () =>
        ref.current?.querySelector<HTMLElement>("input,select,button")?.focus(),
      0,
    );
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) close();
          if (e.key === "Tab") {
            const items = [
              ...(ref.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
              ) || []),
            ];
            if (e.shiftKey && document.activeElement === items[0]) {
              e.preventDefault();
              items.at(-1)?.focus();
            } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
              e.preventDefault();
              items[0]?.focus();
            }
          }
        }}
      >
        <div className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            disabled={busy}
            onClick={close}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function download(
  name: string,
  body: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
