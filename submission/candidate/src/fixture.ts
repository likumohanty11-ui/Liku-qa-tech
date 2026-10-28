import { CustomerBuilder } from "./builders";
import { createBillingApi } from "./api";
import { BillingService } from "./billing-service";
import type { ChargeResult } from "./payment-provider";
import { MockPaymentProvider } from "./payment-provider";
import { InMemoryBillingRepository } from "./repository";

export class BillingFixtureFactory {
  static create(
    outcomes?: ChargeResult[],
    clock?: () => Date,
  ) {
    const repository = new InMemoryBillingRepository();
    repository.addCustomer(new CustomerBuilder().build());
    const paymentProvider = new MockPaymentProvider(outcomes);
    const service = new BillingService(repository, paymentProvider, clock);
    const app = createBillingApi(service);
    return { repository, paymentProvider, service, app };
  }
}
