// @vitest-environment jsdom
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const sdk = vi.hoisted(() => ({
  auth: { ready: true, authenticated: false, user: null as any, login: vi.fn(), logout: vi.fn(), connectWallet: vi.fn() },
  walletState: { ready: false, wallets: [] as any[] },
}));
vi.mock('@privy-io/react-auth', () => ({
  PrivyProvider: ({children}: any) => children, usePrivy: () => sdk.auth, useWallets: () => sdk.walletState,
}));
let WalletApp: typeof import('./wallet')['WalletApp'];
beforeAll(async () => {
  document.body.innerHTML = '<div id="wallet-slot"></div><div id="register-form"></div><div id="deployment-slot"></div><div id="wallet-root"></div>';
  WalletApp = (await import('./wallet')).WalletApp;
});
beforeEach(() => {
  sdk.auth.authenticated = false; sdk.auth.ready = true; sdk.auth.user = null;
  sdk.walletState.wallets = []; sdk.walletState.ready = false;
  localStorage.clear(); vi.clearAllMocks();
});
afterEach(cleanup);

it('opens Privy login without waiting for an unauthenticated embedded wallet', () => {
  render(<WalletApp />);
  fireEvent.click(screen.getAllByRole('button', {name: 'Connect wallet'})[0]);
  expect(sdk.auth.login).toHaveBeenCalledOnce();
  expect(screen.queryByText(/0x8293/)).toBeNull();
});
it('waits for Privy initialization before allowing login', () => {
  sdk.auth.ready = false;
  render(<WalletApp />);
  expect((screen.getByRole('button', {name: 'Loading wallet…'}) as HTMLButtonElement).disabled).toBe(true);
});
it('allows switching networks before the registration form is filled', async () => {
  const switchChain = vi.fn().mockResolvedValue(undefined);
  sdk.auth.authenticated = true;
  sdk.walletState.ready = true;
  sdk.walletState.wallets = [{ address: '0x1111111111111111111111111111111111111111', chainId: 'eip155:8453', walletClientType: 'metamask', switchChain }];
  render(<WalletApp />);
  fireEvent.submit(document.querySelector('#register-form form')!);
  await waitFor(() => expect(switchChain).toHaveBeenCalledWith(84532));
  expect((document.querySelector('#register-form form') as HTMLFormElement).noValidate).toBe(true);
});
it('blocks registration when no contract is deployed', () => {
  sdk.auth.authenticated = true;
  sdk.walletState.ready = true;
  sdk.walletState.wallets = [{ address: '0x1111111111111111111111111111111111111111', chainId: 'eip155:84532', walletClientType: 'metamask' }];
  render(<WalletApp />);
  expect((screen.getByRole('button', {name: 'Register agent'}) as HTMLButtonElement).disabled).toBe(true);
});

it('requires login before exposing a signing provider', async () => {
  render(<WalletApp />);
  await expect(window.__orivexGetWallet!()).rejects.toThrow('Connect a wallet first');
  expect(sdk.auth.login).toHaveBeenCalledOnce();
});

it('asks an authenticated user without a wallet to connect one', async () => {
  sdk.auth.authenticated = true; sdk.walletState.ready = true;
  render(<WalletApp />);
  await expect(window.__orivexGetWallet!()).rejects.toThrow('Connect a wallet first');
  expect(sdk.auth.connectWallet).toHaveBeenCalledOnce();
  expect(sdk.auth.login).not.toHaveBeenCalled();
});

it('removes signing access after logout', async () => {
  const provider = { request: vi.fn() };
  sdk.auth.authenticated = true; sdk.walletState.ready = true;
  sdk.walletState.wallets = [{ address:'0x1111111111111111111111111111111111111111', chainId:'eip155:61997',
    walletClientType:'metamask', getEthereumProvider:vi.fn().mockResolvedValue(provider) }];
  const view = render(<WalletApp />);
  expect((await window.__orivexGetWallet!()).provider).toBe(provider);
  sdk.auth.authenticated = false; view.rerender(<WalletApp />);
  await expect(window.__orivexGetWallet!()).rejects.toThrow('Connect a wallet first');
  expect(provider.request).not.toHaveBeenCalled();
});
