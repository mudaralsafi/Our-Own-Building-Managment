import type { RentChange } from "../shared/rent.mjs";
export type Space = {
  id: string;
  name: string;
  type: "Shop" | "Office" | "Rooftop";
  floor: string;
  area: number;
  notes: string;
};
export type Person = {
  id: string;
  name: string;
  phone: string;
  company: string;
  email: string;
  notes: string;
};
export type Enquiry = {
  id: string;
  person_id: string;
  space_ids: string[];
  called_on: string;
  follow_up: string;
  notes: string;
  archived: number;
};
export type Agreement = {
  id: string;
  person_id: string;
  enquiry_id: string | null;
  space_ids: string[];
  agreed_on: string;
  start_mode: "completion" | "date";
  start_date: string;
  effective_start: string;
  end_date: string;
  years: number;
  annual_rent: number;
  rules: RentChange[];
  rents: { year: number; amount: number }[];
  notes: string;
  cancelled_on: string;
  cancel_reason: string;
  retained: number;
  status: string;
  secured: boolean;
  received: number;
  refunded: number;
  refund_due: number;
};
export type Charge = {
  id: string;
  agreement_id: string;
  year: number;
  kind: "initial" | "completion" | "annual";
  due_date: string | null;
  amount: number;
  paid: number;
  balance: number;
  status: string;
};
export type Payment = {
  id: string;
  agreement_id: string;
  charge_id: string | null;
  kind: "receipt" | "refund";
  amount: number;
  paid_date: string;
  method: string;
  reference: string;
  void_reason: string;
};
export type Document = {
  id: string;
  agreement_id: string;
  name: string;
  size: number;
  created_at: string;
};
export type State = {
  today: string;
  settings: {
    name: string;
    address: string;
    completion_date: string;
    completed_date: string;
    time_zone: string;
  };
  spaces: Space[];
  people: Person[];
  enquiries: Enquiry[];
  agreements: Agreement[];
  charges: Charge[];
  payments: Payment[];
  documents: Document[];
  activity: {
    id: number;
    agreement_id: string;
    message: string;
    created_at: string;
  }[];
  legacy_count: number;
};
export type Page =
  | "Overview"
  | "Calls & interest"
  | "Spaces"
  | "Agreements"
  | "Payments"
  | "Settings";
