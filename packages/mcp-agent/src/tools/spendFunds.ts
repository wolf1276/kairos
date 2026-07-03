import { Address, Keypair, xdr } from '@stellar/stellar-sdk';
import { z } from 'zod';
import { getKairosClient } from '../client.js';
import { loadEligibleDelegations } from '../delegations.js';
import { mapExecutionError, mapThrownError } from '../errors.js';

export const spendFundsSchema = {
  token: z.string().describe('SEP-41 token contract address (C...) to transfer, e.g. the native XLM SAC'),
  to: z.string().describe('Destination address (G... or C...) to receive the funds'),
  amount: z.string().describe('Amount to transfer, in the token\'s smallest unit (stroops for XLM), as a decimal string'),
};

const spendFundsInput = z.object(spendFundsSchema);

export async function spendFundsHandler(
  input: z.infer<typeof spendFundsInput>,
  sessionKeypair: Keypair
) {
  const client = getKairosClient();
  const sessionPubkey = sessionKeypair.publicKey();

  const eligible = await loadEligibleDelegations(client, sessionPubkey);
  // Resolve `0xFE` indexed caveats to their live on-chain policy terms before decoding —
  // dashboard-minted delegations never carry inline terms (see executeAction.ts).
  const withSpendLimit: typeof eligible = [];
  for (const entry of eligible) {
    for (const c of entry.delegation.caveats) {
      try {
        const resolved = await client.delegation.resolveCaveat(entry.delegation.delegator, c);
        const decoded = client.policy.decode(resolved);
        if (decoded.type === 'spend-limit' && decoded.token === input.token) {
          withSpendLimit.push(entry);
          break;
        }
      } catch {
        // unset policy (empty terms) or non-matching caveat
      }
    }
  }

  if (withSpendLimit.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `No delegation grants this agent a spend-limit caveat for token ${input.token}. Ask the delegator to create one via the dashboard.`,
        },
      ],
      isError: true,
    };
  }

  const { hash, delegation } = withSpendLimit[0];
  const amount = BigInt(input.amount);
  const hi = xdr.Int64.fromString(BigInt.asIntN(64, amount >> 64n).toString());
  const lo = xdr.Uint64.fromString(BigInt.asUintN(64, amount).toString());

  try {
    const result = await client.execution.execute({
      redeemer: sessionKeypair,
      delegationChains: [[delegation]],
      executions: [
        {
          target: input.token,
          function: 'transfer',
          args: [
            // `from` is the delegation wallet (delegator), not the agent's own key — the
            // agent only authorizes the spend, the funds move out of the delegator's balance.
            Address.fromString(delegation.delegator).toScVal(),
            Address.fromString(input.to).toScVal(),
            xdr.ScVal.scvI128(new xdr.Int128Parts({ hi, lo })),
          ],
        },
      ],
    });

    if (result.status !== 'SUCCESS') {
      return {
        content: [{ type: 'text' as const, text: mapExecutionError(result) }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Transferred ${input.amount} of ${input.token} to ${input.to} via delegation ${hash}. Tx: ${result.hash}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: 'text' as const, text: mapThrownError(error) }],
      isError: true,
    };
  }
}
