import { Address, Keypair, StrKey, xdr } from '@stellar/stellar-sdk';
import { z } from 'zod';
import { getKairosClient } from '../client.js';
import { loadEligibleDelegations } from '../delegations.js';
import { mapExecutionError, mapThrownError } from '../errors.js';

export const executeActionSchema = {
  target: z.string().describe('Contract address (C...) to invoke'),
  function: z.string().describe('Contract function name to call'),
  args: z
    .array(z.union([z.string(), z.number(), z.boolean()]))
    .describe(
      'Function arguments. Strings that look like G.../C... addresses are encoded as Address, ' +
        'numbers/numeric strings as i128, booleans as bool, everything else as a string. ' +
        'For anything more complex, use spend_funds instead.'
    ),
};

const executeActionInput = z.object(executeActionSchema);

// Best-effort JS value -> ScVal encoder. Complex types (structs, vecs, precise numeric
// types other than i128) aren't representable this way — callers needing those should
// go through a dedicated tool instead of this generic fallback.
function encodeArg(value: string | number | boolean): xdr.ScVal {
  if (typeof value === 'boolean') return xdr.ScVal.scvBool(value);
  if (typeof value === 'string' && (StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value))) {
    return Address.fromString(value).toScVal();
  }
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+$/.test(value))) {
    const amount = BigInt(value);
    const hi = xdr.Int64.fromString(BigInt.asIntN(64, amount >> 64n).toString());
    const lo = xdr.Uint64.fromString(BigInt.asUintN(64, amount).toString());
    return xdr.ScVal.scvI128(new xdr.Int128Parts({ hi, lo }));
  }
  return xdr.ScVal.scvString(String(value));
}

export async function executeActionHandler(
  input: z.infer<typeof executeActionInput>,
  sessionKeypair: Keypair
) {
  const client = getKairosClient();
  const sessionPubkey = sessionKeypair.publicKey();

  const eligible = await loadEligibleDelegations(client, sessionPubkey);
  const withTargetAllowed = eligible.filter(({ delegation }) =>
    delegation.caveats.some((c) => {
      try {
        const decoded = client.policy.decode(c);
        return decoded.type === 'target-whitelist' && decoded.target === input.target;
      } catch {
        return false;
      }
    })
  );

  if (withTargetAllowed.length === 0) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `No delegation whitelists target ${input.target} for this agent. Ask the delegator to create one via the dashboard.`,
        },
      ],
      isError: true,
    };
  }

  const { hash, delegation } = withTargetAllowed[0];

  try {
    const result = await client.execution.execute({
      redeemer: sessionKeypair,
      delegationChains: [[delegation]],
      executions: [
        {
          target: input.target,
          function: input.function,
          args: input.args.map(encodeArg),
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
          text: `Called ${input.function} on ${input.target} via delegation ${hash}. Tx: ${result.hash}`,
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
