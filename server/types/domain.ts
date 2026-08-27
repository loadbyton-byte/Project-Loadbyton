// Strict domain types — the financial core. Money is never a float.
export type Currency = 'AED';

export type Money = {
  amountMinor: number; // fils, integer. 10_000 AED = 1_000_000 fils. Use bigint when > Number.MAX_SAFE_INTEGER.
  currency: Currency;
};

export function toMinor(aed: number): number {
  return Math.round(aed * 100);
}
export function fromMinor(minor: number): number {
  return minor / 100;
}

export type JobStatus = 'OPEN' | 'AWARDED' | 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';
export type EscrowStatus = 'PENDING' | 'HELD' | 'FUNDED' | 'RELEASED' | 'DISPUTED' | 'REFUNDED';
export type PaymentStatus = 'PENDING' | 'REQUIRES_PAYMENT' | 'PAID' | 'FAILED' | 'REFUNDED';
export type BidStatus = 'PENDING' | 'AWARDED' | 'REJECTED' | 'WITHDRAWN';
export type PayoutStatus = 'PENDING' | 'PROCESSING' | 'RELEASED' | 'SETTLED' | 'FAILED' | 'CANCELLED';
export type DisputeStatus = 'OPEN' | 'RESOLVED';
export type UserRole = 'SHIPPER' | 'CARRIER' | 'ADMIN';
export type SeatRole = 'OPS' | 'VIEWER';

export type LedgerAccountCode = 'processor_clearing' | 'escrow_liability' | 'carrier_payable' | 'platform_revenue' | 'refund_liability';
export type LedgerSide = 'DEBIT' | 'CREDIT';

export type Job = {
  id: number;
  job_code: string;
  shipper_id: number;
  carrier_id: number | null;
  status: JobStatus;
  escrow_status: EscrowStatus;
  processor_payment_status: PaymentStatus;
  agreed_price_aed: number | null;
  max_budget_aed: number | null;
  // ... other columns omitted for brevity, add as needed
};

export type Payout = {
  id: number;
  job_id: number;
  carrier_id: number;
  gross_aed: number;
  platform_fee_aed: number;
  net_aed: number;
  status: PayoutStatus;
  idempotency_key: string | null;
};
