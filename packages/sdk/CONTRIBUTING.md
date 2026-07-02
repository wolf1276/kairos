# Contributing to Kairos SDK

## Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. Run tests:
   ```bash
   npm run test
   ```

## Workflow

- **Do not modify the contracts directly**. The smart contracts reside in `contracts/soroban` and must not be altered.
- **Ensure ESM + CommonJS compatibility**: Build outputs should tree-shake properly.
- **Add Tests**: All new features and modules should include corresponding tests under `tests/`.
