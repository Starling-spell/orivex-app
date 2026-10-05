// @vitest-environment jsdom
import { webcrypto, createHash } from 'node:crypto';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import manifest from '../deployments/genlayer-studio-next.json';
import { canonicalProof } from './proof';

const rpc = vi.hoisted(() => ({ readContract: vi.fn(), waitForTransactionReceipt: vi.fn(), writeContract: vi.fn(), wallet: vi.fn() }));
vi.mock('genlayer-js', () => ({ createClient: () => rpc }));
vi.mock('./studio', async importOriginal => {
  const original = await importOriginal<typeof import('./studio')>();
  return { ...original, studioWalletWriter: rpc.wallet, studioFees: async () => ({ distribution: { test: true }, feeValue: 123n }),
    waitUntil: (label: string, attempt: () => Promise<unknown>) => original.waitUntil(label, attempt, 3, 0) };
});
let AgentLab: typeof import('./genlayer')['AgentLab'];
const requester = '0x' + '11'.repeat(20);
const agent = '0x' + '22'.repeat(20);
const submitTx = '0x' + 'aa'.repeat(32);
const verifyTx = '0x' + 'bb'.repeat(32);
let task: any;
let proof: any;
let outcome = 'SUCCESS';
let account = requester;
const receipt = () => ({ statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN',
  leader_only: false, result_name: 'MAJORITY_AGREE', to_address: manifest.address, from_address: account,
  consensus_data: { leader_receipt: [{ mode: 'leader', execution_result: 'SUCCESS' }] } });
beforeAll(async () => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  Element.prototype.scrollIntoView = vi.fn();
  AgentLab = (await import('./genlayer')).AgentLab;
});
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); task = undefined; proof = undefined; outcome = 'SUCCESS'; account = requester;
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ address: manifest.address, chainId: 61997, examples: [] }) })));
  rpc.wallet.mockImplementation(async () => ({ account, client: rpc }));
  rpc.readContract.mockImplementation(async ({ functionName }: any) => {
    if (functionName === 'total_proofs') return 0;
    if (functionName === 'get_task') return JSON.stringify(task);
    if (functionName === 'get_proof_id') return 2;
    if (functionName === 'get_proof') return JSON.stringify(proof);
    if (functionName === 'get_credential' || functionName === 'get_verified_count') return outcome === 'SUCCESS' ? (functionName === 'get_credential' ? 2 : 1) : 0;
    throw new Error('Unexpected read');
  });
  rpc.writeContract.mockImplementation(async ({ functionName, args }: any) => {
    if (functionName === 'create_task') {
      task = { task_id: args[0], agent: args[1], claim: args[2], criterion: args[3], requester, status: 'OPEN', proof_id: 0 };
      return submitTx;
    }
    if (functionName === 'submit_proof') {
      task = { ...task, status: 'SUBMITTED', proof_id: 2 };
      proof = { ...manifest.smoke.proof, requester, submitter: agent, task_id: task.task_id, proof_id: 2,
        claim: task.claim, criterion: task.criterion, reference_id: args[1], status: outcome };
      proof.proof_hash = createHash('sha256').update(canonicalProof(proof)).digest('hex');
      return submitTx;
    }
    if (functionName === 'verify_proof') return verifyTx;
    throw new Error('Unexpected write');
  });
  rpc.waitForTransactionReceipt.mockImplementation(async () => receipt());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function prepareTask() {
  render(<AgentLab />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Load agent examples' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
  fireEvent.change(screen.getByLabelText('Assigned agent wallet'), { target: { value: agent } });
  fireEvent.click(screen.getByRole('button', { name: 'Create onchain task' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit and verify' }).hasAttribute('disabled')).toBe(false));
  account = agent;
}
it.each(['SUCCESS', 'FAILED', 'INCONCLUSIVE'])('completes both consensus transactions for %s with fees and the correct credential', async status => {
  outcome = status; await prepareTask();
  fireEvent.click(screen.getByRole('button', { name: 'Submit and verify' }));
  await waitFor(() => expect(document.querySelector('#lab-result')?.textContent).toContain(status === 'SUCCESS' ? 'Issued · proof #2' : 'Not issued'));
  expect(rpc.writeContract.mock.calls.map(([call]) => call.functionName)).toEqual(['create_task', 'submit_proof', 'verify_proof']);
  for (const [call] of rpc.writeContract.mock.calls) expect(call.fees).toEqual({ distribution: { test: true }, feeValue: 123n });
  expect(localStorage.length).toBe(0);
  expect(screen.getByRole('button', { name: 'Submit and verify' }).hasAttribute('disabled')).toBe(true);
});
it('retries a declined verification without submitting the same proof twice', async () => {
  await prepareTask(); const write = rpc.writeContract.getMockImplementation()!;
  let declined = false;
  rpc.writeContract.mockImplementation(async call => {
    if (call.functionName === 'verify_proof' && !declined) { declined = true; throw new Error('User rejected request'); }
    return write(call);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Submit and verify' }));
  await waitFor(() => expect(screen.getAllByRole('alert')[0].textContent).toContain('Wallet request declined'));
  fireEvent.click(screen.getByRole('button', { name: 'Submit and verify' }));
  await waitFor(() => expect(document.querySelector('#lab-result')?.textContent).toContain('Issued · proof #2'));
  expect(rpc.writeContract.mock.calls.filter(([call]) => call.functionName === 'submit_proof')).toHaveLength(1);
});
it('does not request verification after an unsuccessful submit receipt', async () => {
  await prepareTask(); rpc.waitForTransactionReceipt.mockResolvedValue({ ...receipt(), txExecutionResultName: 'ERROR' });
  fireEvent.click(screen.getByRole('button', { name: 'Submit and verify' }));
  await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
  expect(rpc.writeContract.mock.calls.map(([call]) => call.functionName)).toEqual(['create_task', 'submit_proof']);
  expect(document.querySelector('#lab-result')?.textContent).not.toContain('Issued · proof #2');
});
it('blocks the requester from submitting the assigned agent’s evidence', async () => {
  await prepareTask(); account = requester;
  fireEvent.click(screen.getByRole('button', { name: 'Submit and verify' }));
  await waitFor(() => expect(screen.getAllByRole('alert')[0].textContent).toContain('assigned agent wallet'));
  expect(rpc.writeContract).toHaveBeenCalledTimes(1);
});
it('blocks a malformed digest before asking for a signature', async () => {
  await prepareTask(); fireEvent.change(screen.getByLabelText('Evidence SHA-256'), { target: { value: 'invalid' } });
  expect(screen.getByRole('button', { name: 'Submit and verify' }).hasAttribute('disabled')).toBe(true);
  expect(rpc.writeContract).toHaveBeenCalledTimes(1);
});
it('keeps templates disabled during an evidence fetch and reports HTTP failure', async () => {
  await prepareTask(); let complete!: (value: any) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Fetch and hash evidence' }));
  expect(screen.getByRole('button', { name: 'Use template' }).hasAttribute('disabled')).toBe(true);
  complete({ ok: false, status: 404 });
  await waitFor(() => expect(screen.getAllByRole('alert')[0].textContent).toContain('HTTP 404'));
  expect(screen.getByRole('button', { name: 'Use template' }).hasAttribute('disabled')).toBe(false);
  expect(rpc.writeContract).toHaveBeenCalledTimes(1);
});

it('does not present a forged commitment as a verified credential', async () => {
  await prepareTask(); const read = rpc.readContract.getMockImplementation()!;
  rpc.readContract.mockImplementation(async call => call.functionName === 'get_proof'
    ? JSON.stringify({ ...proof, proof_hash: 'a'.repeat(64) }) : read(call));
  fireEvent.click(screen.getByRole('button', { name: 'Submit and verify' }));
  await waitFor(() => expect(screen.getAllByRole('alert')[0].textContent).toContain('validators have not finalized'));
  expect(document.querySelector('#lab-result')?.textContent).not.toContain('Issued · proof #2');
  expect(localStorage.length).toBe(1);
  rpc.readContract.mockImplementation(read);
  fireEvent.click(screen.getByRole('button', { name: 'Submit and verify' }));
  await waitFor(() => expect(document.querySelector('#lab-result')?.textContent).toContain('Issued · proof #2'));
  expect(rpc.writeContract.mock.calls.filter(([call]) => call.functionName === 'verify_proof')).toHaveLength(1);
});

it('continues when browser storage is unavailable', async () => {
  await prepareTask(); const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Submit and verify' }));
    await waitFor(() => expect(document.querySelector('#lab-result')?.textContent).toContain('Issued · proof #2'));
  } finally { storage.mockRestore(); }
});

it('allows consensus finalization beyond the SDK default thirty-second wait', async () => {
  rpc.waitForTransactionReceipt.mockImplementation(async options => {
    const deadline = (options.retries ?? 10) * (options.interval ?? 3000);
    if (deadline < 60000) throw new Error('Timed out waiting for transaction finalization');
    return receipt();
  });
  await prepareTask();
  fireEvent.click(screen.getByRole('button', { name:'Submit and verify' }));
  await waitFor(() => expect(document.querySelector('#lab-result')?.textContent).toContain('Issued · proof #2'));
});

it('blocks self-assignment before creating a task', async () => {
  render(<AgentLab />); fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
  fireEvent.change(screen.getByLabelText('Assigned agent wallet'), { target: { value: requester } });
  fireEvent.click(screen.getByRole('button', { name: 'Create onchain task' }));
  await waitFor(() => expect(screen.getAllByRole('alert')[0].textContent).toContain('different wallet'));
  expect(rpc.writeContract).not.toHaveBeenCalled();
});
