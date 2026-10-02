> Current reviewer path: [Studio Next 61997](STUDIO-NEXT.md), contract [0xE3B42ae4623D6f746a43487184C92834a3Ae85DC](https://explorer-studio-dev.genlayer.com/address/0xE3B42ae4623D6f746a43487184C92834a3Ae85DC), verified SUCCESS proof #1 and task credential #1. The StudioNet addresses and multi-example results below are historical (61999), not the current Lab. Use the current runbook for commands.

# Three-minute demo

## Before presenting

Run `npm run genlayer:check`, `npm run genlayer:publish`, and `npm run build`. Start the localhost server. Open `/#deploy`, load the examples and confirm the receipt exports open. Keep `docs/RESULTS.md` and the terminal ready. The saved receipts support inspection during an RPC outage; label them as saved results if the live check fails.

## Presentation

| Time | Screen and action | Explain |
| --- | --- | --- |
| 0:00–0:25 | Agent lab | Agents make claims. Consumers need evidence and a judgment they can inspect. |
| 0:25–0:55 | License Scout | The claim and criterion are visible. Open the commit-pinned license. Show its SHA-256. |
| 0:55–1:25 | Recheck onchain | Read the deployed source, finalized receipt and proof; reproduce the commitment. |
| 1:25–1:50 | Ownership Reviewer and Release Inspector | The same contract evaluates source behavior and release metadata through distinct local agent programs. |
| 1:50–2:20 | False Claim Control and Provenance Control | Explain refutation versus insufficient evidence. Show the actual receipt statuses. |
| 2:20–2:45 | Full receipt JSON and terminal | Show execution success, MAJORITY_AGREE, assigned votes, and the reproducible hash. Idle validators are not counted as agreeing. |
| 2:45–3:00 | Scope and next milestone | The shipped primitive is evidence judgment; authenticated agent identity and Base integration are future work. |

Do not wait for ten new transactions during a three-minute pitch. Use the completed examples, then run a live read check. For a longer technical session, run `npm run genlayer:examples` to demonstrate its resume behavior; existing references do not mint duplicate proofs.

## Questions to expect

**Where is the AI?** In the GenLayer intelligent contract's nondeterministic prompt evaluation. The local example agents are small deterministic programs that extract data and propose claims.

**Why not a centralized LLM?** Consumers can inspect the contract policy and network consensus receipt; the application does not get to stamp its own result. Model/provider correlations remain a limitation.

**Are the agents onchain identities?** No. Their claims, submitter address and judgments are onchain. Their names identify local example programs controlled by one operator.

**What does SUCCESS guarantee?** Agreement that the evidence supports the submitted claim under its criterion. It does not prove general competence, authentic authorship, audit completion or external causation.

**Can I change the document after verification?** A changed document will not reproduce the committed digest. Evidence is also pinned by source URL. Availability and factual authenticity are separate questions.

**Can I get a false claim approved?** Model errors and weak criteria remain possible. Controls demonstrate specific tested cases, not a universal soundness guarantee. Consumers need a reviewed policy and risk-appropriate evidence sources.

**Does it update reputation on Base?** No. The Base contracts remain a separate prototype and no bridge is configured.

**Is StudioNet a production blockchain?** It is GenLayer's hosted development environment. Transactions and consensus executions are real within that environment; the deployment is not a production release.

## Submission assets

- Project description and architecture: `docs/HACKATHON.md`.
- Reproducible deployment and outcomes: `docs/RESULTS.md`.
- Public proof exports: `public/genlayer-examples.json`, `public/genlayer-studionet.json`.
- Raw receipts: `public/receipts/`.
- Local demo: `http://127.0.0.1:5173/#deploy`.
- Reviewer guide served by the app: `/docs/guide.html`.

A public website URL, repository URL, team names and demo recording should be supplied when available. Localhost is accessible on the development machine only. No public hosting or hackathon submission has been performed by these scripts.
