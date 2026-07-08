# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: live-qa.spec.ts >> Kairos live QA — Agent Creation end-to-end >> 4-9. Open Create Agent wizard through AI Plan step
- Location: e2e/live-qa.spec.ts:158:7

# Error details

```
Test timeout of 180000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - navigation [ref=e2]:
    - generic [ref=e3]:
      - link "Kairos KAIROS" [ref=e4] [cursor=pointer]:
        - /url: /dashboard
        - img "Kairos" [ref=e5]
        - generic [ref=e6]: KAIROS
      - generic [ref=e7]:
        - link "Overview" [ref=e8] [cursor=pointer]:
          - /url: /dashboard
        - link "Agents" [ref=e9] [cursor=pointer]:
          - /url: /dashboard/agents
        - link "Context" [ref=e10] [cursor=pointer]:
          - /url: /dashboard/context
    - generic [ref=e11]:
      - button "Settings" [ref=e13]:
        - img [ref=e14]
      - button "Connect Wallet" [ref=e17]:
        - img [ref=e18]
        - text: Connect Wallet
  - main [ref=e21]:
    - generic [ref=e23]:
      - generic [ref=e24]:
        - generic [ref=e25]:
          - img [ref=e27]
          - generic [ref=e30]:
            - generic [ref=e31]:
              - heading "Agent Fleet" [level=1] [ref=e32]
              - generic [ref=e33]: idle
            - paragraph [ref=e35]: Operating system for your autonomous capital.
        - generic [ref=e36]:
          - generic [ref=e37]:
            - img
            - textbox "Search agents…" [ref=e38]
          - button "Notifications" [ref=e39]:
            - img [ref=e40]
          - button "Create Agent" [disabled] [ref=e43]:
            - img [ref=e44]
            - text: Create Agent
      - generic [ref=e46]:
        - paragraph [ref=e47]: Connect Freighter to view your agent fleet.
        - button "Connect Freighter" [active] [ref=e48]
  - generic [ref=e53] [cursor=pointer]:
    - button "Open Next.js Dev Tools" [ref=e54]:
      - img [ref=e55]
    - generic [ref=e58]:
      - button "Open issues overlay" [ref=e59]:
        - generic [ref=e60]:
          - generic [ref=e61]: "0"
          - generic [ref=e62]: "1"
        - generic [ref=e63]: Issue
      - button "Collapse issues badge" [ref=e64]:
        - img [ref=e65]
  - alert [ref=e67]
  - generic [ref=e69]:
    - generic [ref=e70]:
      - heading "Learn more" [level=2] [ref=e71]
      - generic [ref=e72]:
        - generic [ref=e73]:
          - heading "What is a Wallet?" [level=3] [ref=e74]
          - paragraph [ref=e75]: Wallets are used to send, receive, and store the keys you use to sign blockchain transactions.
        - generic [ref=e76]:
          - heading "What is Stellar?" [level=3] [ref=e77]
          - paragraph [ref=e78]: Stellar is a decentralized, public blockchain that gives developers the tools to create experiences that are more like cash than crypto.
    - generic [ref=e79]:
      - generic [ref=e80]:
        - heading "Connect a Wallet" [level=2] [ref=e81]
        - button "Close" [ref=e82]:
          - img [ref=e83]
      - paragraph [ref=e88]:
        - text: Powered by
        - link "Stellar Wallets Kit" [ref=e89] [cursor=pointer]:
          - /url: https://stellarwalletskit.dev
```