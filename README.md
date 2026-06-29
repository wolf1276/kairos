# Kairos Monorepo

This repository is configured as a monorepo containing the Kairos Soroban Delegation Framework SDK, the frontend dashboard, and the smart contracts.

## Repository Structure

- [packages/sdk](file:///Users/ahir/deployments/kairos/packages/sdk): The official TypeScript SDK (`@kairos/sdk`) for interacting with the delegation framework.
- [app](file:///Users/ahir/deployments/kairos/app): Next.js dashboard app.
- [soroban-delegation](file:///Users/ahir/deployments/kairos/soroban-delegation): Soroban smart contracts.

## Getting Started

### Workspaces Configuration

This monorepo uses npm and pnpm workspaces. The root configuration is defined in:
- [package.json](file:///Users/ahir/deployments/kairos/package.json)
- [pnpm-workspace.yaml](file:///Users/ahir/deployments/kairos/pnpm-workspace.yaml)

### Install Dependencies

At the root of the repository, run:
```bash
npm install
```

### SDK Commands

To build the SDK:
```bash
npm run build
```

To run SDK tests:
```bash
npm run test
```

For more details on the SDK, refer to the [SDK README](file:///Users/ahir/deployments/kairos/packages/sdk/README.md).
