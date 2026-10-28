import express, { type ErrorRequestHandler, type Request } from "express";
import type { CreateSubscriptionRequest, WebhookPayload } from "./domain";
import { ApiError } from "./domain";
import { BillingService } from "./billing-service";

interface RawBodyRequest extends Request {
  rawBody?: string;
}

export function createBillingApi(service: BillingService): express.Express {
  const app = express();
  app.use(
    express.json({
      strict: false,
      verify: (request, _response, buffer) => {
        (request as RawBodyRequest).rawBody = buffer.toString("utf8");
      },
    }),
  );

  app.post("/subscriptions", async (request, response) => {
    const result = await service.createSubscription(
      request.body as CreateSubscriptionRequest,
    );
    response.status(201).json(result);
  });

  app.get("/subscriptions/:id", (request, response) => {
    response.json({ subscription: service.getSubscription(request.params.id) });
  });

  app.post("/subscriptions/:id/cancel", (request, response) => {
    response.json({ subscription: service.cancelSubscription(request.params.id) });
  });

  app.post("/webhooks/payment-provider", (request, response) => {
    const rawBody = (request as RawBodyRequest).rawBody ?? "";
    const signature = request.header("X-Provider-Signature") ?? "";
    if (!service.isValidWebhookSignature(rawBody, signature)) {
      throw new ApiError(401, "invalid_signature", "Webhook signature is invalid");
    }
    response.json(service.processWebhook(request.body as WebhookPayload));
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof ApiError) {
      response.status(error.statusCode).json({
        error: error.code,
        message: error.message,
      });
      return;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      error.status === 400
    ) {
      response.status(400).json({ error: "malformed_json" });
      return;
    }
    response.status(500).json({ error: "internal_error" });
  };
  app.use(errorHandler);
  return app;
}
