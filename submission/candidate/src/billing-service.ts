import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AuditEntry,
  CreateSubscriptionRequest,
  Invoice,
  PaymentEventType,
  Plan,
  PlanName,
  Subscription,
  SubscriptionResponse,
  WebhookEventRecord,
  WebhookPayload,
} from "./domain";
import { ApiError, PLANS } from "./domain";
import type { ChargeResult, PaymentProvider } from "./payment-provider";
import { InMemoryBillingRepository } from "./repository";
import { SubscriptionLifecycle } from "./state-machine";

export const WEBHOOK_SECRET = "test-only-signing-secret";

export class BillingService {
  private readonly lifecycle = new SubscriptionLifecycle();
  private subscriptionSequence = 0;
  private invoiceSequence = 0;
  private auditSequence = 0;

  constructor(
    private readonly repository: InMemoryBillingRepository,
    private readonly paymentProvider: PaymentProvider,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async createSubscription(
    request: CreateSubscriptionRequest,
  ): Promise<SubscriptionResponse> {
    if (
      typeof request !== "object" ||
      request === null ||
      typeof request.customer_id !== "string" ||
      typeof request.plan !== "string" ||
      typeof request.payment_method_id !== "string" ||
      !request.customer_id.trim() ||
      !request.plan.trim() ||
      !request.payment_method_id.trim()
    ) {
      throw new ApiError(400, "invalid_request", "Required fields are missing");
    }

    if (!this.repository.getCustomer(request.customer_id)) {
      throw new ApiError(404, "customer_not_found", "Customer does not exist");
    }

    const plan = PLANS[request.plan as PlanName];
    if (!plan) {
      throw new ApiError(400, "invalid_plan", "Plan is not supported");
    }

    const now = this.clock();
    const id = `sub_${String(++this.subscriptionSequence).padStart(4, "0")}`;
    const subscription: Subscription = {
      id,
      customerId: request.customer_id,
      plan: plan.name,
      paymentMethodId: request.payment_method_id,
      status: "trialing",
      trialEndsAt:
        plan.trialDays > 0
          ? new Date(now.getTime() + plan.trialDays * 86_400_000).toISOString()
          : null,
      failedAttempts: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    this.repository.addSubscription(subscription);
    this.addAudit(subscription.id, "subscription.created", {
      plan: plan.name,
      status: subscription.status,
    });

    if (plan.trialDays > 0) {
      return { subscription, invoice: null };
    }

    const charge = await this.paymentProvider.charge({
      customerId: subscription.customerId,
      paymentMethodId: subscription.paymentMethodId,
      amount: plan.amount,
      currency: plan.currency,
      idempotencyKey: `initial:${subscription.id}`,
    });
    const invoice = this.recordCharge(subscription, plan, charge);
    return { subscription: this.getSubscription(id), invoice };
  }

  getSubscription(id: string): Subscription {
    const subscription = this.repository.getSubscription(id);
    if (!subscription) {
      throw new ApiError(404, "subscription_not_found", "Subscription does not exist");
    }
    return subscription;
  }

  cancelSubscription(id: string): Subscription {
    const subscription = this.getSubscription(id);
    if (subscription.status === "canceled") {
      throw new ApiError(409, "already_canceled", "Subscription is already canceled");
    }

    const updated = this.lifecycle.transition(subscription, "canceled");
    updated.updatedAt = this.clock().toISOString();
    this.repository.updateSubscription(updated);
    this.addAudit(id, "subscription.status_changed", {
      from: subscription.status,
      to: updated.status,
      reason: "customer_cancel",
    });
    return updated;
  }

  signWebhook(rawBody: string): string {
    return createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  }

  isValidWebhookSignature(rawBody: string, signature: string): boolean {
    if (!/^[a-f0-9]{64}$/i.test(signature)) {
      return false;
    }
    const expected = Buffer.from(this.signWebhook(rawBody), "hex");
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && timingSafeEqual(expected, received);
  }

  processWebhook(payload: WebhookPayload): { duplicate: boolean; outcome: string } {
    this.validateWebhook(payload);
    const previous = this.repository.getWebhookEvent(payload.event_id);
    if (previous) {
      if (
        previous.type !== payload.type ||
        previous.subscriptionId !== payload.subscription_id ||
        previous.invoiceId !== payload.invoice_id ||
        previous.amount !== payload.amount ||
        previous.currency !== payload.currency
      ) {
        throw new ApiError(
          409,
          "idempotency_conflict",
          "Event ID was already used for a different payment event",
        );
      }
      this.repository.incrementWebhookDelivery(payload.event_id);
      this.addAudit(previous.subscriptionId, "webhook.duplicate_ignored", {
        eventId: payload.event_id,
        deliveryCount: previous.deliveryCount + 1,
      });
      return { duplicate: true, outcome: "duplicate" };
    }

    const subscription = this.repository.getSubscription(payload.subscription_id);
    if (!subscription) {
      throw new ApiError(404, "subscription_not_found", "Subscription does not exist");
    }
    const plan = PLANS[subscription.plan];
    if (payload.amount !== plan.amount || payload.currency !== plan.currency) {
      throw new ApiError(422, "payment_mismatch", "Payment does not match subscription plan");
    }
    const currentInvoice = this.repository.getInvoice(payload.invoice_id);
    if (currentInvoice && currentInvoice.subscriptionId !== subscription.id) {
      throw new ApiError(422, "invoice_mismatch", "Invoice belongs to another subscription");
    }

    let outcome: WebhookEventRecord["outcome"] = "processed";
    if (subscription.status === "canceled") {
      outcome = "ignored_canceled";
    } else {
      outcome = this.applyPaymentEvent(subscription, plan, payload, currentInvoice);
    }

    const event: WebhookEventRecord = {
      eventId: payload.event_id,
      type: payload.type,
      subscriptionId: subscription.id,
      invoiceId: payload.invoice_id,
      amount: payload.amount,
      currency: payload.currency,
      outcome,
      deliveryCount: 1,
      receivedAt: this.clock().toISOString(),
    };
    this.repository.addWebhookEvent(event);
    this.addAudit(subscription.id, "webhook.processed", {
      eventId: payload.event_id,
      type: payload.type,
      outcome,
    });
    return { duplicate: false, outcome };
  }

  private applyPaymentEvent(
    subscription: Subscription,
    plan: Plan,
    payload: WebhookPayload,
    invoice: Invoice | undefined,
  ): WebhookEventRecord["outcome"] {
    if (
      payload.type === "payment.failed" &&
      invoice &&
      (invoice.status === "succeeded" || invoice.status === "refunded")
    ) {
      return "ignored_stale";
    }

    if (payload.type === "payment.refunded") {
      if (!invoice || invoice.status !== "succeeded") {
        return "ignored_stale";
      }
      this.repository.updateInvoice({
        ...invoice,
        status: "refunded",
        updatedAt: this.clock().toISOString(),
      });
      if (subscription.status === "active") {
        this.changeStatus(subscription, "past_due", "payment_refunded");
      }
      return "processed";
    }

    const targetInvoiceStatus =
      payload.type === "payment.succeeded" ? "succeeded" : "failed";
    if (invoice?.status === "refunded") {
      return "ignored_stale";
    }

    const now = this.clock().toISOString();
    const savedInvoice: Invoice = invoice
      ? {
          ...invoice,
          status: targetInvoiceStatus,
          updatedAt: now,
        }
      : {
          id: payload.invoice_id,
          subscriptionId: subscription.id,
          amount: payload.amount,
          currency: payload.currency,
          status: targetInvoiceStatus,
          providerReference: null,
          createdAt: now,
          updatedAt: now,
        };
    if (invoice) {
      this.repository.updateInvoice(savedInvoice);
    } else {
      this.repository.addInvoice(savedInvoice);
    }

    if (payload.type === "payment.succeeded") {
      const current = this.getSubscription(subscription.id);
      if (current.failedAttempts !== 0) {
        this.repository.updateSubscription({
          ...current,
          failedAttempts: 0,
          updatedAt: this.clock().toISOString(),
        });
      }
      if (subscription.status !== "active") {
        this.changeStatus(
          this.getSubscription(subscription.id),
          "active",
          "payment_succeeded",
        );
      }
      return "processed";
    }

    const latest = this.getSubscription(subscription.id);
    const failedAttempts = latest.failedAttempts + 1;
    const updated = { ...latest, failedAttempts, updatedAt: now };
    this.repository.updateSubscription(updated);
    if (failedAttempts >= plan.maxFailedAttempts) {
      this.changeStatus(updated, "canceled", "retries_exhausted");
    } else if (updated.status !== "past_due") {
      this.changeStatus(updated, "past_due", "payment_failed");
    }
    return "processed";
  }

  private recordCharge(
    subscription: Subscription,
    plan: Plan,
    charge: ChargeResult,
  ): Invoice {
    const now = this.clock().toISOString();
    const invoice: Invoice = {
      id: `inv_${String(++this.invoiceSequence).padStart(4, "0")}`,
      subscriptionId: subscription.id,
      amount: plan.amount,
      currency: plan.currency,
      status:
        charge.outcome === "succeeded"
          ? "succeeded"
          : charge.outcome === "declined"
            ? "failed"
            : "pending",
      providerReference: charge.providerReference,
      createdAt: now,
      updatedAt: now,
    };
    this.repository.addInvoice(invoice);

    if (charge.outcome === "succeeded") {
      this.changeStatus(subscription, "active", "initial_payment_succeeded");
    } else {
      const updated = this.getSubscription(subscription.id);
      updated.failedAttempts =
        charge.outcome === "declined" ? updated.failedAttempts + 1 : updated.failedAttempts;
      this.repository.updateSubscription(updated);
      this.changeStatus(
        updated,
        "past_due",
        charge.outcome === "declined" ? "initial_payment_declined" : "initial_payment_timeout",
      );
    }

    this.addAudit(subscription.id, "invoice.created", {
      invoiceId: invoice.id,
      status: invoice.status,
      amount: invoice.amount,
    });
    return invoice;
  }

  private changeStatus(
    subscription: Subscription,
    status: Subscription["status"],
    reason: string,
  ): void {
    const updated = this.lifecycle.transition(subscription, status);
    updated.updatedAt = this.clock().toISOString();
    this.repository.updateSubscription(updated);
    this.addAudit(subscription.id, "subscription.status_changed", {
      from: subscription.status,
      to: status,
      reason,
    });
  }

  private addAudit(
    subscriptionId: string,
    type: string,
    details: AuditEntry["details"],
  ): void {
    this.repository.addAuditEntry({
      id: `audit_${String(++this.auditSequence).padStart(4, "0")}`,
      subscriptionId,
      type,
      details,
      occurredAt: this.clock().toISOString(),
    });
  }

  private validateWebhook(payload: WebhookPayload): void {
    const supportedTypes: readonly PaymentEventType[] = [
      "payment.succeeded",
      "payment.failed",
      "payment.refunded",
    ];
    if (
      !payload ||
      typeof payload.event_id !== "string" ||
      !payload.event_id.trim() ||
      !supportedTypes.includes(payload.type) ||
      typeof payload.subscription_id !== "string" ||
      !payload.subscription_id.trim() ||
      typeof payload.invoice_id !== "string" ||
      !payload.invoice_id.trim() ||
      !Number.isInteger(payload.amount) ||
      payload.amount <= 0 ||
      typeof payload.currency !== "string" ||
      !/^[A-Z]{3}$/.test(payload.currency)
    ) {
      throw new ApiError(400, "invalid_webhook", "Webhook payload is invalid");
    }
  }
}
