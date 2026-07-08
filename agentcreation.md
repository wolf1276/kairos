# Kairos Agent Creation Flow

Version: 1.0

---

# Philosophy

Creating an agent should feel like **hiring an autonomous portfolio manager**, not configuring a trading bot.

The user describes **what** they want to achieve.

Kairos determines **how** to achieve it.

The user should never need to understand:

- Smart Contracts
- Delegation Framework
- Runtime
- Pipelines
- Memory
- Strategies
- Protocol Selection

Kairos handles those automatically.

---

# User Journey

```
Connect Wallet

↓

Create Agent

↓

Describe Goal

↓

AI Understanding

↓

Capital & Safety

↓

Permissions

↓

Review Plan

↓

Smart Wallet Validation

↓

Delegation Approval

↓

Agent Creation

↓

Mission Control
```

---

# Step 1 — Describe Your Goal

The first screen asks only one question.

## Question

> **What do you want this agent to accomplish?**

Large natural language input.

Examples

- Grow my XLM over the long term.
- Maximize yield while keeping risk low.
- Preserve my capital.
- Generate passive income.
- Rebalance my portfolio automatically.

---

## Quick Templates

```
🌾 Yield Optimizer

📈 Growth

📊 Portfolio Manager

🛡 Capital Preservation

💵 Passive Income

✨ Custom
```

Templates simply pre-fill the prompt.

---

# Step 2 — AI Understanding

Kairos analyzes the request.

Nothing is created yet.

Generate an editable Agent Specification.

Display

```
Mission

Objective

Risk Level

Suggested Capital

Execution Style

Confidence
```

Example

```
Mission

Yield Optimization

Objective

Long-term Growth

Risk

Balanced

Execution

Autonomous

Confidence

94%
```

Allow the user to edit every field.

If required information is missing,

ask clarification questions.

Never invent values.

---

# Step 3 — Capital & Safety

## Capital

What should this agent manage?

```
○ Entire Smart Wallet

○ Percentage of Smart Wallet

○ Fixed Amount
```

If Percentage

```
30%
```

If Fixed Amount

```
500 XLM
```

---

## Safety

Keep this human-readable.

```
Risk

○ Conservative

● Balanced

○ Aggressive

────────────────────────

Maximum Allocation

20%

────────────────────────

Maximum Daily Trades

5

────────────────────────

Maximum Slippage

0.5%
```

Never expose backend configuration.

---

# Step 4 — Permissions

The user approves capabilities.

Not protocols.

Example

```
Allow this agent to:

☑ Swap Assets

☑ Earn Yield

☑ Rebalance Portfolio

☑ Dollar Cost Average (DCA)

☑ Hold Stable Assets

☐ Borrow Assets

☐ Use Leverage
```

Permissions become the Delegation Policy.

---

# Step 5 — AI Plan

Kairos explains the generated plan.

Example

```
Kairos will:

✓ Manage 30% of your Smart Wallet

✓ Search for the best available yield

✓ Automatically rebalance

✓ Never use leverage

✓ Never exceed your allocation limit

✓ Stay within your approved permissions
```

This is a review screen.

Nothing has been created yet.

---

# Step 6 — Smart Wallet Validation

Verify

```
Connected Wallet

↓

Smart Wallet Exists?
```

---

If Smart Wallet exists

```
✓ Smart Wallet Found

Balance

1250 XLM

Continue
```

---

If Smart Wallet does not exist

```
No Smart Wallet Found

Create Smart Wallet
```

Create

↓

Wait for confirmation

↓

Refresh

↓

Continue

---

If balance is insufficient

```
Smart Wallet requires funds.

Deposit funds before this agent can begin autonomous execution.

[Deposit]

[Refresh Balance]
```

Never continue until requirements are satisfied.

---

# Step 7 — Delegation Approval

Present a human-readable approval.

Example

```
You are authorizing Kairos to:

✓ Swap Assets

✓ Earn Yield

✓ Rebalance Portfolio

Maximum Managed Capital

30%

Maximum Allocation

20%

Leverage

Disabled
```

User must explicitly approve.

No blockchain terminology unless required.

---

# Step 8 — Agent Creation

Display progress.

```
Creating Agent...

✓ Policy

✓ Smart Wallet

✓ Delegation

✓ Runtime

✓ Memory

✓ Benchmark

✓ Scheduler

✓ Agent
```

Everything is automatic.

---

# Step 9 — Success

```
Yield Optimizer

Ready

Status

Stopped

Managed Capital

375 XLM

────────────────────────

Open Mission Control

Create Another Agent
```

The runtime remains stopped until the user explicitly starts it.

---

# Backend Flow

```
Natural Language

↓

Intent Parser

↓

AgentSpec

↓

Validation

↓

Policy Generator

↓

Risk Configuration

↓

Delegation Generator

↓

Smart Wallet Validation

↓

Delegation Creation

↓

Runtime Registration

↓

Memory Initialization

↓

Benchmark Initialization

↓

Agent Creation

↓

Mission Control
```

---

# Data Generated Automatically

The user never manually configures:

- Runtime
- Scheduler
- Memory
- Benchmark
- Strategy Registry
- Decision Engine
- Pipeline
- Execution Engine

Kairos generates them from the approved AgentSpec.

---

# Failure Handling

## Parser Failure

Ask clarification.

Never guess.

---

## Smart Wallet Missing

Create Smart Wallet.

Retry automatically.

---

## Smart Wallet Not Funded

Prompt user to deposit funds.

Wait for confirmation.

---

## Delegation Rejected

Stop the workflow.

Do not partially create resources.

---

## Agent Creation Failure

Rollback where safe.

Display the failure.

Allow retry.

---

## Network Failure

Display retry.

Never fabricate success.

---

# Design Principles

Natural language first.

AI understands intent.

Human reviews.

Human approves.

Kairos builds everything else.

Never expose unnecessary blockchain complexity.

Never expose internal architecture.

Never use mocked values.

Never create duplicate Smart Wallets.

Never create duplicate Delegations.

Always fail safely.

---

# Future Enhancements

These are intentionally **out of scope** for Version 1.0:

- Multi-agent templates
- Strategy marketplace
- Protocol preferences
- Advanced execution preferences
- Scheduled execution windows
- Multi-wallet management
- Shared agent templates

---

# Success Criteria

A new user should be able to:

- Connect a wallet.
- Describe a financial goal in plain English.
- Review the AI-generated plan.
- Approve permissions.
- Automatically configure Smart Wallet and Delegation.
- Create an autonomous agent.
- Reach Mission Control.

Without needing to understand:

- DeFi protocols
- Smart contracts
- Delegation Framework
- Runtime configuration
- Pipelines
- Memory systems
- Strategy engines

Kairos handles all technical complexity automatically.