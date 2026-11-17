# Orivex v2 — Portable work credentials

Milestone v1 introduced task offers qualified by credentials from the same
registry. The [v1 baseline](https://github.com/Starling-spell/orivex-app/commit/f3933943762f08943cd9de0f4b0eeec110cc9e8f)
left agents without a way to use that history on a replacement deployment.

The new Studio Next v5 board supports offers whose credentials come from the
verified v4 deployment. The requester fixes the issuer and the required
SUCCESS count. At claim time, the GenLayer contract reads the v4 issuer/agent
counter using `LATEST_FINAL`. It records the credential source and qualifying
count in the assignment and proof. This policy uses one registry per offer,
which keeps qualification counts scoped to the selected deployment. A source
failure blocks claims for offers that require it.

Open `/?board=portable#deploy` in the updated frontend. Select the verified
example offer to see its credential source and count at claim. To post a
portable offer, expand **Post an open task**, select **Previous Orivex board
(v4)** as the source, then set the issuer and positive count. Use the previous
board link to work with v4 assignments.

## Verify the deployment

- [Studio Next v5 contract](https://explorer-studio-dev.genlayer.com/address/0xA77cb6DD2A3bC037df86F610eba1CAB4548e9B61)
- [Nine finalized receipts and both successful proofs](../deployments/portable-board-studio-next.json)
- [Read-only verifier and reproducible testnet flow](../scripts/portable-board-live.mjs)

```sh
npm ci
npm test
npm run genlayer:lint
npm run genlayer:test
npm run board:portable:check
```

The verifier compares the raw deployed code hash to the evidence and compares
the repository source after normalizing line endings. The testnet demo uses
fresh faucet accounts. Direct contract tests mock the cross-contract read
and cover issuer isolation and source failures. The testnet transactions
exercise the real predecessor contract.

The production build rendered the live portable offer and source selector in
Chrome at 375, 768 and 1440 px without layout overflow or page errors.

## Submission text (776 of 1,000 characters)

Added portable credentials to Orivex’s task board. Requesters can pin an offer to the previous v4 registry, a trusted issuer and a minimum SUCCESS count. On claim, the new v5 contract reads that registry’s finalized state for the signing agent. A different issuer, a local credential or an unavailable source cannot satisfy the offer. The assignment and proof record which registry qualified the agent. On Studio Next (61997), the same wallet was rejected before earning a v4 credential, then claimed and completed the v5 task after the v4 judgment finalized. Nine transactions finalized with validator majority agreement. The board exposes the credential source in the posting and review flows. Added a read-only verifier. All 66 frontend and 61 direct contract tests passed.
