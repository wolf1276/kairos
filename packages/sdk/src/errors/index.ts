export class KairosError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidNonceError extends KairosError {
  constructor(expected: bigint, actual: bigint) {
    super(`Invalid nonce. Expected: ${expected.toString()}, Actual: ${actual.toString()}`);
  }
}

export class UnauthorizedDelegateError extends KairosError {
  constructor(delegate: string) {
    super(`Unauthorized delegate address: ${delegate}`);
  }
}

export class PolicyViolationError extends KairosError {
  constructor(policyType: string, reason: string) {
    super(`Policy Violation (${policyType}): ${reason}`);
  }
}

export class ExecutionFailedError extends KairosError {
  constructor(reason: string) {
    super(`Contract execution failed: ${reason}`);
  }
}

export class DelegationExpiredError extends KairosError {
  constructor(expiry: bigint, now: bigint) {
    super(`Delegation expired. Expiry: ${expiry.toString()}, Current time: ${now.toString()}`);
  }
}

export class RpcError extends KairosError {
  constructor(message: string, public readonly details?: unknown) {
    super(`RPC Error: ${message}`);
  }
}

export class TransactionSimulationError extends KairosError {
  constructor(message: string, public readonly details?: unknown) {
    super(`Transaction Simulation Error: ${message}`);
  }
}
