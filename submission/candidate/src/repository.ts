import type {
  AuditEntry,
  Customer,
  Invoice,
  Subscription,
  WebhookEventRecord,
} from "./domain";

export class InMemoryBillingRepository {
  private readonly customers = new Map<string, Customer>();
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly invoices = new Map<string, Invoice>();
  private readonly webhookEvents = new Map<string, WebhookEventRecord>();
  private readonly auditEntries: AuditEntry[] = [];

  addCustomer(customer: Customer): void {
    this.customers.set(customer.id, { ...customer });
  }

  getCustomer(id: string): Customer | undefined {
    const customer = this.customers.get(id);
    return customer ? { ...customer } : undefined;
  }

  addSubscription(subscription: Subscription): void {
    this.subscriptions.set(subscription.id, { ...subscription });
  }

  getSubscription(id: string): Subscription | undefined {
    const subscription = this.subscriptions.get(id);
    return subscription ? { ...subscription } : undefined;
  }

  updateSubscription(subscription: Subscription): void {
    this.subscriptions.set(subscription.id, { ...subscription });
  }

  listSubscriptions(): Subscription[] {
    return [...this.subscriptions.values()].map((item) => ({ ...item }));
  }

  addInvoice(invoice: Invoice): void {
    this.invoices.set(invoice.id, { ...invoice });
  }

  getInvoice(id: string): Invoice | undefined {
    const invoice = this.invoices.get(id);
    return invoice ? { ...invoice } : undefined;
  }

  updateInvoice(invoice: Invoice): void {
    this.invoices.set(invoice.id, { ...invoice });
  }

  listInvoices(subscriptionId?: string): Invoice[] {
    return [...this.invoices.values()]
      .filter(
        (invoice) =>
          subscriptionId === undefined ||
          invoice.subscriptionId === subscriptionId,
      )
      .map((item) => ({ ...item }));
  }

  addWebhookEvent(event: WebhookEventRecord): void {
    this.webhookEvents.set(event.eventId, { ...event });
  }

  getWebhookEvent(eventId: string): WebhookEventRecord | undefined {
    const event = this.webhookEvents.get(eventId);
    return event ? { ...event } : undefined;
  }

  incrementWebhookDelivery(eventId: string): void {
    const event = this.webhookEvents.get(eventId);
    if (event) {
      this.webhookEvents.set(eventId, {
        ...event,
        deliveryCount: event.deliveryCount + 1,
      });
    }
  }

  listWebhookEvents(subscriptionId?: string): WebhookEventRecord[] {
    return [...this.webhookEvents.values()]
      .filter(
        (event) =>
          subscriptionId === undefined ||
          event.subscriptionId === subscriptionId,
      )
      .map((item) => ({ ...item }));
  }

  addAuditEntry(entry: AuditEntry): void {
    this.auditEntries.push({ ...entry, details: { ...entry.details } });
  }

  listAuditEntries(subscriptionId?: string): AuditEntry[] {
    return this.auditEntries
      .filter(
        (entry) =>
          subscriptionId === undefined ||
          entry.subscriptionId === subscriptionId,
      )
      .map((item) => ({ ...item, details: { ...item.details } }));
  }
}
