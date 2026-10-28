## Summary

Added a focused TypeScript/Vitest automation suite and a minimal subscription-billing HTTP fixture so lifecycle, persistence, webhook, and provider behavior can be validated end to end.

## Test Strategy

- **Levels covered:** API contract, lifecycle/state-machine, persistence/repository, provider interaction, and end-to-end webhook workflows.
- **In scope:** create/read/cancel, trial and immediate-charge plans, validation failures, payment outcomes, retries, duplicate and out-of-order webhooks, refunds, signature validation, auditability, and state consistency.
- **Out of scope:** production billing features, UI, load/performance testing, distributed concurrency, and real provider/database integrations.
- **Real vs. stubbed/mocked:** Express routing, service rules, state transitions, and repository behavior execute in-process. The repository is isolated in-memory state. The payment provider is a recording mock; webhook deliveries are simulated and HMAC-signed.

## OOP & Design Pattern Choices

- `SubscriptionLifecycle` applies an explicit transition table so an illegal state change is rejected centrally.
- `PaymentProvider` with injected `MockPaymentProvider` provides a Strategy/Adapter seam and allows verification of call count, arguments, and outcomes without network access.
- `InMemoryBillingRepository` applies the Repository pattern, giving tests queryable persistence operations instead of raw storage access.
- `BillingFixtureFactory` isolates test environments. Request, customer, and webhook builders reduce repeated setup literals.

## API Validation Approach

`BillingApiClient` wraps create, retrieve, cancel, and webhook requests. Tests verify status codes, response shapes, and persisted outcomes. Invalid plans, missing fields, unknown customers, repeated cancellation, invalid webhook signatures, malformed JSON, invalid signed payloads, price mismatches, and invoice ownership mismatches are covered.

## Database Validation Approach

The repository exposes subscriptions, invoices, webhook events, and audit entries. Assertions compare API-returned subscription values with stored values at creation and after workflow transitions; validate invoice status/reference/amount; check webhook delivery counts and outcomes; and confirm invalid or duplicate requests do not create unintended records. Every test builds a new repository to avoid stale data.

## Mock Payment Provider & Webhook Validation

`MockPaymentProvider` records customer, payment method, amount, currency, and idempotency key and can return success, decline, or timeout. Tests assert both calls and non-calls. `WebhookSimulator` signs the exact raw body. Repeated event IDs increment the original delivery count without repeating invoice/state side effects; mismatched reuse conflicts. A later failure for an already-successful invoice is persisted as ignored and cannot regress subscription or invoice state.

## State-Machine / Lifecycle Coverage

Valid transitions exercised: `trialing -> active`, `trialing -> past_due`, `active -> past_due`, `past_due -> active`, `past_due -> canceled`, `active -> canceled`, and `trialing -> canceled`. Invalid behavior exercised: canceled subscriptions cannot be reactivated by later success events or canceled a second time; a failure arriving after success for the same invoice cannot regress it.

## Test Architecture

The fixture factory wires a fresh repository, payment double, service, and Express app. The API client and webhook simulator isolate transport details; builders keep scenario setup readable; test assertions query the repository rather than reaching into service internals. This separates scenario intent from HTTP and persistence mechanics.

## Validation

- `npm test`
- `npm run build`

## Known Limitations / Next Steps

The in-memory repository does not validate real database constraints, transactions, persistence across restarts, or distributed races. Concurrency/idempotency under simultaneous deliveries is not modeled. A production integration would need durable storage and a carefully defined transactional/outbox strategy around provider operations.

## Responsible AI Usage

AI assistance was used to scaffold the fixture, test scenarios, and documentation. The generated implementation was checked with the test suite and TypeScript type-check. The candidate should review the design and assumptions, adapt the submission directory/PR metadata, and personally verify the final behavior before submission.
