# Subscription & Billing SDET Assignment — Initial Approach

## Understanding

The goal is to demonstrate reliable validation of a stateful subscription and billing workflow, not to build a production billing product. The solution should prove that API-visible behavior, lifecycle transitions, persisted records, and payment-provider interactions remain consistent under validation failures, retries, duplicate delivery, out-of-order events, and provider failures.

## Proposed approach

- Build a minimal TypeScript service fixture with an HTTP API and isolated, queryable in-memory persistence; use the fixture only to make the test strategy executable.
- Represent lifecycle transitions explicitly and reject or safely ignore illegal and stale transitions.
- Keep the payment-provider dependency behind an injectable interface, with a configurable recording test double and no real network calls.
- Organize scenarios around typed API clients, builders, fixture setup, and repository-based persistence assertions.
- Cover API contracts, all required valid transitions, invalid transitions, duplicate and out-of-order webhooks, signature validation, payment outcomes, and consistency across API, database, audit, and provider calls.
- Document assumptions, what is real versus simulated, design choices, run instructions, limitations, and AI assistance in the submission documentation.

## Initial assumptions

- No existing service implementation is present in the workspace; a small fixture is therefore appropriate.
- The fixture's HTTP boundary and business behavior are real within the test process; the database is isolated in-memory state; the payment provider is always a test double.
- Webhook authenticity is modeled with HMAC over the raw request body, while business-level idempotency is keyed by provider event ID.
- The linked assignment is the source of requirements. Any additional instructions in the email that change scope or submission details should be incorporated before final delivery.
