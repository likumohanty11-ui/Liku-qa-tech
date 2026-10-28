export interface ChargeRequest {
  customerId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
}

export type ChargeResult =
  | { outcome: "succeeded"; providerReference: string }
  | { outcome: "declined"; providerReference: string }
  | { outcome: "timeout"; providerReference: null };

export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly calls: ChargeRequest[] = [];
  private readonly outcomes: ChargeResult[];

  constructor(outcomes: ChargeResult[] = [{ outcome: "succeeded", providerReference: "pay_test_1" }]) {
    this.outcomes = [...outcomes];
  }

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    this.calls.push({ ...request });
    return (
      this.outcomes.shift() ?? {
        outcome: "succeeded",
        providerReference: `pay_test_${this.calls.length}`,
      }
    );
  }
}
