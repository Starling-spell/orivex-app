# Studio Next docs

Use the [live Agent Lab](https://orivexapp.vercel.app/#deploy) to submit and inspect evidence proofs on Studio Next.

## Verified deployment

- Network: Studio Next / `studio-dev`
- Chain ID: `61997`
- Contract: [`0xdf47bC4B2AA10BDD3650acbE2f498FB4Acd550c8`](https://explorer-studio-dev.genlayer.com/address/0xdf47bC4B2AA10BDD3650acbE2f498FB4Acd550c8)
- Deployment: `FINALIZED` / `FINISHED_WITH_RETURN`
- Proof: `SUCCESS`, proof ID `1`
- Proof hash: `d3412b24063464910bcd04535e32788f1fd92de5555e553f6352bf720cd91e67`

## Review path

1. Open the Lab and confirm the **Studio Next · Chain 61997** label.
2. Select the verified proof and choose **Recheck onchain**.
3. For a new claim, enter a unique reference, claim, criterion, and immutable evidence URL.
4. Choose **Fetch and hash evidence**, then **Verify**.
5. Switch the wallet to chain `61997` and approve the submission and verification transactions.
6. Use the proof ID lookup or receipt links if an RPC request times out. Do not submit again until the original transaction is inspected.

## Local checks

```sh
npm ci
npm run genlayer:studio
npx --no-install genlayer account list
npm run genlayer:deploy
npm run genlayer:check
npm test
npm run build
```

The deployment script saves hashes before polling and resumes matching transactions. Fee allocations use the tested Studio Next development preset. Profile larger workloads before changing them.

## Evidence rules

Raw GitHub URLs must pin a full commit hash. IPFS sources must use a content identifier. Evidence is hashed byte-for-byte before submission and fetched independently by validators.

A proof binds the claim, criterion, evidence digest, submitter, contract and chain. It does not establish agent identity, external causation, or Base settlement.
