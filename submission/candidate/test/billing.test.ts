import { describe, expect, it } from "vitest";
import { BillingApiClient, asResponse } from "../src/api-client";
import {
  CustomerBuilder,
  SubscriptionRequestBuilder,
  WebhookPayloadBuilder,
} from "../src/builders";
import { BillingFixtureFactory } from "../src/fixture";
import type { SubscriptionResponse, Subscription } from "../src/domain";
import type { ChargeResult } from "../src/payment-provider";
import { WebhookSimulator } from "../src/webhook-simulator";

const fixedClock = () => new Date("2025-01-01T00:00:00.000Z");
const paymentSucceeded: ChargeResult = {
  outcome: "succeeded",
  providerReference: "pay_test_success",
};

function setup(outcomes?: ChargeResult[]) {
  const fixture = BillingFixtureFactory.create(outcomes, fixedClock);
  const api = new BillingApiClient(fixture.app);
  const webhooks = new WebhookSimulator(api, fixture.service);
  return { ...fixture, api, webhooks };
}

async function createBasic(
  api: BillingApiClient,
): Promise<Subscription> {
  const response = await api.createSubscription(
    new SubscriptionRequestBuilder().build(),
  );
  expect(response.status).toBe(201);
  return asResponse<SubscriptionResponse>(response).subscription;
}

function webhook(
  subscriptionId: string,
  options: {
    eventId?: string;
    invoiceId?: string;
    type?: "payment.succeeded" | "payment.failed" | "payment.refunded";
    amount?: number;
  } = {},
) {
  return new WebhookPayloadBuilder()
    .withEventId(options.eventId ?? `evt_${subscriptionId}_${options.invoiceId ?? "1"}_${options.type ?? "success"}`)
    .withType(options.type ?? "payment.succeeded")
    .forSubscription(subscriptionId)
    .forInvoice(options.invoiceId ?? `inv_${subscriptionId}_1`)
    .withAmount(options.amount ?? 1900)
    .build();
}

describe("subscription API and persistence", () => {
  it("creates a basic trial and persists the same API-visible state without charging", async () => {
    const { api, repository, paymentProvider } = setup();
    const response = await api.createSubscription(
      new SubscriptionRequestBuilder().build(),
    );
    const body = asResponse<SubscriptionResponse>(response);

    expect(response.status).toBe(201);
    expect(body.subscription).toMatchObject({
      customerId: "cust_test_001",
      plan: "basic",
      status: "trialing",
      trialEndsAt: "2025-01-15T00:00:00.000Z",
    });
    expect(body.invoice).toBeNull();
    expect(repository.getSubscription(body.subscription.id)).toEqual(
      body.subscription,
    );
    expect(repository.listInvoices(body.subscription.id)).toEqual([]);
    expect(repository.listAuditEntries(body.subscription.id).map((entry) => entry.type))
      .toEqual(["subscription.created"]);
    expect(paymentProvider.calls).toEqual([]);
  });

  it("charges a pro subscription exactly once and persists a successful invoice", async () => {
    const { api, repository, paymentProvider } = setup([paymentSucceeded]);
    const response = await api.createSubscription(
      new SubscriptionRequestBuilder().withPlan("pro").build(),
    );
    const body = asResponse<SubscriptionResponse>(response);

    expect(response.status).toBe(201);
    expect(body.subscription.status).toBe("active");
    expect(body.subscription.trialEndsAt).toBeNull();
    expect(body.invoice).toMatchObject({
      amount: 4900,
      currency: "USD",
      status: "succeeded",
      providerReference: "pay_test_success",
    });
    expect(repository.getSubscription(body.subscription.id)).toEqual(
      body.subscription,
    );
    expect(repository.listInvoices(body.subscription.id)).toEqual([body.invoice]);
    expect(paymentProvider.calls).toEqual([
      {
        customerId: "cust_test_001",
        paymentMethodId: "pm_test_visa_4242",
        amount: 4900,
        currency: "USD",
        idempotencyKey: `initial:${body.subscription.id}`,
      },
    ]);
  });

  it.each([
    {
      label: "declined",
      outcome: { outcome: "declined", providerReference: "pay_test_declined" } as const,
      invoiceStatus: "failed",
    },
    {
      label: "timed out",
      outcome: { outcome: "timeout", providerReference: null } as const,
      invoiceStatus: "pending",
    },
  ])("records a $label initial charge without activating the subscription", async ({
    outcome,
    invoiceStatus,
  }) => {
    const { api, repository, paymentProvider } = setup([outcome]);
    const response = await api.createSubscription(
      new SubscriptionRequestBuilder().withPlan("pro").build(),
    );
    const body = asResponse<SubscriptionResponse>(response);

    expect(response.status).toBe(201);
    expect(body.subscription.status).toBe("past_due");
    expect(body.invoice?.status).toBe(invoiceStatus);
    expect(repository.getSubscription(body.subscription.id)?.status).toBe("past_due");
    expect(repository.listInvoices(body.subscription.id)).toHaveLength(1);
    expect(paymentProvider.calls).toHaveLength(1);
    expect(paymentProvider.calls[0].amount).toBe(4900);
  });

  it.each([
    {
      label: "unknown plan",
      request: new SubscriptionRequestBuilder().withPlan("enterprise").build(),
      status: 400,
      error: "invalid_plan",
    },
    {
      label: "missing payment method",
      request: new SubscriptionRequestBuilder().withPaymentMethod("").build(),
      status: 400,
      error: "invalid_request",
    },
    {
      label: "unknown customer",
      request: new SubscriptionRequestBuilder().withCustomer("cust_missing").build(),
      status: 404,
      error: "customer_not_found",
    },
  ])("rejects $label without provider or persistence side effects", async ({
    request,
    status,
    error,
  }) => {
    const { api, repository, paymentProvider } = setup();
    const response = await api.createSubscription(request);

    expect(response.status).toBe(status);
    expect(response.body.error).toBe(error);
    expect(repository.listSubscriptions()).toEqual([]);
    expect(repository.listInvoices()).toEqual([]);
    expect(paymentProvider.calls).toEqual([]);
  });

  it("rejects a null request body as a validation error", async () => {
    const { api, repository, paymentProvider } = setup();
    const response = await api.createRawSubscription(null);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_request");
    expect(repository.listSubscriptions()).toEqual([]);
    expect(paymentProvider.calls).toEqual([]);
  });

  it("serves and cancels subscriptions, and rejects a second cancellation", async () => {
    const { api, repository, paymentProvider } = setup();
    const created = await createBasic(api);
    const retrieved = await api.getSubscription(created.id);
    expect(retrieved.status).toBe(200);
    expect(retrieved.body.subscription).toEqual(created);

    const canceled = await api.cancelSubscription(created.id);
    expect(canceled.status).toBe(200);
    expect(canceled.body.subscription.status).toBe("canceled");
    expect(repository.getSubscription(created.id)?.status).toBe("canceled");
    expect(paymentProvider.calls).toEqual([]);

    const repeated = await api.cancelSubscription(created.id);
    expect(repeated.status).toBe(409);
    expect(repeated.body.error).toBe("already_canceled");
  });
});

describe("lifecycle and billing workflow", () => {
  it("covers trialing -> active, trialing -> past_due, and past_due -> active", async () => {
    const { api, repository, webhooks, paymentProvider } = setup();

    const activated = await createBasic(api);
    const success = webhook(activated.id, { invoiceId: "inv_trial_success" });
    expect((await webhooks.deliver(success)).status).toBe(200);
    expect((await api.getSubscription(activated.id)).body.subscription.status).toBe("active");
    expect(repository.getInvoice("inv_trial_success")?.status).toBe("succeeded");

    const delinquent = await createBasic(api);
    const failed = webhook(delinquent.id, {
      eventId: "evt_trial_failed",
      invoiceId: "inv_trial_failed",
      type: "payment.failed",
    });
    expect((await webhooks.deliver(failed)).status).toBe(200);
    expect(repository.getSubscription(delinquent.id)?.status).toBe("past_due");
    expect(repository.getInvoice("inv_trial_failed")?.status).toBe("failed");

    const retrySuccess = webhook(delinquent.id, {
      eventId: "evt_retry_success",
      invoiceId: "inv_retry_success",
    });
    expect((await webhooks.deliver(retrySuccess)).status).toBe(200);
    expect(repository.getSubscription(delinquent.id)?.status).toBe("active");
    expect(repository.getInvoice("inv_retry_success")?.status).toBe("succeeded");
    expect(paymentProvider.calls).toEqual([]);
  });

  it("covers active -> past_due -> canceled after the configured failed attempts", async () => {
    const { api, repository, webhooks } = setup();
    const created = await createBasic(api);
    const activation = webhook(created.id, {
      eventId: "evt_activate_before_failures",
      invoiceId: "inv_activation",
    });
    await webhooks.deliver(activation);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const failure = webhook(created.id, {
        eventId: `evt_failure_${attempt}`,
        invoiceId: `inv_failure_${attempt}`,
        type: "payment.failed",
      });
      const response = await webhooks.deliver(failure);
      expect(response.status).toBe(200);
      expect(repository.getSubscription(created.id)?.status).toBe(
        attempt < 3 ? "past_due" : "canceled",
      );
    }

    const subscription = repository.getSubscription(created.id)!;
    expect(subscription.failedAttempts).toBe(3);
    expect(repository.listInvoices(created.id).map((invoice) => invoice.status))
      .toEqual(["succeeded", "failed", "failed", "failed"]);
    expect(repository.listAuditEntries(created.id)
      .filter((entry) => entry.type === "subscription.status_changed")
      .map((entry) => entry.details.to))
      .toEqual(["active", "past_due", "canceled"]);
  });

  it("allows cancellation from active and makes canceled state irreversible by webhook", async () => {
    const { api, repository, webhooks } = setup();
    const created = await createBasic(api);
    await webhooks.deliver(webhook(created.id, {
      eventId: "evt_activate_before_cancel",
      invoiceId: "inv_before_cancel",
    }));
    expect((await api.cancelSubscription(created.id)).body.subscription.status).toBe("canceled");

    const stale = webhook(created.id, {
      eventId: "evt_after_cancel",
      invoiceId: "inv_after_cancel",
    });
    const response = await webhooks.deliver(stale);
    expect(response.status).toBe(200);
    expect(response.body.outcome).toBe("ignored_canceled");
    expect(repository.getSubscription(created.id)?.status).toBe("canceled");
    expect(repository.getInvoice("inv_after_cancel")).toBeUndefined();
    expect(repository.getWebhookEvent(stale.event_id)?.outcome).toBe("ignored_canceled");
  });

  it("does not regress a successful invoice when its failure arrives out of order", async () => {
    const { api, repository, webhooks } = setup();
    const created = await createBasic(api);
    const success = webhook(created.id, {
      eventId: "evt_invoice_success",
      invoiceId: "inv_out_of_order",
    });
    await webhooks.deliver(success);

    const staleFailure = webhook(created.id, {
      eventId: "evt_invoice_late_failure",
      invoiceId: "inv_out_of_order",
      type: "payment.failed",
    });
    const response = await webhooks.deliver(staleFailure);

    expect(response.body.outcome).toBe("ignored_stale");
    expect(repository.getSubscription(created.id)?.status).toBe("active");
    expect(repository.getInvoice("inv_out_of_order")?.status).toBe("succeeded");
    expect(repository.getWebhookEvent(staleFailure.event_id)?.outcome).toBe("ignored_stale");
  });

  it("processes a duplicate event once and records its redelivery without duplicate payment", async () => {
    const { api, repository, webhooks, paymentProvider } = setup();
    const created = await createBasic(api);
    const payload = webhook(created.id, {
      eventId: "evt_redelivered",
      invoiceId: "inv_redelivered",
    });

    expect((await webhooks.deliver(payload)).body.duplicate).toBe(false);
    expect((await webhooks.deliver(payload)).body.duplicate).toBe(true);

    expect(repository.listInvoices(created.id)).toHaveLength(1);
    expect(repository.listWebhookEvents(created.id)).toHaveLength(1);
    expect(repository.getWebhookEvent(payload.event_id)?.deliveryCount).toBe(2);
    expect(repository.listAuditEntries(created.id)
      .filter((entry) => entry.type === "subscription.status_changed"))
      .toHaveLength(1);
    expect(paymentProvider.calls).toEqual([]);
  });

  it("rejects reuse of an event ID for a different payment without mutating its first delivery", async () => {
    const { api, repository, webhooks } = setup();
    const created = await createBasic(api);
    const original = webhook(created.id, {
      eventId: "evt_idempotency_collision",
      invoiceId: "inv_idempotency_collision",
    });
    await webhooks.deliver(original);
    const collision = webhook(created.id, {
      eventId: original.event_id,
      invoiceId: "inv_other",
      type: "payment.failed",
    });

    const response = await webhooks.deliver(collision);
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("idempotency_conflict");
    expect(repository.getWebhookEvent(original.event_id)?.deliveryCount).toBe(1);
    expect(repository.listInvoices(created.id)).toHaveLength(1);
    expect(repository.getSubscription(created.id)?.status).toBe("active");
  });

  it("records refunds and moves an active subscription to past_due", async () => {
    const { api, repository, webhooks } = setup();
    const created = await createBasic(api);
    const invoiceId = "inv_to_refund";
    await webhooks.deliver(webhook(created.id, {
      eventId: "evt_paid_before_refund",
      invoiceId,
    }));
    const refund = webhook(created.id, {
      eventId: "evt_refund",
      invoiceId,
      type: "payment.refunded",
    });

    expect((await webhooks.deliver(refund)).body.outcome).toBe("processed");
    expect(repository.getSubscription(created.id)?.status).toBe("past_due");
    expect(repository.getInvoice(invoiceId)?.status).toBe("refunded");
  });
});

describe("webhook contract and idempotency boundary", () => {
  it("rejects invalid signatures and malformed JSON without recording events", async () => {
    const { api, repository, webhooks } = setup();
    const created = await createBasic(api);
    const payload = webhook(created.id, { eventId: "evt_bad_signature" });

    const unauthorized = await webhooks.deliverRaw(
      JSON.stringify(payload),
      "00".repeat(32),
    );
    expect(unauthorized.status).toBe(401);

    const malformed = await webhooks.deliverRaw("{not-json", "invalid");
    expect(malformed.status).toBe(400);
    expect(repository.listWebhookEvents()).toEqual([]);
    expect(repository.listInvoices(created.id)).toEqual([]);
  });

  it("rejects signed but invalid payloads and plan-price mismatches", async () => {
    const { api, repository, webhooks, service } = setup();
    const created = await createBasic(api);

    const malformedPayload = JSON.stringify({ event_id: "evt_incomplete" });
    const invalidShape = await webhooks.deliverRaw(
      malformedPayload,
      service.signWebhook(malformedPayload),
    );
    expect(invalidShape.status).toBe(400);

    const wrongAmount = webhook(created.id, {
      eventId: "evt_wrong_amount",
      amount: 4900,
    });
    expect((await webhooks.deliver(wrongAmount)).status).toBe(422);
    expect(repository.listWebhookEvents()).toEqual([]);
    expect(repository.listInvoices(created.id)).toEqual([]);
  });

  it("rejects a webhook referencing an invoice owned by another subscription", async () => {
    const { api, repository, webhooks } = setup();
    const first = await createBasic(api);
    const second = await createBasic(api);
    const invoicePayload = webhook(first.id, {
      eventId: "evt_invoice_owner",
      invoiceId: "inv_shared",
    });
    await webhooks.deliver(invoicePayload);

    const mismatch = webhook(second.id, {
      eventId: "evt_invoice_wrong_owner",
      invoiceId: "inv_shared",
    });
    expect((await webhooks.deliver(mismatch)).status).toBe(422);
    expect(repository.getSubscription(second.id)?.status).toBe("trialing");
    expect(repository.getWebhookEvent(mismatch.event_id)).toBeUndefined();
  });

  it("uses a customer builder to seed isolated fixture data", () => {
    expect(new CustomerBuilder().withId("cust_custom").withEmail("custom@example.test").build())
      .toEqual({ id: "cust_custom", email: "custom@example.test" });
  });
});
