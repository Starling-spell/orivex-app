# Orivex App

Frontend MVP for **Proof of Intelligent Action**. The landing page uses a Vite/React GenLayer StudioNet agent lab. Open it through the development server, not directly from disk.

## Included

- Responsive landing page with Orivex brand system
- GenLayer StudioNet proof registry for independently verified, content-addressed evidence
- Agent registry with search and trust metadata
- Evidence submission flow with pending states
- Certificate preview and deterministic verification language
- Reputation score and live trust graph visualization
- Developer API example and register-agent modal
- Privy wallet/email authentication, embedded wallets, wallet selection and logout
- GenLayer StudioNet agent verification with finalized consensus receipts
- Atomic deployment of all four protocol contracts from the connected wallet

## Run

```bash
npm ci
npm run contracts:build
npm run dev
```

## Privy configuration

Copy `.env.example` to `.env.local` only if `.env.local` does not already exist. Set `VITE_PRIVY_APP_ID` to the public ID from the [Privy dashboard](https://dashboard.privy.io). No Privy app secret belongs in the frontend.

Enable Ethereum wallets and email login in Privy. Add `http://127.0.0.1:5173`, `http://localhost:5173`, and your published HTTPS origin to its allowed origins. The SDK uses the dark theme and only supports Base Sepolia. The supplied public App ID is already configured locally.

## Deploy on Base Sepolia

Use a fresh wallet with Base Sepolia test ETH. Never reuse a wallet whose private key was shared in chat. [Base network reference](https://docs.base.org/base-chain/api-reference/rpc-overview).

1. Start the app and open `http://127.0.0.1:5173/#deploy`.
2. Connect through Privy and switch to Base Sepolia.
3. Select **Review deployment**. Check the owner and estimated execution gas; the wallet supplies the final network fee including Base data costs.
4. Select **Deploy protocol** and sign in the wallet. The transaction deploys `AgentRegistry`, `ActionCertificate`, `ReputationRegistry`, and `AgentPermission` atomically.
5. After two confirmations, the page shows explorer links and enables registration. The confirmed deployment is remembered for that wallet in this browser and revalidated against onchain bytecode when reopened.
6. Set the resulting addresses in `.env.local` (or hosting environment variables), then rebuild to share the same deployment with all visitors. `VITE_AGENT_REGISTRY_ADDRESS` enables registration for everyone.

For CLI deployment with an encrypted Foundry keystore:

```powershell
$env:DEPLOYER_ADDRESS = 'YOUR_PUBLIC_WALLET_ADDRESS'
npm run deploy:base-sepolia -- --account your-keystore-name
npm run deploy:base-sepolia -- --account your-keystore-name --broadcast
```

The first command estimates gas without sending. The broadcast command prompts through Foundry for the keystore password, verifies the owner and receipt, saves `deployments/base-sepolia.json`, and updates public addresses in `.env.local`. No private key is read by the application or passed as a command argument.

## GenLayer Studio Next proofs

The Agent Lab reads and writes on **chain 61997**, using the canonical studio-dev RPC and preview SDK. Contract: [0xE3B42ae4623D6f746a43487184C92834a3Ae85DC](https://explorer-studio-dev.genlayer.com/address/0xE3B42ae4623D6f746a43487184C92834a3Ae85DC). A requester wallet fixed the task's claim and criterion before a different agent wallet submitted pinned evidence. GenLayer validators returned **SUCCESS**, issued task credential #1 and incremented the agent's verified work count. The app's verified work directory reads that credential.

See [the current runbook and proof](docs/STUDIO-NEXT.md), [deployment manifest](deployments/genlayer-studio-next.json), and [live Lab](https://orivexapp.vercel.app/#deploy).

The old StudioNet 61999 manifests and examples are historical only; they are not loaded by the current Lab. The protocol-fee estimate is included in every Studio Next write. Separate wallets do not establish independent real-world identities. GenLayer task credentials do not settle Base certificates or payments.

## Build and checks

```bash
npm run contracts:test
npm test
npm run build
npm run preview
```

The Solidity tests cover access control, replay prevention, locked evidence, capability reputation, cumulative permission budgets, expiry, revocation and testnet-only deployment. The build exports ABIs and deployment bytecode from Solidity 0.8.24 and pinned OpenZeppelin 5.4.0 sources. Foundry is provided as a development dependency; a standard Foundry installation also works.

## Hosting

Import this directory into Vercel and set the `VITE_*` public configuration values. `vercel.json` builds the Vite app and serves `dist`. Add the resulting HTTPS domain to Privy’s allowed origins. The website is hosted separately from the contracts on Base Sepolia.

## Current limits

Agent listings, metrics, trust graph and certificates are labeled demonstration data. The GenLayer bridge, backend API and database are not connected. No verification result is generated by the wallet integration. `VALIDATOR_ROLE` and `VERIFIER_ROLE` stay unassigned at deployment; admin status alone cannot finalize a certificate. Grant them only to a reviewed consensus bridge. The permission contract tracks a budget but cannot constrain purchases that bypass it. These contracts do not custody USDC or charge a registration fee. This remains a testnet MVP, not an audited production protocol.
