# Orivex milestone v1: credential-gated task marketplace

## Accepted baseline

The accepted project already fixed task semantics in a requester wallet and
issued SUCCESS credentials. Wallet connection, example templates and v3
credentials are baseline work, not new milestone claims. This delta starts at
commit `3e1eea5`.

## New work

- Open task publication with immutable terms, trusted issuer, credential
  threshold and claim deadline.
- Agent-initiated, atomic claiming based on onchain issuer-specific SUCCESS
  counts. Other requesters' credentials cannot satisfy the selected policy.
- Requester-only cancellation of unclaimed work; expired work is unclaimable
  without a keeper transaction. Duplicate claims cannot replace the assignee.
- Live board, pagination, eligibility checks, template form and handoff to the
  existing evidence flow. Pending writes resume by saved hash after a reload.
- New v4 deployment, public evidence, read-only verification, 28 new tests and
  GitHub Actions checks for the frontend and intelligent contract.

## Verification

64 frontend and 56 direct contract tests pass. The 28 new cases include
issuer isolation, FAILED/INCONCLUSIVE outcomes, replay, concurrent claim
ordering, deadline equality, cancellation, malformed terms and pending recovery.
Three pre-existing deployment checks pass. GenVM lint and validation pass.

[Live evidence](../deployments/task-board-studio-next.json) records 18 FINALIZED
transactions with majority agreement: 13 successful executions and five expected
contract rejections. SUCCESS unlocked a restricted assignment; FAILED did not
raise the issuer-specific count. Source, evidence hashes, credentials and all
receipts were independently rechecked using `npm run board:check` (zero writes).

The new contract is
[`0xe9045A2ea5A5F43eB6677e2ae6b02E67E8b3B53a`](https://explorer-studio-dev.genlayer.com/address/0xe9045A2ea5A5F43eB6677e2ae6b02E67E8b3B53a).
Browser checks passed at 375/768/1440 px with no board/form overflow or page
errors. See the [walkthrough, architecture and limits](TASK-BOARD.md).

## Submission title

Orivex: Credential-gated task marketplace

## Submission text

Added a live task board where requesters publish work and agents claim it through GenLayer. Each offer fixes its claim, acceptance criterion, trusted credential issuer, required successful-task count and claim deadline. The contract enforces issuer-specific eligibility and atomic assignment; credentials from other issuers cannot bypass the gate. Requesters can cancel only unclaimed work, and expired offers cannot be claimed. The UI supports posting, eligibility checks, claiming, evidence submission and pending transaction recovery after reload. This turns the accepted project's credentials into permission to access follow-up work. A new Studio Dev deployment finalized 18 transactions, including five expected rejections. SUCCESS unlocked restricted work; FAILED left eligibility unchanged. All 64 frontend and 56 contract tests pass, including 28 new cases. Added public evidence, a read-only verifier and CI. No payments or token rewards are claimed.

## Evidence

- [Live board](https://orivexapp.vercel.app/#deploy)
- [User guide](https://orivexapp.vercel.app/docs/guide.html#task-board)
- [Deployment and transaction evidence](https://github.com/Starling-spell/orivex-app/blob/main/deployments/task-board-studio-next.json)
- [Changes from baseline](https://github.com/Starling-spell/orivex-app/compare/3e1eea5...main)
