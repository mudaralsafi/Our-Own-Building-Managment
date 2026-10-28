export type Space = { id: string; name: string; type: 'Shop' | 'Office' | 'Rooftop'; floor: string; area: number; ready: number; notes: string };
export type Renter = { id: string; name: string; company: string; email: string; phone: string; notes: string };
export type Lease = { id: string; space_id: string; renter_id: string; start_date: string; end_date: string; first_due_date: string; monthly_rent: number; deposit: number; deposit_due_date: string; notes: string; status: 'active' | 'reserved' | 'ended' };
export type Charge = { id: string; lease_id: string; kind: 'rent' | 'deposit'; due_date: string; amount: number; paid: number; balance: number; status: 'paid' | 'overdue' | 'partial' | 'upcoming' };
export type Payment = { id: string; charge_id: string; amount: number; paid_date: string; method: string; reference: string; created_at: string };
export type Settings = { name: string; address: string; completion_date: string; time_zone: string; currency: string };
export type State = { today: string; settings: Settings; spaces: Space[]; renters: Renter[]; leases: Lease[]; charges: Charge[]; payments: Payment[] };
export type Page = 'Overview' | 'Spaces' | 'Renters' | 'Leases' | 'Rent & payments' | 'Settings';
export type Modal =
  | { kind: 'space'; record?: Space }
  | { kind: 'renter'; record?: Renter }
  | { kind: 'lease'; record?: Lease; spaceId?: string }
  | { kind: 'payment'; charge?: Charge; paymentId: string }
  | { kind: 'end'; record: Lease }
  | { kind: 'delete'; table: 'spaces' | 'renters' | 'leases' | 'payments'; id: string; label: string }
  | { kind: 'details'; record: Lease };
