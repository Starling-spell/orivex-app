// Read-only verifier: no signer, faucet calls or transaction writes.
import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const report = JSON.parse(await readFile('deployments/task-board-studio-next.json', 'utf8'));
const source = await readFile('contracts/OrivexProofRegistry.py');
const sha = value => createHash('sha256').update(value).digest('hex');
const client = createClient({ chain: studioDevnet });
const read = (functionName, args = []) => client.readContract({ address: report.address, functionName, args, transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
assert.equal(Number(await client.getChainId()), 61997);
assert.equal(sha(source), report.sourceSha256);
assert.equal(sha(await client.getContractCode(report.address)), report.sourceSha256);
assert.equal(Number(await read('get_protocol_version')), 4);
for (const expected of [report.proof, report.failedProof]) {
  const actual = JSON.parse(String(await read('get_proof', [expected.proof_id])));
  assert.deepEqual(actual, expected);
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(actual).filter(([key]) => key !== 'proof_hash').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  assert.equal(sha(canonical), actual.proof_hash);
  const response = await fetch(actual.evidence_url, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  assert.equal(sha(Buffer.from(await response.arrayBuffer())), actual.evidence_sha256);
  const credential = Number(await read('get_credential', [actual.submitter, actual.task_id]));
  assert.equal(credential, actual.status === 'SUCCESS' ? actual.proof_id : 0);
}
assert.equal(Number(await read('get_issuer_verified_count', [report.requester, report.agent])), report.issuerVerifiedCount);
const qualified = report.tasks.find(task => task.task_id.endsWith(':qualified'));
const current = JSON.parse(String(await read('get_task', [qualified.task_id])));
assert.equal(current.agent.toLowerCase(), report.agent.toLowerCase());
assert.equal(current.qualifying_count, 1);
assert.equal(current.status, 'OPEN');
const cancelled = report.tasks.find(task => task.task_id.endsWith(':gated'));
assert.equal(JSON.parse(String(await read('get_task', [cancelled.task_id]))).status, 'CANCELLED');
for (const [name, expected] of Object.entries(report.transactions)) {
  const receipt = await client.getTransaction({ hash: expected.hash });
  assert.equal(receipt.statusName, 'FINALIZED', name);
  assert.equal(receipt.txExecutionResultName, expected.execution, name);
  assert.equal(receipt.result_name, 'MAJORITY_AGREE', name);
  assert.equal(receipt.leader_only, false, name);
  assert.equal(receipt.from_address.toLowerCase(), expected.sender.toLowerCase(), name);
  if (name !== 'deployment') assert.equal(receipt.to_address.toLowerCase(), report.address.toLowerCase(), name);
  if (expected.expectedError) {
    assert.ok(JSON.stringify(receipt.consensus_data?.leader_receipt?.map(item => ({ result: item.result, stderr: item.genvm_result?.stderr }))).includes(expected.expectedError), name);
  }
}
console.log(JSON.stringify({ address: report.address, chainId: 61997, protocolVersion: 4,
  transactions: Object.keys(report.transactions).length, source: 'VERIFIED', credentialGate: 'VERIFIED', writes: 0 }));
