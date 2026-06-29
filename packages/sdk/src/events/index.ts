import { Address, rpc, xdr } from '@stellar/stellar-sdk';
import { KairosClient } from '../client';

export interface KairosEvent {
  type: 'DelegationRevoked' | 'DelegationEnabled' | 'DelegationExecuted' | 'PolicyViolation' | 'ExecutionFailed' | 'ExecutionSucceeded';
  contractId: string;
  id: string;
  ledger: number;
  data: any;
}

export class EventsModule {
  private activeSubscriptions: Map<string, { interval: NodeJS.Timeout }> = new Map();

  constructor(private client: KairosClient) {}

  /**
   * Decodes a raw Soroban event.
   */
  decode(rawEvent: any): KairosEvent | null {
    try {
      const contractId = rawEvent.contractId;
      const topics = rawEvent.topic.map((t: any) => xdr.ScVal.fromXDR(Buffer.from(t, 'base64')));
      const value = xdr.ScVal.fromXDR(Buffer.from(rawEvent.value, 'base64'));

      if (topics.length === 0) return null;

      const eventTypeSymbol = topics[0].sym().toString();

      if (eventTypeSymbol === 'disabled') {
        const delegator = Address.fromScVal(topics[1]).toString();
        const hash = value.bytes().toString('hex');
        return {
          type: 'DelegationRevoked',
          contractId,
          id: rawEvent.id,
          ledger: rawEvent.ledger,
          data: { delegator, hash },
        };
      }

      if (eventTypeSymbol === 'enabled') {
        const delegator = Address.fromScVal(topics[1]).toString();
        const hash = value.bytes().toString('hex');
        return {
          type: 'DelegationEnabled',
          contractId,
          id: rawEvent.id,
          ledger: rawEvent.ledger,
          data: { delegator, hash },
        };
      }

      if (eventTypeSymbol === 'redeemed') {
        const redeemer = Address.fromScVal(topics[1]).toString();
        const rootDelegator = Address.fromScVal(value).toString();
        return {
          type: 'DelegationExecuted',
          contractId,
          id: rawEvent.id,
          ledger: rawEvent.ledger,
          data: { redeemer, rootDelegator },
        };
      }

      return null;
    } catch (e) {
      // Return raw representation or null on fail
      return null;
    }
  }

  /**
   * Queries historical events based on RPC filters.
   */
  async query(filters: {
    startLedger?: number;
    limit?: number;
    topicFilters?: Array<{
      topics: string[];
    }>;
  }): Promise<KairosEvent[]> {
    const rpcFilters: any = {
      startLedger: filters.startLedger || 1,
      filters: (filters.topicFilters || []).map(f => ({
        contractIds: [this.client.contracts.delegationManager],
        topics: f.topics.map(t => {
          if (t === '*') return '*';
          // If it is a valid hex hash, convert it to XDR BytesN
          if (/^[0-9a-fA-F]{64}$/.test(t)) {
            return this.client.hexToBytesN32ScVal(t).toXDR('base64');
          }
          return xdr.ScVal.scvSymbol(t).toXDR('base64');
        }),
      })),
      limit: filters.limit,
    };

    const res = (await this.client.rpcProvider.getEvents(rpcFilters)) as any;
    return res.events
      .map((e: any) => this.decode(e))
      .filter((e: any): e is KairosEvent => e !== null);
  }

  /**
   * Subscribes to new events using polling (simulating real-time updates).
   */
  subscribe(
    subscriptionId: string,
    callback: (event: KairosEvent) => void,
    options?: { pollIntervalMs?: number }
  ): void {
    if (this.activeSubscriptions.has(subscriptionId)) {
      throw new Error(`Subscription with ID ${subscriptionId} already exists`);
    }

    let lastLedger = 0;
    const pollInterval = options?.pollIntervalMs || 5000;

    const interval = setInterval(async () => {
      try {
        if (lastLedger === 0) {
          const ledgerInfo = await this.client.rpcProvider.getLatestLedger();
          lastLedger = ledgerInfo.sequence;
        }

        const events = await this.query({
          startLedger: lastLedger + 1,
          topicFilters: [
            { topics: ['*'] }
          ],
        });

        for (const event of events) {
          if (event.ledger > lastLedger) {
            lastLedger = event.ledger;
          }
          callback(event);
        }
      } catch (err) {
        // Suppress or emit error
      }
    }, pollInterval);

    this.activeSubscriptions.set(subscriptionId, { interval });
  }

  /**
   * Unsubscribes from events.
   */
  unsubscribe(subscriptionId: string): void {
    const sub = this.activeSubscriptions.get(subscriptionId);
    if (sub) {
      clearInterval(sub.interval);
      this.activeSubscriptions.delete(subscriptionId);
    }
  }
}
