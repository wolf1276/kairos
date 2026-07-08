# Kairos Dashboard Layout

This document defines the canonical layout for the Kairos dashboard.

Any UI implementation must follow this layout unless explicitly updated.

---

# Design Philosophy

The Overview page is an **Investor Dashboard**.

It answers only four questions:

1. How much capital do I have?
2. How is it performing?
3. Where is my capital?
4. What happened recently?

The Overview page must **NOT** contain:

- AI Decisions
- Runtime
- Pipeline
- Memory
- Learning
- Benchmark
- Live Terminal
- Strategy Debugging

Those belong to the Agent page.

---

# Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Overview                                                                   │
├────────────────────────────────────────────────────────────────────────────┤

┌──────────────────────────────────────────────────────────────────────────┐
│ Portfolio                                                                │
│                                                                          │
│ Portfolio Value                                  Daily PnL              │
│ $12,458.27                                       +2.48%                 │
│                                                                          │
│ ──────────────────────────────────────────────────────────────────────── │
│                                                                          │
│                     Portfolio Performance Chart                          │
│                                                                          │
│                     (Large Responsive Graph)                             │
│                                                                          │
│                        1D   1W   1M   ALL                                │
└──────────────────────────────────────────────────────────────────────────┘

──────────────────────────────────────────────────────────────────────────────

┌─────────────────────────────┐   ┌─────────────────────────────┐
│ Connected Wallet            │   │ Smart Wallet                │
│                             │   │                             │
│ Balance                     │   │ Balance                     │
│ Address                     │   │ Address                     │
│ Network                     │   │ Network                     │
│ Status                      │   │ Deployment Status           │
│                             │   │                             │
│ View Explorer               │   │ Deposit                     │
│ Copy Address                │   │ Withdraw                    │
│                             │   │ View Explorer               │
│                             │   │ Copy Address                │
└─────────────────────────────┘   └─────────────────────────────┘

──────────────────────────────────────────────────────────────────────────────

┌─────────────────────────────┐   ┌─────────────────────────────┐
│ Portfolio Allocation        │   │ Recent Activity             │
│                             │   │                             │
│ Donut / Allocation Bars     │   │ Latest 5 Events             │
│                             │   │                             │
│ XLM                         │   │ Deposit Completed           │
│ USDC                        │   │ Withdrawal Completed        │
│ AQUA                        │   │ Agent Started              │
│ Other                       │   │ Delegation Created         │
│                             │   │ Swap Executed              │
│                             │   │                             │
│                             │   │ View All →                 │
└─────────────────────────────┘   └─────────────────────────────┘
```

---

# Section Definitions

## Portfolio Hero

Purpose

Display the user's overall portfolio performance.

Contains

- Portfolio Value
- Daily Profit/Loss
- Portfolio Performance Chart
- Time Filters

Chart

- Responsive
- Real portfolio history
- No mock data

---

## Connected Wallet

Display

- Wallet Address
- Wallet Balance
- Network
- Connection Status

Actions

- Copy Address
- View Explorer

No deposit or withdraw controls.

---

## Smart Wallet

Display

- Smart Wallet Address
- Smart Wallet Balance
- Network
- Deployment Status

Actions

- Deposit
- Withdraw
- Copy Address
- View Explorer

If no Smart Wallet exists

Display

"No Smart Wallet Found"

Show

Create Smart Wallet

---

## Portfolio Allocation

Purpose

Visualize asset allocation.

Supported

- Donut Chart
- Horizontal Allocation Bars

Display

- Asset
- Percentage
- Value

---

## Recent Activity

Display only the latest five events.

Supported events

- Deposit
- Withdraw
- Smart Wallet Created
- Delegation Created
- Agent Started
- Agent Stopped
- Swap Executed
- Yield Claimed
- Rebalance
- Policy Updated

Each event displays

- Timestamp
- Event
- Status

Provide

View All

---

# Styling

Theme

- Ultra Dark
- Premium Fintech
- Purple Accent

Cards

- Rounded
- Soft Borders
- Consistent Padding

Spacing

Large vertical spacing.

Typography

Clear hierarchy.

No clutter.

---

# Data Rules

Never use mocked values.

Reuse existing backend APIs.

No duplicated state.

No duplicated components.

All wallet balances must be live.

Portfolio chart must use real portfolio history.

Recent activity must use live events.

---

# Explicitly Out of Scope

The Overview page must not contain

- Runtime
- Pipeline
- AI Decision
- Memory
- Learning
- Benchmark
- Strategy
- Live Terminal
- Developer Tools

These belong to the Agent page.

---

Status

Version: 1.0

Owner: Kairos Dashboard

Last Updated: July 2026