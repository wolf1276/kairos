import { Address, rpc, xdr } from '@stellar/stellar-sdk';
import type { Contract } from '@stellar/stellar-sdk';
import { KairosClient } from '../client';
import { RpcError } from '../errors';

export interface KairosEvent {
  type: 'DelegationRevoked' | 'DelegationEnabled' | 'DelegationExecuted' | 'PolicyViolation' | 'ExecutionFailed' | 'ExecutionSucceeded';
  contractId: string;
  id: string;
  ledger: number;
  data: Record<string, unknown>;
}

interface RawEventInput {
  contractId: string;
  topic: string[];
  value: string;
  id: string;
  ledger: number;
}

function parseEventResponse(e: rpc.Api.EventResponse): RawEventInput {
  return {
    contractId: e.contractId?.toString() ?? '',
    topic: e.topic.map(t => t.toXDR('base64')),
    value: e.value.toXDR('base64'),
    id: e.id,
    ledger: e.ledger,
  };
}

export class EventsModule {
  private activeSubscriptions: Map<string, { interval: ReturnType<typeof setInterval> }> = new Map();

  constructor(private client: KairosClient) {}

  decode(rawEvent: RawEventInput): KairosEvent | null {
    try {
      const contractId = rawEvent.contractId;
      const topics = rawEvent.topic.map((t: string) => xdr.ScVal.fromXDR(Buffer.from(t, 'base64')));
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
        const vec = value.vec();
        if (!vec) return null;
        
        const rootDelegator = Address.fromScVal(vec[0]).toString();
        const delegationHash = vec[1].bytes().toString('hex');
        
        // Decode execution details
        const execMap = vec[2].map();
        if (!execMap) return null;
        
        let target = '';
        let functionName = '';
        for (const entry of execMap) {
          const key = entry.key().sym().toString();
          if (key === 'target') {
            target = Address.fromScVal(entry.val()).toString();
          } else if (key === 'function') {
            functionName = entry.val().sym().toString();
          }
        }

        return {
          type: 'DelegationExecuted',
          contractId,
          id: rawEvent.id,
          ledger: rawEvent.ledger,
          data: { redeemer, rootDelegator, delegationHash, target, function: functionName },
        };
      }

      return null;
    } catch (e) {
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
    const rawFilters: rpc.Server.GetEventsRequest = {
      startLedger: filters.startLedger || 1,
      filters: (filters.topicFilters || []).map(f => ({
        contractIds: [this.client.contracts.delegationManager],
        topics: f.topics.map(t => {
          if (t === '*') return ['*'];
          if (/^[0-9a-fA-F]{64}$/.test(t)) {
            return [this.client.hexToBytesN32ScVal(t).toXDR('base64')];
          }
          return [xdr.ScVal.scvSymbol(t).toXDR('base64')];
        }),
      })),
      limit: filters.limit,
    };

    const res = await this.client.rpcProvider.getEvents(rawFilters);
    return (res.events || [])
      .map(e => this.decode(parseEventResponse(e)))
      .filter((e): e is KairosEvent => e !== null);
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
      throw new RpcError(`Subscription with ID ${subscriptionId} already exists`);
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
      } catch {
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
