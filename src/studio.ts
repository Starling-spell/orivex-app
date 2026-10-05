import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import type { Hash } from 'genlayer-js/types';

type EthereumProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
type WalletHandle = { address: string; provider: EthereumProvider };

declare global {
  interface Window {
    ethereum?: EthereumProvider;
    __orivexGetWallet?: () => Promise<WalletHandle>;
  }
}

export async function studioWalletWriter() {
  const hooked = typeof window !== 'undefined' ? window.__orivexGetWallet : undefined;
  let handle: WalletHandle | undefined;
  if (hooked) handle = await hooked();
  if (!handle) {
    const provider = typeof window !== 'undefined' ? window.ethereum : undefined;
    if (!provider?.request) throw new Error('Connect a wallet first, then click Verify.');
    const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
    if (!accounts?.[0]) throw new Error('Connect a wallet first, then click Verify.');
    handle = { address: accounts[0], provider };
  }
  const client = createClient({ chain: studioDevnet, account: handle.address as `0x${string}`, provider: handle.provider });
  await ensureStudioNext(handle.provider);
  if (Number(await client.getChainId()) !== 61997) throw new Error('Studio Next RPC returned the wrong chain.');
  return { account: handle.address, client };
}

export function txHash(value: unknown): Hash {
  const hash = typeof value === 'string' ? value
    : value && typeof value === 'object' && 'hash' in value ? String((value as { hash: unknown }).hash)
    : value && typeof value === 'object' && 'tx_id' in value ? String((value as { tx_id: unknown }).tx_id)
    : '';
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Studio Next did not return a transaction hash.');
  return hash as Hash;
}

export function proofIdFromReceipt(receipt: unknown): number {
  const data = receipt as { consensus_data?: { leader_receipt?: { mode?: string; result?: { payload?: { readable?: string } } | string }[] } };
  const leaders = data.consensus_data?.leader_receipt ?? [];
  const leader = leaders.find(item => item.mode === 'leader') ?? leaders[0];
  const readable = typeof leader?.result === 'string' ? leader.result : leader?.result?.payload?.readable;
  const id = parseProofId(readable);
  if (!id) throw new Error('Submit receipt did not return a proof ID.');
  return id;
}

export function parseProofRecord(value: unknown): { status: string; proof_hash: string; reference_id: string; [key: string]: unknown } | undefined {
  const record = typeof value === 'object' && value && 'status' in value ? value as { status: string; proof_hash?: string; reference_id?: string }
    : (() => { try { return JSON.parse(String(value)); } catch { return undefined; } })();
  if (!record || typeof record !== 'object') return undefined;
  return record;
}

export function parseProofId(value: unknown): number | undefined {
  if (typeof value === 'bigint') {
    const id = Number(value);
    return Number.isSafeInteger(id) && id >= 1 ? id : undefined;
  }
  const text = String(value ?? '').replace(/["']/g, '').trim();
  const id = Number(text);
  return Number.isSafeInteger(id) && id >= 1 ? id : undefined;
}

export async function waitUntil<T>(label: string, attempt: () => Promise<T | undefined>, retries = 60, intervalMs = 3000): Promise<T> {
  let lastError: unknown;
  for (let attemptIndex = 0; attemptIndex < retries; attemptIndex++) {
    try {
      const value = await attempt();
      if (value !== undefined) return value;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  if (lastError instanceof Error && /timed out|proof ID|consensus/i.test(lastError.message)) throw lastError;
  throw new Error(label);
}

export function studioError(error: unknown): string {
  const text = error instanceof Error ? `${error.message} ${error.cause ?? ''}` : String(error);
  if (/reference already submitted/i.test(text)) return 'This reference ID was already submitted from this Studio Next account. Use a new reference.';
  if (/evidence URL|allowlisted|pin a commit|canonical/i.test(text)) return 'Evidence URL must be HTTPS with a pinned GitHub commit or an IPFS CID.';
  if (/429|32429|rate/i.test(text)) return 'Studio Next rate limit hit. Wait a minute, then verify again.';
  if (/32028|in-flight/i.test(text)) return 'Too many pending Studio Next transactions. Wait for the previous proof to finish.';
  if (/Timed out waiting for Studio Next to assign a proof ID/i.test(text)) return 'Studio Next accepted the wallet transaction but has not assigned a proof ID yet. Wait a few seconds and look the proof up, and inspect the saved transaction; do not submit a duplicate.';
  if (/Timed out waiting for validator consensus/i.test(text)) return 'The verify transaction was sent, but validators have not finalized a judgment yet. Look the proof up by ID in a minute.';
  if (/did not return a (transaction hash|proof ID)/i.test(text)) return text;
  if (/different wallet for the requester and agent|assigned agent wallet|Wallet must be on Studio Next|RPC returned the wrong chain/i.test(text)) return text;
  if (/Connect a wallet/i.test(text)) return 'Connect a wallet first, then click Verify.';
  if (/4001|UserRejected|denied|rejected/i.test(text)) return 'Wallet request declined. Approve the Studio Next transaction to verify.';
  return 'Studio Next could not finish verification. Check the evidence URL and try again.';
}

export async function ensureStudioNext(provider: EthereumProvider) {
  const chainId = '0xf22d';
  if (Number(await provider.request({ method:'eth_chainId' })) !== 61997) {
    try { await provider.request({ method:'wallet_switchEthereumChain', params:[{chainId}] }); }
    catch (error) {
      if ((error as {code?:number}).code !== 4902) throw error;
      await provider.request({ method:'wallet_addEthereumChain', params:[{chainId,chainName:'GenLayer Studio Next',nativeCurrency:{name:'GEN',symbol:'GEN',decimals:18},rpcUrls:['https://studio-dev.genlayer.com/api'],blockExplorerUrls:['https://explorer-studio-dev.genlayer.com']}] });
      await provider.request({ method:'wallet_switchEthereumChain', params:[{chainId}] });
    }
  }
  if (Number(await provider.request({ method:'eth_chainId' })) !== 61997) throw new Error('Wallet must be on Studio Next (61997).');
}

export async function studioFees(client: ReturnType<typeof createClient>) {
  const quote = await client.estimateTransactionFees({leaderTimeunitsAllocation:100n,validatorTimeunitsAllocation:200n,rotations:[3n],appealRounds:0n,totalMessageFees:0n});
  return {distribution:quote.distribution,feeValue:quote.feeValue};
}
