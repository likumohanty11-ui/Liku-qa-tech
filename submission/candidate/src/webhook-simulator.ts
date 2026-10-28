import { BillingService } from "./billing-service";
import { BillingApiClient } from "./api-client";
import type { WebhookPayload } from "./domain";

export class WebhookSimulator {
  constructor(
    private readonly api: BillingApiClient,
    private readonly service: BillingService,
  ) {}

  deliver(payload: WebhookPayload) {
    const rawBody = JSON.stringify(payload);
    return this.api.deliverWebhook(rawBody, this.service.signWebhook(rawBody));
  }

  deliverRaw(rawBody: string, signature: string) {
    return this.api.deliverWebhook(rawBody, signature);
  }
}
