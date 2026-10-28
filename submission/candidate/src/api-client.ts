import type { Express } from "express";
import request, { type Response, type Test } from "supertest";
import type { CreateSubscriptionRequest } from "./domain";

export class BillingApiClient {
  constructor(private readonly app: Express) {}

  createSubscription(body: CreateSubscriptionRequest): Test {
    return request(this.app).post("/subscriptions").send(body);
  }

  createRawSubscription(body: unknown): Test {
    return request(this.app)
      .post("/subscriptions")
      .set("Content-Type", "application/json")
      .send(JSON.stringify(body));
  }

  getSubscription(id: string): Test {
    return request(this.app).get(`/subscriptions/${id}`);
  }

  cancelSubscription(id: string): Test {
    return request(this.app).post(`/subscriptions/${id}/cancel`);
  }

  deliverWebhook(rawBody: string, signature: string): Test {
    return request(this.app)
      .post("/webhooks/payment-provider")
      .set("Content-Type", "application/json")
      .set("X-Provider-Signature", signature)
      .send(rawBody);
  }
}

export function asResponse<T>(response: Response): T {
  return response.body as T;
}
