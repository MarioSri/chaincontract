# Chain Contract

Chain Contract is a milestone-based decentralized payment system for
client–freelancer work. The client locks funds into a Solidity escrow
contract up front; the freelancer delivers milestone by milestone, the
client approves or requests revisions, and approved amounts are released
on chain automatically. There is no intermediary, no custodial server,
and no opaque dispute state — every transition is a transaction that
either party can audit.

## Features

- **MilestoneEscrow.sol (348 lines, Solidity 0.8.24).** A single contract
  with a two-level state machine (agreements and milestones), custom
  errors, role modifiers, and a reentrancy guard on every fund-moving
  path.
- **Pull-payment design.** Approvals accrue to an internal balance map;
  nobody receives ETH inline. The `withdraw()` path runs
  checks-effects-interactions so a failing recipient cannot block other
  participants.
- **18 Hardhat tests** (`test/MilestoneEscrow.test.js`) covering creation,
  funding, surplus-crediting, completion, approval, revision, abort/refund,
  disputes, and unauthorized access — all passing in the verification run.
- **React + web3.js v4 console** (`client/`, TypeScript) that talks to
  the contract through the injected browser wallet or a local Hardhat
  node. New agreements require user-entered title, counterparty, milestones,
  funding, and acceptance criteria; there is no seeded agreement preset.

Modeled on the trust problem freelance marketplaces paper over:
Platform escrow means the platform holds the money and adjudicates
disputes. Here the contract is the escrow agent, and its rules are the
only rules.

## What it does

- **Client creates an agreement** with a title, description, the
  freelancer's address, and a list of milestone titles and amounts.
  Funding can happen in the same transaction or later. The contract accepts
  no more than the unpaid escrow amount and credits any surplus to the
  client's withdrawable balance.
- **Freelancer completes milestones** one at a time; each completion is
  a transaction the client can review before releasing money.
- **Client approves** a completed milestone, which accrues its amount to
  the freelancer's withdrawable balance. When all milestones are
  approved, the agreement auto-releases.
- **Client requests revisions**, resetting a completed milestone back to
  pending.
- **Client aborts** (before any approval) and the escrow refunds to the
  client's withdrawable balance.
- **Either party disputes**, freezing client settlement actions for off-chain
  resolution while funds stay locked and visible.

| Role | Can | Cannot |
|---|---|---|
| Client | create, fund, approve, revise, abort, dispute | complete milestones, withdraw another's balance |
| Freelancer | complete, withdraw own balance, dispute | approve, abort, change amounts after creation |
| Outsider | view agreements and balances | touch any state |

Errors are custom Solidity errors (`OnlyClient`, `InvalidState`,
`MilestoneOutOfRange`, `Reentrant`, …), so failed transactions fail fast
with a specific reason instead of a generic revert.

## How it works

The agreement state machine moves
`Created → Funded → Active → Released | Refunded`, with a separate
`disputed` flag that freezes client settlement actions while funds remain locked.
Milestones move `Pending → Completed → Approved` independently inside an
active agreement.

1. **Creation.** `createAgreement` computes the total from user-entered
   milestone titles and amounts, stores the agreement, and optionally funds
   it in the same call.
2. **Delivery and review.** `completeMilestone` and `requestRevision`
   flip milestone state; `approveMilestone` accrues the amount to the
   freelancer's balance and auto-releases when `approved == total`.
3. **Exits.** `abort` refunds the client before any approval;
   `dispute` freezes the agreement; `withdraw` lets each party pull
   their accrued balance.

Decisions worth calling out:

- **Pull over push.** Funds move only when the recipient calls
  `withdraw()`. Without this, a recipient contract with a failing
  fallback could brick the whole release.
- **Cap then credit.** `fundAgreement` accepts only the unpaid amount needed
  to activate escrow. Any ETH above that cap becomes a pull-payment credit
  for the client instead of being stranded in the contract.
- **Per-agreement reentrancy lock.** `nonReentrant` guards complete,
  approve, abort, and withdraw so a malicious contract cannot recurse
  into the balance update.
- **Settlement-freeze on dispute.** `dispute` does not move funds; it
  blocks approval, revision, and abort paths, keeping both parties' claims legible
  during off-chain resolution.

## Running it locally

Two terminals: one runs the chain, the other serves the console.

```bash
# Terminal 1 — local Ethereum node and deployment
npm install
npx hardhat compile
npx hardhat node            # starts the local node on port 8545
npx hardhat run scripts/deploy.js --network local

# Terminal 2 — the React console
cd client
npm install
npm run dev                 # http://localhost:5173
```

From the console, use a development-chain account to act as the client or
freelancer. Create agreements only from terms you enter yourself; the
interface does not generate a preset agreement. Never paste a real private
key into a local-development console.

Tests:

```bash
npx hardhat test            # 18 passing
```

There are no environment variables, no API keys, and no backend to
configure.

## Project structure

```
contracts/
└── MilestoneEscrow.sol     # the escrow contract and state machine
test/
└── MilestoneEscrow.test.js # 18 Hardhat tests (ESM, chai matchers)
scripts/
└── deploy.js               # deploys and writes ABI + address for the client
client/
├── src/
│   ├── App.tsx             # the console UI
│   ├── lib/chain.ts        # web3.js v4 binding and formatting helpers
│   └── abi/                # ABI and address, generated by deploy.js
└── index.html
hardhat.config.js           # Hardhat 3 config (ESM, simulated + HTTP networks)
```

## Scope and limitations

This is a teaching-grade escrow, not a production payment processor. A local
Hardhat node settles transactions in real time, but its accounts and ETH are
simulated development data rather than public-chain funds.
Deliberately out of scope: fee splits, multi-token support (ETH only),
on-chain arbitration (disputes freeze state for off-chain resolution),
deadline enforcement, and upgrades (the contract is intentionally not
proxy-based). The surface is small and correct within itself.

## Security

No secrets, API keys, or credentials live in this repository — the
deployed address and ABI are generated locally, and the well-known Hardhat
development keys are not stored in the project. Against adversarial input the contract reverts with custom
errors on bad state, bad role, or out-of-range indexes, and the
reentrancy guard protects every fund-moving function.

## Contributing

Issues and pull requests are welcome. The regression contract is the
test suite — keep `npx hardhat test` green.

## License

MIT. See [LICENSE](LICENSE).
