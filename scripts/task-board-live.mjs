// Explicit Studio Dev write demo. New faucet-only accounts; keys stay in memory.
import { createAccount, createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';
import { getAddress } from 'viem';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

if (!process.argv.includes('--write-demo')) throw new Error('Use --write-demo to deploy and execute Studio Dev test transactions.');
const output = process.env.ORIVEX_BOARD_OUTPUT || `artifacts/task-board-${Date.now()}`;
await mkdir(output, { recursive: true });
const save = (name, value) => writeFile(`${output}/${name}.json`, JSON.stringify(value, (_, item) => typeof item === 'bigint' ? String(item) : item, 2) + '\n');
const sha = value => createHash('sha256').update(value).digest('hex');
const requesterAccount = createAccount(), agentAccount = createAccount(), strangerAccount = createAccount();
const requester = createClient({ chain: studioDevnet, account: requesterAccount });
const agent = createClient({ chain: studioDevnet, account: agentAccount });
const stranger = createClient({ chain: studioDevnet, account: strangerAccount });
assert.equal(Number(await requester.getChainId()), 61997);
for (const account of [requesterAccount, agentAccount, strangerAccount]) {
  await requester.request({ method: 'sim_fundAccount', params: [account.address, 10_000_000_000_000_000_000] });
}
const baseline = JSON.parse(await readFile('deployments/task-board-studio-next.json', 'utf8'));
const source = Buffer.from(await requester.getContractCode(baseline.address));
assert.equal(sha(source), baseline.sourceSha256);
const previous = JSON.parse(await readFile('deployments/genlayer-studio-next.json', 'utf8'));
assert.equal(previous.smoke.proof.schema_version, 3);
const fixture = previous.smoke.proof;
const response = await fetch(fixture.evidence_url, { signal: AbortSignal.timeout(30000) });
assert.equal(response.status, 200);
assert.equal(sha(Buffer.from(await response.arrayBuffer())), fixture.evidence_sha256);
const journal = { chainId: 61997, sourceSha256: sha(source), requester: requesterAccount.address,
  agent: agentAccount.address, stranger: strangerAccount.address, transactions: {} };
const receipts = {};
async function fees() {
  const quote = await requester.estimateTransactionFees({ leaderTimeunitsAllocation: 100n,
    validatorTimeunitsAllocation: 200n, rotations: [3n], appealRounds: 0n, totalMessageFees: 0n });
  assert.ok(quote.feeValue <= 110_000_000_000_000_000n, 'Unexpected protocol fee quote');
  return { distribution: quote.distribution, feeValue: quote.feeValue };
}
async function step(name, submit, expectedError) {
  const hash = await submit(); journal.transactions[name] = hash; await save('journal', journal);
  console.log(JSON.stringify({ step: name, hash }));
  let receipt;
  for (let retry = 0; retry < 6; retry++) {
    try { receipt = await requester.waitForTransactionReceipt({ hash, waitUntil: 'finalized', fullTransaction: true, retries: 120, interval: 3000 }); break; }
    catch { console.log(JSON.stringify({ step: name, pollingSameHash: retry + 1 })); }
  }
  assert.ok(receipt, `Inspect saved hash; never resubmit ambiguous ${name}`);
  await save(name, receipt);
  assert.equal(receipt.statusName, 'FINALIZED');
  assert.equal(receipt.leader_only, false);
  assert.equal(receipt.result_name, 'MAJORITY_AGREE');
  assert.equal(receipt.txExecutionResultName, expectedError ? 'FINISHED_WITH_ERROR' : 'FINISHED_WITH_RETURN');
  if (expectedError) {
    assert.ok(JSON.stringify(receipt.consensus_data?.leader_receipt?.map(item => ({ result: item.result, stderr: item.genvm_result?.stderr }))).includes(expectedError), `Wrong rejection: ${name}`);
  }
  receipts[name] = { hash, status: receipt.statusName, execution: receipt.txExecutionResultName,
    majority: receipt.result_name, leaderOnly: receipt.leader_only, sender: receipt.from_address,
    contract: receipt.to_address, ...(expectedError ? { expectedError } : {}) };
  console.log(JSON.stringify({ step: name, execution: receipt.txExecutionResultName }));
  return receipt;
}
const deployment = await step('deployment', async () => requester.deployContract({ code: new Uint8Array(source), args: [], leaderOnly: false, fees: await fees() }));
const address = getAddress(deployment.data?.contract_address ?? deployment.txDataDecoded?.contractAddress);
assert.equal(sha(await requester.getContractCode(address)), sha(source));
const read = (name, args = []) => requester.readContract({ address, functionName: name, args, transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
const record = async id => JSON.parse(String(await read('get_task', [id])));
const eligibility = async (id, wallet = agentAccount.address) => JSON.parse(String(await read('get_eligibility', [id, wallet])));
const write = async (signer, functionName, args) => signer.writeContract({ address, functionName, args, value: 0n, leaderOnly: false, fees: await fees() });
assert.equal(Number(await read('get_protocol_version')), 4);
const prefix = `orivex:board:${Date.now()}`;
const ids = { starter: `${prefix}:starter`, qualified: `${prefix}:qualified`, failed: `${prefix}:failed`, gated: `${prefix}:gated`, public: `${prefix}:public` };
const deadline = Math.floor(Date.now() / 1000) + 14 * 86400;
const post = (id, minimum) => write(requester, 'post_task', [id, fixture.claim, fixture.criterion, requesterAccount.address, minimum, deadline]);
await step('postQualified', () => post(ids.qualified, 1));
assert.equal((await eligibility(ids.qualified)).reason, 'CREDENTIAL_REQUIRED');
await step('rejectUnqualified', () => write(agent, 'claim_task', [ids.qualified]), 'CREDENTIAL_REQUIRED');
await step('postStarter', () => post(ids.starter, 0));
await step('claimStarter', () => write(agent, 'claim_task', [ids.starter]));
await step('submitStarter', () => write(agent, 'submit_proof', [ids.starter, `${prefix}:proof`, fixture.evidence_url, fixture.evidence_sha256]));
const proofId = Number(await read('get_proof_id', [agentAccount.address, `${prefix}:proof`]));
await step('verifyStarter', () => write(agent, 'verify_proof', [proofId]));
const proof = JSON.parse(String(await read('get_proof', [proofId])));
assert.equal(proof.status, 'SUCCESS');
assert.equal(Number(await read('get_issuer_verified_count', [requesterAccount.address, agentAccount.address])), 1);
assert.equal((await eligibility(ids.qualified)).eligible, true);
assert.equal((await eligibility(ids.qualified, strangerAccount.address)).eligible, false);
await step('claimQualified', () => write(agent, 'claim_task', [ids.qualified]));
await step('rejectReplay', () => write(stranger, 'claim_task', [ids.qualified]), 'NOT_AVAILABLE');
await step('rejectCancelClaimed', () => write(requester, 'cancel_task', [ids.qualified]), 'only unclaimed');
await step('createFailedTask', () => write(requester, 'create_task', [ids.failed, agentAccount.address,
  'The license forbids redistribution of the software.', 'SUCCESS only if the license explicitly forbids redistribution. FAILED if it explicitly grants permission to distribute the software.']));
await step('submitFailed', () => write(agent, 'submit_proof', [ids.failed, `${prefix}:failed-proof`, fixture.evidence_url, fixture.evidence_sha256]));
const failedId = Number(await read('get_proof_id', [agentAccount.address, `${prefix}:failed-proof`]));
await step('verifyFailed', () => write(agent, 'verify_proof', [failedId]));
const failedProof = JSON.parse(String(await read('get_proof', [failedId])));
assert.equal(failedProof.status, 'FAILED');
assert.equal(Number(await read('get_issuer_verified_count', [requesterAccount.address, agentAccount.address])), 1);
await step('postHigherGate', () => post(ids.gated, 2));
await step('rejectAfterFailedProof', () => write(agent, 'claim_task', [ids.gated]), 'CREDENTIAL_REQUIRED');
await step('cancelUnclaimed', () => write(requester, 'cancel_task', [ids.gated]));
await step('rejectCancelled', () => write(agent, 'claim_task', [ids.gated]), 'NOT_AVAILABLE');
await step('postPublicExample', () => post(ids.public, 0));
const tasks = await Promise.all(Object.values(ids).map(record));
const canonical = JSON.stringify(Object.fromEntries(Object.entries(proof).filter(([key]) => key !== 'proof_hash').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
assert.equal(sha(canonical), proof.proof_hash);
const report = { schemaVersion: 1, protocolVersion: 4, checkedAt: new Date().toISOString(), chainId: 61997,
  rpc: 'https://studio-dev.genlayer.com/api', address, sourceSha256: sha(source),
  requester: requesterAccount.address, agent: agentAccount.address, stranger: strangerAccount.address,
  tasks, proof, failedProof, issuerVerifiedCount: 1, transactions: receipts,
  scope: 'Credential-gated task assignment only. No payments or token rewards; distinct wallets do not prove independent owners.' };
await save('proof', report);
await mkdir('deployments/archive', { recursive: true });
await copyFile('deployments/genlayer-studio-next.json', 'deployments/archive/genlayer-studio-next-v3.json');
const manifest = { ...previous, protocolVersion: 4, address, deployer: requesterAccount.address,
  deploymentTx: journal.transactions.deployment, sourceSha256: sha(source), checkedAt: report.checkedAt,
  smoke: { status: proof.status, createTaskTx: journal.transactions.postStarter, submitTx: journal.transactions.submitStarter,
    verifyTx: journal.transactions.verifyStarter, proof, consensus: { votes: {} } } };
await writeFile('deployments/genlayer-studio-next.json', JSON.stringify(manifest, null, 2) + '\n');
await writeFile('public/genlayer-studio-next.json', JSON.stringify(manifest, null, 2) + '\n');
await writeFile('deployments/task-board-studio-next.json', JSON.stringify(report, null, 2) + '\n');
await writeFile('public/task-board-studio-next.json', JSON.stringify(report, null, 2) + '\n');
const examples = { chainId: 61997, address, examples: [{ id: 'board-failed', name: 'Failed work does not unlock access', capability: 'Credential eligibility', proofId: failedId,
  verifyTx: journal.transactions.verifyFailed, proof: failedProof, checkedAt: report.checkedAt, expected: 'FAILED' }] };
await writeFile('deployments/genlayer-next-examples.json', JSON.stringify(examples, null, 2) + '\n');
await writeFile('public/genlayer-next-examples.json', JSON.stringify(examples, null, 2) + '\n');
console.log(JSON.stringify({ address, transactions: Object.keys(receipts).length, proof: `${output}/proof.json` }));
