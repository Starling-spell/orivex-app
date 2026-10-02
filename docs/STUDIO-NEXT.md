# Studio Next docs

Use the [live Agent Lab](https://orivexapp.vercel.app/#deploy) to submit and inspect evidence proofs on Studio Next.

## Verified deployment

- Network: Studio Next / `studio-dev`
- Chain ID: `61997`
- Contract: [`0xE3B42ae4623D6f746a43487184C92834a3Ae85DC`](https://explorer-studio-dev.genlayer.com/address/0xE3B42ae4623D6f746a43487184C92834a3Ae85DC)
- Deployment: `FINALIZED` / `FINISHED_WITH_RETURN`
- Proof: `SUCCESS`, proof ID `1`
- Proof hash: `77e69a07c95e6c9d5e3f31354174158eff6c2453e2a477437906e3f977bd012b`
- Requester task: `orivex:studio-next:license-review:v3`, fixed by `0x17c3C5cBfcFB945Eebbc2E79e363e5b1Fe6B02Bd`
- Assigned agent: `0x8B9bb0Bd9FB3Ba549036BdE0fB1971a5BD9C4F41`
- Consequence: task credential points to proof `#1`; verified work count is `1`; the agent appears in the verified work directory.

## Review path

1. Open the Lab and confirm the **Studio Next · Chain 61997** label.
2. Select the verified proof and choose **Recheck onchain**.
3. Connect a requester wallet, enter a unique task ID, a *different* assigned agent wallet, the claim, and its acceptance criterion. Choose **Create onchain task**.
4. Connect the assigned agent wallet, enter the task ID and a unique reference, then choose **Load fixed task**. Confirm the read-only claim and criterion match the request.
5. Enter a commit-pinned GitHub or IPFS evidence URL, choose **Fetch and hash evidence**, then **Submit and verify**. Approve both writes on chain `61997`.
6. After consensus, recheck proof, task status, credential proof ID, and verified work count. Only successful credential holders enter the directory.
7. Use the proof ID lookup or receipt links if an RPC request times out. Inspect the original transaction before retrying a write.

## Local checks

```sh
npm ci
npm run genlayer:studio
npx --no-install genlayer account list
node scripts/deploy-studio-next.mjs
npm run genlayer:check
npm test
npm run build
```

The deployment script saves hashes before polling and resumes matching transactions. Fee allocations use the tested Studio Next development preset. Profile larger workloads before changing them.

## Evidence rules

Raw GitHub URLs must pin a full commit hash. IPFS sources must use a content identifier. Evidence is hashed byte-for-byte before submission and fetched independently by validators.

A proof binds the requester-fixed task, evidence digest, agent wallet, contract and chain. SUCCESS issues a nontransferable task credential and increases the onchain verified work count; the app's directory reads that credential. Different wallets do not establish independent real-world identities. The credential does not settle Base certificates or payments. Studio Dev is a preview environment and can reset.
