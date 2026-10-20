// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => ({ readContract: vi.fn(), writeContract: vi.fn(), waitForTransactionReceipt: vi.fn(), wallet: vi.fn() }));
vi.mock('genlayer-js', () => ({ createClient: () => rpc }));
vi.mock('./studio', () => ({ studioWalletWriter: rpc.wallet, studioFees: async () => ({ feeValue: 12n, distribution: {} }), txHash: (value: string) => value }));
import { TaskBoard, parseBoardPage } from './board';
const address = `0x${'aa'.repeat(20)}` as const;
const requester = `0x${'11'.repeat(20)}`;
const agent = `0x${'22'.repeat(20)}`;
const transaction = `0x${'bb'.repeat(32)}`;
const key = `orivex:board:61997:${address}:pending`;
let account: string;
let task: any;
let eligibility: any;
const receipt = () => ({ statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN',
  leader_only: false, result_name: 'MAJORITY_AGREE', to_address: address, from_address: account,
  consensus_data: { leader_receipt: [{ mode: 'leader', execution_result: 'SUCCESS' }] } });
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  account = agent;
  task = { task_id: 'board-1', claim: 'Review a license', criterion: 'Check distribution rights', requester,
    credential_issuer: requester, minimum_verified: 1, board_task: true, status: 'AVAILABLE', agent: '',
    claim_deadline: Math.floor(Date.now() / 1000) + 86400, proof_id: 0 };
  eligibility = { eligible: true, reason: 'ELIGIBLE', verified_count: 1, minimum_verified: 1 };
  rpc.wallet.mockImplementation(async () => ({ account, client: rpc }));
  rpc.readContract.mockImplementation(async ({ functionName }: any) => {
    if (functionName === 'get_protocol_version') return 4;
    if (functionName === 'list_board_tasks') return JSON.stringify({ total: 1, tasks: [task] });
    if (functionName === 'get_eligibility') return JSON.stringify(eligibility);
    throw new Error('RPC unavailable');
  });
  rpc.writeContract.mockImplementation(async ({ functionName }: any) => {
    if (functionName === 'claim_task') task = { ...task, agent: account, status: 'OPEN' };
    if (functionName === 'cancel_task') task = { ...task, status: 'CANCELLED' };
    return transaction;
  });
  rpc.waitForTransactionReceipt.mockImplementation(async () => receipt());
});
afterEach(cleanup);
async function open() {
  render(<TaskBoard address={address} onUseTask={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh task board' }).hasAttribute('disabled')).toBe(false));
}
async function check() {
  fireEvent.click(screen.getByRole('button', { name: 'Connect wallet / check eligibility' }));
  await waitFor(() => expect(screen.queryByText('Checking wallet…')).toBeNull());
}
it('does not allow claiming before fresh eligibility and reads finalized state', async () => {
  eligibility = { eligible: false, reason: 'CREDENTIAL_REQUIRED', verified_count: 0, minimum_verified: 1 };
  await open(); await check();
  expect(screen.getByRole('button', { name: 'Claim this task' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByText(/Complete more successful tasks/)).toBeTruthy();
  expect(rpc.writeContract).not.toHaveBeenCalled();
  for (const [call] of rpc.readContract.mock.calls) expect(call.transactionHashVariant).toBeDefined();
});
it('saves the hash before polling and never announces assignment before finality', async () => {
  let finish!: (value: unknown) => void;
  rpc.waitForTransactionReceipt.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await open(); await check();
  fireEvent.click(screen.getByRole('button', { name: 'Claim this task' }));
  await waitFor(() => expect(rpc.waitForTransactionReceipt).toHaveBeenCalledTimes(1));
  expect(JSON.parse(localStorage.getItem(key)!).hash).toBe(transaction);
  expect(screen.queryByText(/Assignment finalized/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Claiming task…' }).hasAttribute('disabled')).toBe(true);
  finish(receipt());
  await waitFor(() => expect(screen.getByText(/Assignment finalized/)).toBeTruthy());
  expect(localStorage.getItem(key)).toBeNull();
  expect(rpc.writeContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'claim_task', value: 0n, leaderOnly: false, fees: { feeValue: 12n, distribution: {} } }));
});
it('resumes the saved transaction after a reload without another wallet signature', async () => {
  localStorage.setItem(key, JSON.stringify({ hash: transaction, account: agent, action: 'claim_task', taskId: 'board-1' }));
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Check pending transaction' }));
  await waitFor(() => expect(screen.getByText(/Assignment finalized/)).toBeTruthy());
  expect(rpc.writeContract).not.toHaveBeenCalled(); expect(rpc.wallet).not.toHaveBeenCalled();
});
it('retains an ambiguous receipt and never resubmits', async () => {
  rpc.waitForTransactionReceipt.mockResolvedValue({ ...receipt(), to_address: requester });
  await open(); await check(); fireEvent.click(screen.getByRole('button', { name: 'Claim this task' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Receipt must have finalized'));
  expect(localStorage.getItem(key)).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check pending transaction' }));
  await waitFor(() => expect(rpc.waitForTransactionReceipt).toHaveBeenCalledTimes(2));
  expect(rpc.writeContract).toHaveBeenCalledTimes(1);
});
it('publishes a template with a fixed issuer, deadline, and protocol fees', async () => {
  account = requester; await open();
  fireEvent.click(screen.getByText('Post an open task'));
  fireEvent.click(screen.getByRole('button', { name: 'Use license task template' }));
  fireEvent.click(screen.getByRole('button', { name: 'Publish open task' }));
  await waitFor(() => expect(rpc.writeContract).toHaveBeenCalledTimes(1));
  const call = rpc.writeContract.mock.calls[0][0];
  expect(call.functionName).toBe('post_task'); expect(call.args[3]).toBe(requester);
  expect(call.args[4]).toBe(0); expect(call.args[5]).toBeGreaterThan(Date.now() / 1000);
});
it('recovers a wallet rejection without writing', async () => {
  rpc.wallet.mockRejectedValueOnce(new Error('Wallet request declined'));
  await open(); await check();
  expect(screen.getByRole('alert').textContent).toContain('declined');
  expect(screen.getByRole('button', { name: 'Connect wallet / check eligibility' }).hasAttribute('disabled')).toBe(false);
  expect(rpc.writeContract).not.toHaveBeenCalled();
});
it('does not turn an RPC failure into an empty board claim', async () => {
  rpc.readContract.mockRejectedValue(new Error('RPC unavailable'));
  render(<TaskBoard address={address} onUseTask={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('RPC unavailable'));
  expect(screen.queryByText(/No tasks posted yet/)).toBeNull();
});
it('rejects malformed board policy responses', () => {
  expect(() => parseBoardPage({ total: 1, tasks: [{ ...task, minimum_verified: -1 }] })).toThrow();
  expect(() => parseBoardPage({ total: 1, tasks: [{ ...task, requester: 'not-an-address' }] })).toThrow();
  expect(() => parseBoardPage({ total: 0, tasks: [task] })).toThrow();
});
