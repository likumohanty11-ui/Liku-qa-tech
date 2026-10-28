export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export type PlanName = "basic" | "pro";
export type InvoiceStatus = "pending" | "succeeded" | "failed" | "refunded";
export type PaymentEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded";

export interface Customer {
  id: string;
  email: string;
}

export interface Plan {
  name: PlanName;
  amount: number;
  currency: string;
  trialDays: number;
  maxFailedAttempts: number;
}

export interface Subscription {
  id: string;
  customerId: string;
  plan: PlanName;
  paymentMethodId: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  failedAttempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  providerReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookPayload {
  event_id: string;
  type: PaymentEventType;
  subscription_id: string;
  invoice_id: string;
  amount: number;
  currency: string;
}

export interface WebhookEventRecord {
  eventId: string;
  type: PaymentEventType;
  subscriptionId: string;
  invoiceId: string;
  amount: number;
  currency: string;
  outcome: "processed" | "ignored_stale" | "ignored_canceled";
  deliveryCount: number;
  receivedAt: string;
}

export interface AuditEntry {
  id: string;
  subscriptionId: string;
  type: string;
  details: Record<string, string | number | null>;
  occurredAt: string;
}

export interface CreateSubscriptionRequest {
  customer_id: string;
  plan: string;
  payment_method_id: string;
}

export interface SubscriptionResponse {
  subscription: Subscription;
  invoice: Invoice | null;
}

export const PLANS: Record<PlanName, Plan> = {
  basic: {
    name: "basic",
    amount: 1900,
    currency: "USD",
    trialDays: 14,
    maxFailedAttempts: 3,
  },
  pro: {
    name: "pro",
    amount: 4900,
    currency: "USD",
    trialDays: 0,
    maxFailedAttempts: 3,
  },
};

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
