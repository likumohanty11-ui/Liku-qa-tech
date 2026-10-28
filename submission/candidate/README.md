# Subscription & Billing SDET Submission

This is a small executable test fixture for a stateful subscription billing service. It exists to make the required test strategy concrete; it is not intended to be a production billing implementation.

## Run locally

From the workspace root:

```sh
npm install
npm test
npm run build
```

Tests use Vitest and Supertest. Each test creates a fresh `BillingFixtureFactory` instance with its own in-memory repository and configurable payment-provider double, so records cannot leak between scenarios.

The Windows test environment declares Vitest's Rolldown native binding as an optional dependency explicitly because npm omitted the transitive optional binding during installation. Other platforms skip this Windows-only package.

## Scope and assumptions

- `basic` starts with a 14-day trial at USD 19.00; `pro` charges USD 49.00 immediately.
- A decline creates a failed invoice and moves the subscription to `past_due`. A timeout creates a pending invoice and also leaves it `past_due`; the fixture does not assume whether a timed-out external charge eventually settled.
- Three failed attempts without a successful payment cancel a subscription. A successful retry resets the failed-attempt count.
- A refund marks its successful invoice as refunded and moves an active subscription to `past_due`, representing a balance that needs attention.
- A canceled subscription is terminal. Validly signed events are retained for audit but cannot create invoices or change its status.
- The fixture accepts only plan-matching amounts/currencies. Webhook event IDs are idempotency keys; reusing one with different event content returns a conflict.

## What's exercised

The HTTP API and billing service are real within the test process. Persistence is a queryable in-memory repository with separate subscription, invoice, webhook-event, and audit collections. The payment-provider interface is always replaced with a recording mock; no external payment calls are made. Webhook requests are constructed by the test simulator and signed with HMAC-SHA256 over the exact raw JSON body.

Tests cover create/read/cancel contracts, validation and absence of side effects, immediate provider success/decline/timeout, every documented lifecycle transition, terminal-state behavior, idempotency and event-ID conflicts, out-of-order events, refunds, signature/malformed-body failures, and consistency between API outcomes and persisted records.

## Design and test structure

- `SubscriptionLifecycle` is the explicit state-machine transition table; service status changes pass through it.
- `PaymentProvider` is the dependency-injection seam; `MockPaymentProvider` records full charge arguments and returns configured outcomes.
- `InMemoryBillingRepository` is the Repository pattern, keeping test assertions away from storage implementation details.
- `BillingFixtureFactory` creates isolated fixtures; `SubscriptionRequestBuilder`, `CustomerBuilder`, and `WebhookPayloadBuilder` keep scenario setup intent-focused.
- `BillingApiClient` encapsulates HTTP calls; `WebhookSimulator` signs and delivers exact request bodies.
- `billing.test.ts` groups API/persistence, lifecycle, and webhook-boundary scenarios.

## Persistence assertions

The suite checks subscription status/plan/timestamps, invoices and payment references/status, unique webhook events and delivery counts, and per-subscription audit entries. It also checks that invalid requests leave records and provider calls untouched, stale/duplicate events do not create extra invoices, and canceled subscriptions do not get reactivated.

## Limitations

The fixture uses in-memory state, so it does not prove SQL constraints, process-restart durability, distributed locking, or transactional behavior across a real database and a payment provider. Webhook processing is sequential in this fixture; concurrent delivery/race behavior is not covered. The API contract is intentionally minimal and does not model authentication, production secrets, customer onboarding, or plan changes. The test signing secret is public and strictly test-only.
