import type {
  CreateSubscriptionRequest,
  PaymentEventType,
  WebhookPayload,
} from "./domain";

export class CustomerBuilder {
  private id = "cust_test_001";
  private email = "customer@example.test";

  withId(id: string): this {
    this.id = id;
    return this;
  }

  withEmail(email: string): this {
    this.email = email;
    return this;
  }

  build(): { id: string; email: string } {
    return { id: this.id, email: this.email };
  }
}

export class SubscriptionRequestBuilder {
  private request: CreateSubscriptionRequest = {
    customer_id: "cust_test_001",
    plan: "basic",
    payment_method_id: "pm_test_visa_4242",
  };

  withCustomer(id: string): this {
    this.request.customer_id = id;
    return this;
  }

  withPlan(plan: string): this {
    this.request.plan = plan;
    return this;
  }

  withPaymentMethod(id: string): this {
    this.request.payment_method_id = id;
    return this;
  }

  build(): CreateSubscriptionRequest {
    return { ...this.request };
  }
}

export class WebhookPayloadBuilder {
  private payload: WebhookPayload = {
    event_id: "evt_test_001",
    type: "payment.succeeded",
    subscription_id: "sub_0001",
    invoice_id: "inv_test_001",
    amount: 1900,
    currency: "USD",
  };

  withEventId(id: string): this {
    this.payload.event_id = id;
    return this;
  }

  withType(type: PaymentEventType): this {
    this.payload.type = type;
    return this;
  }

  forSubscription(id: string): this {
    this.payload.subscription_id = id;
    return this;
  }

  forInvoice(id: string): this {
    this.payload.invoice_id = id;
    return this;
  }

  withAmount(amount: number): this {
    this.payload.amount = amount;
    return this;
  }

  build(): WebhookPayload {
    return { ...this.payload };
  }

  toRawBody(): string {
    return JSON.stringify(this.payload);
  }
}
