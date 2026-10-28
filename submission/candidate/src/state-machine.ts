import type { Subscription, SubscriptionStatus } from "./domain";
import { ApiError } from "./domain";

const transitions: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  trialing: ["active", "past_due", "canceled"],
  active: ["past_due", "canceled"],
  past_due: ["active", "canceled"],
  canceled: [],
};

export class SubscriptionLifecycle {
  canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
    return transitions[from].includes(to);
  }

  transition(
    subscription: Subscription,
    next: SubscriptionStatus,
  ): Subscription {
    if (!this.canTransition(subscription.status, next)) {
      throw new ApiError(
        409,
        "invalid_transition",
        `Cannot transition subscription from ${subscription.status} to ${next}`,
      );
    }

    return { ...subscription, status: next };
  }
}
