import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createAccount, createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';
import { getAddress } from 'viem';

const chainId = 61997;
const prior = JSON.parse(await readFile('deployments/task-board-studio-next.json', 'utf8'));
const normalizedSource = text => text.replaceAll('\r\n', '\n');
const source = normalizedSource(await readFile('contracts/OrivexProofRegistry.py', 'utf8'));
const sha = data => createHash('sha256').update(data).digest('hex');
const policy = prior.proof;
const reader = createClient({ chain: studioDevnet });
let stage = 'preflight';
let directory;
const read = (address, functionName, args = []) => reader.readContract({
  address, functionName, args, transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
});
const readJson = async (...args) => JSON.parse(String(await read(...args)));

async function indexed(readResult) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try { return await readResult(); } catch { await delay(1800); }
  }
  throw new Error('Finalized state read unavailable');
}

async function save(name, data) {
  await writeFile(`${directory}/${name}.json`, JSON.stringify(data, null, 2) + '\n');
}

function checkReceipt(receipt, expectedError) {
  assert.equal(receipt.statusName, 'FINALIZED');
  assert.equal(receipt.result_name, 'MAJORITY_AGREE');
  assert.equal(receipt.leader_only, false);
  assert.equal(receipt.txExecutionResultName, expectedError ? 'FINISHED_WITH_ERROR' : 'FINISHED_WITH_RETURN');
  if (expectedError) {
    assert.ok(receipt.consensus_data?.leader_receipt?.some(({ result, genvm_result }) =>
      JSON.stringify({ result, stderr: genvm_result?.stderr }).includes(expectedError)));
  }
}

async function demo() {
  const evidence = await fetch(policy.evidence_url, { signal: AbortSignal.timeout(20000) });
  assert.ok(evidence.ok);
  assert.equal(sha(Buffer.from(await evidence.arrayBuffer())), policy.evidence_sha256);
  await mkdir('artifacts', { recursive: true });
  directory = await mkdtemp('artifacts/portable-board-');
  console.log(JSON.stringify({ directory }));
  const requester = createAccount();
  const agent = createAccount();
  const publisher = createClient({ chain: studioDevnet, account: requester });
  const worker = createClient({ chain: studioDevnet, account: agent });
  stage = 'testnet faucet';
  for (const account of [requester, agent]) {
    await publisher.request({ method: 'sim_fundAccount', params: [account.address, 2_000_000_000_000_000_000] });
  }
  const transactions = {};
  async function step(name, actor, submit, expectedError) {
    stage = name;
    const quote = await actor.estimateTransactionFees({ leaderTimeunitsAllocation: 100n,
      validatorTimeunitsAllocation: 200n, rotations: [3n], appealRounds: 0n, totalMessageFees: 0n });
    assert.ok(quote.feeValue <= 110_000_000_000_000_000n);
    const hash = await submit({ distribution: quote.distribution, feeValue: quote.feeValue });
    transactions[name] = { hash, sender: actor.account.address, ...(expectedError ? { expectedError } : {}) };
    await save('transactions', transactions);
    console.log(JSON.stringify({ stage, hash }));
    const receipt = await reader.waitForTransactionReceipt({ hash, waitUntil: 'finalized', fullTransaction: true, retries: 120, interval: 3000 });
    checkReceipt(receipt, expectedError);
    Object.assign(transactions[name], { execution: receipt.txExecutionResultName, status: receipt.statusName, consensus: receipt.result_name });
    await save('transactions', transactions);
    console.log(JSON.stringify({ stage, execution: receipt.txExecutionResultName }));
    return receipt;
  }
  const write = (name, actor, address, functionName, args, expectedError) =>
    step(name, actor, fees => actor.writeContract({ address, functionName, args, fees, value: 0n, leaderOnly: false }), expectedError);
  const deployed = await step('deploy', publisher, fees => publisher.deployContract({
    code: Buffer.from(source), args: [], fees, leaderOnly: false,
  }));
  const address = getAddress(deployed.data?.contract_address ?? deployed.txDataDecoded?.contractAddress);
  await save('deployment', { address, sourceSha256: sha(source) });
  assert.equal(sha(await indexed(() => reader.getContractCode(address))), sha(source));
  assert.equal(Number(await read(address, 'get_protocol_version')), 5);
  assert.equal(getAddress(await read(address, 'get_portable_registry')), prior.address);

  const prefix = `orivex:portable:${Date.now()}`;
  const newTask = `${prefix}:offer`;
  const oldTask = `${prefix}:credential`;
  const deadline = Math.floor(Date.now() / 1000) + 30 * 86400 - 60;
  await write('postPortable', publisher, address, 'post_portable_task',
    [newTask, policy.claim, policy.criterion, requester.address, 1, deadline]);
  const before = await indexed(() => readJson(address, 'get_eligibility', [newTask, agent.address]));
  assert.equal(before.reason, 'CREDENTIAL_REQUIRED');
  await write('rejectBeforeCredential', worker, address, 'claim_task', [newTask], 'CREDENTIAL_REQUIRED');

  await write('createLegacyTask', publisher, prior.address, 'create_task', [oldTask, agent.address, policy.claim, policy.criterion]);
  await write('submitLegacyProof', worker, prior.address, 'submit_proof', [oldTask, oldTask, policy.evidence_url, policy.evidence_sha256]);
  const legacyProofId = Number(await indexed(() => read(prior.address, 'get_proof_id', [agent.address, oldTask])));
  await write('verifyLegacyProof', worker, prior.address, 'verify_proof', [legacyProofId]);
  const legacyProof = await readJson(prior.address, 'get_proof', [legacyProofId]);
  assert.equal(legacyProof.status, 'SUCCESS');
  assert.equal(Number(await read(address, 'get_issuer_verified_count', [requester.address, agent.address])), 0);
  const after = await readJson(address, 'get_eligibility', [newTask, agent.address]);
  assert.equal(after.eligible, true);
  assert.equal(after.verified_count, 1);
  assert.equal(getAddress(after.credential_registry), prior.address);
  await write('claimPortable', worker, address, 'claim_task', [newTask]);
  const claimed = await readJson(address, 'get_task', [newTask]);
  assert.equal(claimed.agent.toLowerCase(), agent.address.toLowerCase());
  assert.equal(claimed.qualifying_count, 1);
  await write('submitPortableProof', worker, address, 'submit_proof', [newTask, newTask, policy.evidence_url, policy.evidence_sha256]);
  const proofId = Number(await indexed(() => read(address, 'get_proof_id', [agent.address, newTask])));
  await write('verifyPortableProof', worker, address, 'verify_proof', [proofId]);
  const proof = await readJson(address, 'get_proof', [proofId]);
  assert.equal(proof.status, 'SUCCESS');
  assert.equal(getAddress(proof.credential_registry), prior.address);

  await save('proof', {
    chainId, protocolVersion: 5, address, sourceSha256: sha(source), legacyRegistry: prior.address,
    checkedAt: new Date().toISOString(), requester: requester.address, agent: agent.address,
    deploymentTx: transactions.deploy.hash, smoke: { proof, verifyTx: transactions.verifyPortableProof.hash },
    task: await readJson(address, 'get_task', [newTask]), before, after, legacyProof, transactions,
  });
  console.log(JSON.stringify({ stage: 'verified', directory, address, transactions: Object.keys(transactions).length }));
}

async function check(path) {
  stage = 'source and credential verification';
  const proof = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(proof.chainId, chainId);
  const deployedCode = await indexed(() => reader.getContractCode(proof.address));
  assert.equal(sha(deployedCode), proof.sourceSha256);
  assert.equal(normalizedSource(deployedCode), source);
  assert.equal(Number(await read(proof.address, 'get_protocol_version')), 5);
  assert.equal(getAddress(await read(proof.address, 'get_portable_registry')), prior.address);
  assert.deepEqual(await readJson(proof.address, 'get_task', [proof.task.task_id]), proof.task);
  const expected = proof.smoke.proof;
  assert.deepEqual(await readJson(proof.address, 'get_proof', [expected.proof_id]), expected);
  assert.deepEqual(await readJson(prior.address, 'get_proof', [proof.legacyProof.proof_id]), proof.legacyProof);
  for (const [address, record] of [[proof.address, expected], [prior.address, proof.legacyProof]]) {
    assert.equal(record.status, 'SUCCESS');
    assert.equal(Number(await read(address, 'get_credential', [record.submitter, record.task_id])), record.proof_id);
  }
  for (const [name, row] of Object.entries(proof.transactions)) {
    stage = name;
    const receipt = await indexed(() => reader.getTransaction({ hash: row.hash }));
    checkReceipt(receipt, row.expectedError);
    assert.equal(receipt.from_address.toLowerCase(), row.sender.toLowerCase());
    if (name !== 'deploy') {
      const target = name.endsWith('LegacyTask') || name.endsWith('LegacyProof') ? prior.address : proof.address;
      assert.equal(receipt.to_address.toLowerCase(), target.toLowerCase());
    }
  }
  console.log(JSON.stringify({ address: proof.address, transactions: Object.keys(proof.transactions).length, writes: 0 }));
}

console.error = () => {};
try {
  assert.equal(Number(await indexed(() => reader.getChainId())), chainId);
  assert.equal(sha(await indexed(() => reader.getContractCode(prior.address))), prior.sourceSha256);
  const [mode, path] = process.argv.slice(2);
  if (mode === '--write-demo') await demo();
  else if (mode === '--check') await check(path || 'deployments/portable-board-studio-next.json');
  else throw new Error('Pass --check or --write-demo');
} catch (error) {
  let root = error;
  for (let i = 0; i < 8 && root?.cause; i++) root = root.cause;
  console.log(JSON.stringify({ stage, directory, type: error.name, rpcCode: typeof root?.code === 'number' ? root.code : null }));
  process.exitCode = 1;
}
