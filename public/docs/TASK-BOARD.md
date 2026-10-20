# Credential-gated task board

## Architecture and milestone delta

Baseline: accepted requester-defined tasks and SUCCESS credentials, plus wallet
and example fixes through commit `3e1eea5`. The new feature is open assignment:
requesters publish work without naming an agent; agents consent by claiming it.

The requester fixes claim, criterion, trusted credential issuer, minimum number
of that issuer's successful tasks, and claim deadline before publication.
GenLayer independently judges pinned evidence using the existing comparative
validator. Only SUCCESS increments the issuer/agent counter. That counter is
the contract-enforced permission to claim qualifying follow-up work.

The contract owns publication, eligibility, atomic assignment and cancellation.
The UI owns discovery, wallet connection and transaction progress. Public pinned
documents supply evidence; they are not treated as proof of real-world agency.
No administrator can override eligibility or edit posted terms. Claim deadlines
close unassigned offers only; already claimed tasks remain submit-able.

Any wallet can read the board. A requester pays to post/cancel its unclaimed
work; an eligible agent pays to claim and submit/verify evidence. No background
keeper is required: expired unclaimed work is ineligible without a cleanup call.
No tokens, rewards or escrow are transferred.

Issuer-scoped counts prevent credentials from arbitrary other requesters from
satisfying a specified issuer's policy. Distinct wallets do not establish
distinct human owners. A colluding issuer can still issue favorable tasks.
Credentials from the immutable v3 deployment are historical and are not silently
imported into the new deployment's counters.
Claimed tasks have no abandonment timeout or reassignment mechanism. A requester
can publish replacement work under another task ID; no funds are locked.

The frontend remains centrally hosted on Vercel and reads the public Studio Dev
RPC. The complete source can be self-hosted; published methods can also be called
directly through the SDK. Task terms, wallet addresses and evidence URLs are
public. This milestone runs on GenLayer development chain 61997.

## Try it in the dApp

1. Open <https://orivexapp.vercel.app/#deploy>. The live task board appears above
   the existing evidence form. Select an available task and review its fixed
   criterion, issuer, required successful-task count and claim deadline.
2. Select **Connect wallet / check eligibility**. The app connects the wallet,
   switches to Studio Next if necessary, and reads eligibility from finalized
   contract state. An unmet credential requirement leaves claiming disabled.
3. For work you qualify for, select **Claim this task** and sign. Wait for
   finalized consensus, then select **Continue to evidence**. The fixed task ID
   is loaded into **Prove the work**; supply pinned evidence, hash it, and use
   **Submit and verify**. Only SUCCESS adds a credential for that issuer.
4. To create work, expand **Post an open task** and use the license task
   template or enter your own terms. A threshold of zero permits new agents;
   a threshold of one requires a prior SUCCESS from the chosen issuer. An empty
   issuer field defaults to the requester. Use the same issuer for onboarding
   tasks and later restricted work.
5. A requester can check eligibility with its own wallet to reveal **Cancel
   unclaimed task**. Once an agent claims, cancellation and reassignment are
   rejected. A saved pending transaction can be checked after reloading without
   sending another write. Inspect its explorer link if polling is interrupted.

The license template uses this pinned public document:
<https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/c64a1edb67b6e3f4a15cca8909c9482ad33a02b0/LICENSE>.
It proves what that license says; it does not prove an external agent action.

## Reproduce

```bash
npm ci
npm test
npm run genlayer:lint
npm run genlayer:test
npm run board:check
```

`board:check` uses no signer and sends no transactions. It re-fetches source,
proofs, evidence, credential counts and the recorded consensus receipts.
`npm run board:demo` explicitly creates a separate Studio Dev deployment and
runs a new write demonstration with ephemeral faucet accounts. Raw receipts and
transaction journals are stored in ignored `artifacts/`; account keys are never
saved. If the process is interrupted after sending, inspect the recorded hash
instead of blindly repeating that write. Rerunning the demo creates a new test
instance rather than resuming lost ephemeral signers.

## Verified milestone deployment

- Contract: [0xe9045A2ea5A5F43eB6677e2ae6b02E67E8b3B53a](https://explorer-studio-dev.genlayer.com/address/0xe9045A2ea5A5F43eB6677e2ae6b02E67E8b3B53a)
- [Transaction evidence](../deployments/task-board-studio-next.json): 18 FINALIZED
  transactions with majority agreement, including five expected contract errors.
- A SUCCESS proof increased the specified issuer/agent count to one and enabled
  a restricted claim. A FAILED proof left the count unchanged and could not
  satisfy a threshold of two. A duplicate claim, cancellation after claiming,
  an unqualified claim and claiming cancelled work were rejected.
- 64 frontend tests and 56 direct contract tests pass, including 28 new cases.
  Three existing deployment checks pass; GenVM lint/validation passes.
- Browser verification at 375, 768 and 1440 px found no board/form overflow or
  page errors. The example template populated the fixed task terms at each size.
