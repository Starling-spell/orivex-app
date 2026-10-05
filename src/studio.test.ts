import { expect, it } from 'vitest';
import { parseProofId, proofIdFromReceipt, studioError, txHash } from './studio';

it('reads the proof ID from a StudioNet submit receipt', () => {
  expect(proofIdFromReceipt({
    consensus_data: { leader_receipt: [{ mode: 'leader', result: { payload: { readable: '7' } } }] },
  })).toBe(7);
});

it('parses proof IDs from StudioNet return values', () => {
  expect(parseProofId(7)).toBe(7);
  expect(parseProofId('7')).toBe(7);
  expect(parseProofId('"7"')).toBe(7);
  expect(parseProofId(0)).toBeUndefined();
});

it('extracts a transaction hash from writeContract return values', () => {
  expect(txHash('0x' + 'ab'.repeat(32))).toMatch(/^0xab/i);
  expect(txHash({ hash: '0x' + 'cd'.repeat(32) })).toMatch(/^0xcd/i);
});

it('maps StudioNet errors without exposing RPC internals', () => {
  expect(studioError(new Error('[EXPECTED] reference already submitted'))).toContain('new reference');
  expect(studioError(new Error('User rejected the request'))).toContain('Wallet request declined');
  expect(studioError({ shortMessage: '0xdeadbeef' })).not.toContain('0xdeadbeef');
});

it('switches a StudioNet wallet to Studio Next before signing', async () => {
  const { ensureStudioNext } = await import('./studio');
  let chain = '0xf22f';
  const calls: string[] = [];
  await ensureStudioNext({request: async ({method,params}) => {
    calls.push(method);
    if(method === 'eth_chainId') return chain;
    if(method === 'wallet_switchEthereumChain') { chain = (params![0] as {chainId:string}).chainId; return null; }
    throw new Error('Unexpected wallet request');
  }});
  expect(chain).toBe('0xf22d');
  expect(calls).toContain('wallet_switchEthereumChain');
});

it('does not continue if the wallet stays on the old chain', async () => {
  const { ensureStudioNext } = await import('./studio');
  await expect(ensureStudioNext({request: async ({method}) => method === 'eth_chainId' ? '0xf22f' : null})).rejects.toThrow('61997');
});

it('includes both v0.6 fee fields from the live estimate', async () => {
  const { studioFees } = await import('./studio');
  const distribution = { test: 'distribution' };
  const fake = {estimateTransactionFees: async () => ({distribution,feeValue:123n})};
  expect(await studioFees(fake as any)).toEqual({distribution,feeValue:123n});
});

it('adds an unknown Studio Next network before switching', async () => {
  const { ensureStudioNext } = await import('./studio');
  let chain = '0x1'; let added = false; const calls: string[] = [];
  await ensureStudioNext({ request: async ({method, params}) => {
    calls.push(method);
    if (method === 'eth_chainId') return chain;
    if (method === 'wallet_addEthereumChain') { added = true; expect((params![0] as any).chainId).toBe('0xf22d'); return null; }
    if (method === 'wallet_switchEthereumChain') { if (!added) throw {code:4902}; chain = '0xf22d'; return null; }
  } });
  expect(calls).toEqual(['eth_chainId','wallet_switchEthereumChain','wallet_addEthereumChain','wallet_switchEthereumChain','eth_chainId']);
});

it('does not add a network after a user rejects switching', async () => {
  const { ensureStudioNext } = await import('./studio'); const methods: string[] = [];
  await expect(ensureStudioNext({ request: async ({method}) => {
    methods.push(method); if (method === 'eth_chainId') return '0x1'; throw new Error('4001 User rejected');
  } })).rejects.toThrow('4001');
  expect(methods).not.toContain('wallet_addEthereumChain');
});

it.each([null, {}, '0x123', {hash:'bad'}, {tx_id:'bad'}])('rejects an invalid transaction hash %j', value => {
  expect(() => txHash(value)).toThrow('transaction hash');
});

it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER+1, 'bad', undefined])('rejects an invalid proof ID %j', value => {
  expect(parseProofId(value)).toBeUndefined();
});
