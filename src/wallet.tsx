import { Component, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';
import { studioDevnet } from 'genlayer-js/chains';
import { createWalletClient, custom, decodeEventLog, encodeDeployData, formatEther, getAddress, parseAbiItem, type Address, type Hash, type TransactionReceipt } from 'viem';
import registryArtifact from '../artifacts/AgentRegistry.json';
import deploymentArtifact from '../artifacts/OrivexDeployment.json';
import { appId, chain, normalizeMetadata, publicClient, registryAddress, walletError } from './chain';
import './wallet.css';

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const explorer = chain.blockExplorers.default.url;
const registeredEvent = parseAbiItem('event AgentRegistered(uint256 indexed agentId, address indexed owner, string metadataURI)');
const deployedEvent = parseAbiItem('event ProtocolDeployed(address indexed admin, address registry, address certificates, address reputation, address permissions)');
const headerSlot = document.getElementById('wallet-slot')!;
const formSlot = document.getElementById('register-form')!;
const deploySlot = document.getElementById('deployment-slot')!;
headerSlot.replaceChildren();

function useTransaction(storageKey: string, onConfirmed: (receipt: TransactionReceipt) => Promise<void>) {
  const [hash, setHash] = useState<Hash>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<TransactionReceipt>();
  const [retry, setRetry] = useState(0);
  const [checking, setChecking] = useState(false);
  const lock = useRef(false);
  const scope = useRef(storageKey);
  scope.current = storageKey;
  const callback = useRef(onConfirmed);
  callback.current = onConfirmed;
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(storageKey); } catch { /* Private browsing may disable storage. */ }
    setHash(saved && /^0x[0-9a-f]{64}$/i.test(saved) ? saved as Hash : undefined);
    setReceipt(undefined); setPending(false); setError('');
  }, [storageKey]);
  useEffect(() => {
    if (!hash || receipt) return;
    let cancelled = false;
    let confirmed: TransactionReceipt | undefined;
    setChecking(true);
    publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 }).then(async result => {
      if (cancelled) return;
      confirmed = result;
      try { localStorage.removeItem(storageKey); } catch { /* In-memory receipt remains authoritative. */ }
      if (result.status !== 'success') { setError('Transaction reverted. No changes were applied.'); return; }
      await callback.current(result);
    }).catch(() => {
      if (!cancelled) setError(confirmed ? 'Transaction confirmed, but its result could not be validated. Check the explorer before continuing.' : 'Confirmation could not be checked. Use the explorer or check again before submitting another transaction.');
    }).finally(() => { if (!cancelled) { if (confirmed) setReceipt(confirmed); setChecking(false); } });
    return () => { cancelled = true; };
  }, [hash, receipt, retry, storageKey]);
  async function submit(send: () => Promise<Hash>) {
    if (lock.current || (hash && !receipt)) return;
    const origin = storageKey;
    lock.current = true; setPending(true); setError(''); setReceipt(undefined); setHash(undefined);
    try {
      const next = await send();
      // Keep the transaction locked even if browser storage is unavailable.
      if (scope.current === origin) setHash(next);
      try { localStorage.setItem(origin, next); } catch { /* Current session still tracks the receipt. */ }
    } catch (cause) { if (scope.current === origin) setError(walletError(cause)); }
    finally { lock.current = false; if (scope.current === origin) setPending(false); }
  }
  return { submit, hash, receipt, error, pending, checking, busy: pending || Boolean(hash && !receipt),
    check: () => { setError(''); setRetry(n => n + 1); } };
}

function ReceiptStatus({ tx }: { tx: ReturnType<typeof useTransaction> }) {
  return <div className="transaction-status" aria-live="polite">
    {tx.pending && <p>Confirm the transaction in your wallet.</p>}
    {tx.hash && <a href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer">
      {tx.receipt?.status === 'success' ? 'Confirmed on Base Sepolia' : tx.receipt ? 'Reverted transaction' : 'Transaction submitted'} ↗
    </a>}
    {tx.checking && !tx.receipt && <p>Waiting for two block confirmations…</p>}
    {tx.error && <p role="alert" className="wallet-error">{tx.error}</p>}
    {tx.hash && !tx.receipt && !tx.checking && <button className="wallet-btn" onClick={tx.check}>Check confirmation</button>}
  </div>;
}

export function WalletApp() {
  const { ready, authenticated, user, login, logout, connectWallet } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const [selected, setSelected] = useState('');
  const wallet = wallets.find(w => w.address.toLowerCase() === selected.toLowerCase())
    ?? wallets.find(w => w.address.toLowerCase() === user?.wallet?.address.toLowerCase()) ?? wallets[0];
  const account = authenticated && wallet ? getAddress(wallet.address) : undefined;
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);
  const [deployedRegistry, setDeployedRegistry] = useState<Address>();
  const registry = registryAddress ?? deployedRegistry;
  const [agentId, setAgentId] = useState('');
  const [deploymentAddresses, setDeploymentAddresses] = useState<Record<string, string>>();
  const [deploymentReview, setDeploymentReview] = useState<{ account: Address; gas: bigint; maxFeePerGas: bigint; estimate: string }>();
  const [estimating, setEstimating] = useState(false);
  const [testnetConsent, setTestnetConsent] = useState(false);
  const [initializationSlow, setInitializationSlow] = useState(false);
  const walletChainId = wallet ? Number(wallet.chainId.split(':').at(-1)) : chain.id;
  const walletExplorer = walletChainId === 61997 ? 'https://explorer-studio-dev.genlayer.com' : explorer;
  const wrongChain = !!wallet && walletChainId !== chain.id;
  const available = ready && (!authenticated || walletsReady);
  useEffect(() => {
    if (available) { setInitializationSlow(false); return; }
    const timeout = setTimeout(() => setInitializationSlow(true), 15_000);
    return () => clearTimeout(timeout);
  }, [available]);
  useEffect(() => {
    window.__orivexGetWallet = async () => {
      if (!authenticated || !wallet) {
        if (authenticated) connectWallet(); else login();
        throw new Error('Connect a wallet first, then click Verify.');
      }
      return { address: getAddress(wallet.address), provider: await wallet.getEthereumProvider() };
    };
    return () => { delete window.__orivexGetWallet; };
  }, [authenticated, wallet, login, connectWallet]);

  const registration = useTransaction(`orivex:register:${chain.id}:${account}:${registry}`, async receipt => {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== registry?.toLowerCase()) continue;
      try {
        const event = decodeEventLog({ abi: [registeredEvent], data: log.data, topics: log.topics });
        if (event.eventName === 'AgentRegistered') setAgentId(String(event.args.agentId));
      } catch { /* Other contract events are not agent registrations. */ }
    }
  });
  const deployment = useTransaction(`orivex:deploy:${chain.id}:${account}`, async receipt => {
    for (const log of receipt.logs) {
      try {
        if (log.address.toLowerCase() !== receipt.contractAddress?.toLowerCase()) continue;
        const event = decodeEventLog({ abi: [deployedEvent], data: log.data, topics: log.topics });
        if (event.eventName !== 'ProtocolDeployed') continue;
        const args = event.args;
        if (getAddress(args.admin) !== account) throw new Error('Deployment owner does not match the connected wallet.');
        if (await publicClient.getBytecode({ address: args.registry }) !== registryArtifact.deployedBytecode) throw new Error('Registry bytecode does not match this build.');
        setDeploymentAddresses(args);
        setDeployedRegistry(getAddress(args.registry));
        try { localStorage.setItem(`orivex:deployment:${account}`, JSON.stringify({ hash: receipt.transactionHash })); } catch { /* Addresses remain available in this session. */ }
      } catch (cause) {
        if (cause instanceof Error && /does not match/.test(cause.message)) throw cause;
      }
    }
  });
  const busy = registration.busy || deployment.busy;

  useEffect(() => { setDeployedRegistry(undefined); setDeploymentAddresses(undefined); setDeploymentReview(undefined); setTestnetConsent(false); setAgentId(''); }, [account]);
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    (async () => {
      const saved = JSON.parse(localStorage.getItem(`orivex:deployment:${account}`) || 'null');
      if (!saved?.hash || !/^0x[0-9a-f]{64}$/i.test(saved.hash)) return;
      const receipt = await publicClient.getTransactionReceipt({ hash: saved.hash });
      if (receipt.status !== 'success') return;
      for (const log of receipt.logs) {
        try {
          if (log.address.toLowerCase() !== receipt.contractAddress?.toLowerCase()) continue;
          const event = decodeEventLog({ abi: [deployedEvent], data: log.data, topics: log.topics });
          if (event.eventName !== 'ProtocolDeployed') continue;
          const args = event.args;
          const transaction = await publicClient.getTransaction({ hash: saved.hash });
          if (transaction.to || transaction.input !== deploymentArtifact.bytecode || transaction.from.toLowerCase() !== account.toLowerCase()) continue;
          const code = await publicClient.getBytecode({ address: args.registry });
          if (!cancelled && getAddress(args.admin) === account && code === registryArtifact.deployedBytecode) {
            setDeployedRegistry(getAddress(args.registry)); setDeploymentAddresses(args);
          }
        } catch { /* Ignore unrelated logs. */ }
      }
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [account]);

  async function client() {
    if (!authenticated || !wallet || !account) throw new Error('Connect a wallet first.');
    if (await publicClient.getChainId() !== chain.id) throw new Error('The configured RPC is not Base Sepolia.');
    const provider = await wallet.getEthereumProvider();
    const result = createWalletClient({ account, chain, transport: custom(provider) });
    if (await result.getChainId() !== chain.id) throw new Error('Switch your wallet to Base Sepolia.');
    const addresses = await result.getAddresses();
    if (!addresses.some(address => address.toLowerCase() === account.toLowerCase())) throw new Error('The selected account changed. Reconnect your wallet.');
    return result;
  }
  async function switchNetwork() {
    if (!wallet || switching) return;
    setSwitching(true); setError('');
    try { await wallet.switchChain(chain.id); } catch (cause) { setError(walletError(cause)); }
    finally { setSwitching(false); }
  }
  function connect() { setError(''); if (authenticated) connectWallet(); else login(); }
  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authenticated || !wallet) { connect(); return; }
    if (wrongChain) { await switchNetwork(); return; }
    const data = new FormData(event.currentTarget);
    await registration.submit(async () => {
      if (!registry) throw new Error('Deploy the registry or configure its Base Sepolia address first.');
      const metadata = normalizeMetadata(String(data.get('metadata') ?? ''));
      const capability = String(data.get('capability') ?? '');
      const walletClient = await client();
      if (await publicClient.getBytecode({ address: registry }) !== registryArtifact.deployedBytecode) throw new Error('Configured registry does not match the compiled contract.');
      const { request } = await publicClient.simulateContract({ address: registry, abi: registryArtifact.abi,
        functionName: 'registerAgent', args: [capability, metadata], account });
      setAgentId('');
      return walletClient.writeContract(request);
    });
  }
  async function reviewDeployment() {
    setEstimating(true); setError(''); setDeploymentReview(undefined);
    try {
      await client();
      const data = encodeDeployData({ abi: deploymentArtifact.abi, bytecode: deploymentArtifact.bytecode as Hash });
      const estimatedGas = await publicClient.estimateGas({ account, data });
      const fees = await publicClient.estimateFeesPerGas();
      const gas = estimatedGas * 120n / 100n;
      const maxFeePerGas = fees.maxFeePerGas * 120n / 100n;
      const gasCost = gas * maxFeePerGas;
      if (await publicClient.getBalance({ address: account! }) < gasCost) throw new Error('Fund this wallet with Base Sepolia test ETH, then review deployment again.');
      setDeploymentReview({ account: account!, gas, maxFeePerGas, estimate: formatEther(gasCost) });
    } catch (cause) { setError(walletError(cause)); }
    finally { setEstimating(false); }
  }
  async function deploy() {
    if (!deploymentReview || !testnetConsent || account !== deploymentReview.account) return;
    await deployment.submit(async () => {
      const walletClient = await client();
      const hash = await walletClient.deployContract({ abi: deploymentArtifact.abi,
        bytecode: deploymentArtifact.bytecode as Hash, gas: deploymentReview.gas, maxFeePerGas: deploymentReview.maxFeePerGas });
      setDeploymentReview(undefined); setTestnetConsent(false);
      return hash;
    });
  }

  const header = <div className="wallet-area">
    <span className="network-label">{walletChainId === 61997 ? 'GenLayer Studio Next' : walletChainId === chain.id ? 'Base Sepolia' : `Chain ${walletChainId}`}</span>
    <button className="wallet-btn" disabled={(!available && !initializationSlow) || busy} onClick={() => !available ? window.location.reload() : account ? setMenu(!menu) : connect()}>
      {account ? short(account) : available ? 'Connect wallet' : initializationSlow ? 'Retry connection' : 'Loading wallet…'}
    </button>
    {menu && account && <div className="wallet-menu">
      <strong>Connected wallet</strong>
      <select aria-label="Active wallet" value={wallet.address} disabled={busy} onChange={event => setSelected(event.target.value)}>
        {wallets.map(item => <option key={item.address} value={item.address}>{short(item.address)} ({item.walletClientType})</option>)}
      </select>
      <button disabled={busy} onClick={() => { setMenu(false); connectWallet(); }}>Connect another wallet</button>
      <a href={`${walletExplorer}/address/${account}`} target="_blank" rel="noreferrer">View on explorer ↗</a>
      <button onClick={() => navigator.clipboard.writeText(account).catch(() => setError('Clipboard unavailable. Copy the address from the explorer.'))}>Copy address</button>
      <button disabled={busy} onClick={() => { setMenu(false); logout().catch(cause => setError(walletError(cause))); }}>Disconnect</button>
    </div>}
  </div>;

  const form = <form onSubmit={register} noValidate={!account || wrongChain}>
    <label>Primary capability<select name="capability" disabled={busy}><option>Market research</option><option>Software engineering</option><option>Data analysis</option></select></label>
    <label>Agent metadata URI<input name="metadata" placeholder="ipfs://CID or https://example.com/agent.json" required={Boolean(account)} maxLength={2048} disabled={busy} /></label>
    <p className="form-note">Metadata should include your agent’s name and description. Your wallet will own this identity.</p>
    {account && <p className="wallet-owner">Owner: <a href={`${explorer}/address/${account}`} target="_blank" rel="noreferrer">{short(account)} ↗</a></p>}
    {account && !registry && <p className="wallet-error">Registry not deployed. <a href="#deploy" onClick={() => { const modal = document.getElementById('registerModal'); if (modal) modal.hidden = true; }}>Set up Base Sepolia</a></p>}
    <button className="btn btn-primary full" disabled={!available || busy || switching || Boolean(account && !wrongChain && !registry)}>
      {registration.pending ? 'Confirm in wallet…' : registration.busy ? 'Waiting for confirmation…' : !account ? 'Connect wallet' : switching ? 'Switching network…' : wrongChain ? 'Switch to Base Sepolia' : 'Register agent'}
    </button>
    <p className="form-note">Base Sepolia testnet. Gas uses test ETH; no USDC payment.</p>
    {error && <p role="alert" className="wallet-error">{error}</p>}
    {initializationSlow && <p role="alert" className="wallet-error">Privy is taking longer to initialize. Check your connection and the app’s allowed origins, then retry from the header.</p>}
    <ReceiptStatus tx={registration} />
    {agentId && <p className="wallet-success">Agent #{agentId} registered on Base Sepolia.</p>}
  </form>;

  const deployPanel = <section className="deployment-panel" id="base-deploy">
    <h3>Base Sepolia deployment</h3>
    <p>Deploy the registry, action certificates, reputation and permissions in one transaction. Your connected wallet receives the admin roles.</p>
    <p className="form-note">Studio Next evidence proofs are available in the agent lab. A bridge to finalize Base certificates is not configured.</p>
    {initializationSlow && <p role="alert" className="wallet-error">Privy initialization has not completed. Check the network and allowed origins, then use Retry connection in the header.</p>}
    {!account ? <button className="btn btn-primary" disabled={!available} onClick={connect}>Connect deployment wallet</button>
      : wrongChain ? <button className="btn btn-primary" disabled={switching || busy} onClick={switchNetwork}>{switching ? 'Switching…' : 'Switch to Base Sepolia'}</button>
      : !deploymentAddresses && <button className="btn btn-primary" disabled={estimating || busy || deployment.receipt?.status === 'success'} onClick={reviewDeployment}>{estimating ? 'Estimating gas…' : 'Review deployment'}</button>}
    {deploymentReview && <div className="deployment-review">
      <p>Admin: <a href={`${explorer}/address/${deploymentReview.account}`} target="_blank" rel="noreferrer">{deploymentReview.account}</a></p>
      <p>Estimated execution gas: {deploymentReview.estimate} test ETH. The wallet shows the final fee, including Base data costs.</p>
      <label className="consent"><input type="checkbox" checked={testnetConsent} disabled={busy} onChange={event => setTestnetConsent(event.target.checked)} />Deploy these four contracts on Base Sepolia (84532).</label>
      <button className="btn btn-primary" disabled={!testnetConsent || busy || account !== deploymentReview.account || wrongChain} onClick={deploy}>Deploy protocol</button>
    </div>}
    {error && <p role="alert" className="wallet-error">{error}</p>}
    <ReceiptStatus tx={deployment} />
    {deploymentAddresses && <div className="deployed-contracts"><h4>Confirmed contracts</h4>
      {Object.entries(deploymentAddresses).map(([name, address]) => <p key={name}>{name}: <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">{address}</a></p>)}
      <p>Set VITE_AGENT_REGISTRY_ADDRESS to the registry address for shared website deployments.</p>
    </div>}
  </section>;
  return <>{createPortal(header, headerSlot)}{createPortal(form, formSlot)}{createPortal(deployPanel, deploySlot)}</>;
}

function MissingConfiguration() {
  const message = 'Set VITE_PRIVY_APP_ID and restart the app to enable wallet connection.';
  return <>{createPortal(<button className="wallet-btn" onClick={() => alert(message)}>Configure Privy</button>, headerSlot)}
    {createPortal(<p role="alert">{message}</p>, formSlot)}{createPortal(<p>{message}</p>, deploySlot)}</>;
}

class WalletBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return createPortal(<div><button className="wallet-btn" onClick={() => window.location.reload()}>Retry wallet connection</button><p className="wallet-error" role="alert">Privy could not initialize. Check the App ID and allowed origins.</p></div>, headerSlot);
  }
}

export function mountWallet() {
createRoot(document.getElementById('wallet-root')!).render(<WalletBoundary>{appId ?
  <PrivyProvider appId={appId} config={{
    loginMethods: ['wallet', 'email'], defaultChain: chain, supportedChains: [chain, studioDevnet],
    appearance: { theme: 'dark', accentColor: '#79a7ff', walletChainType: 'ethereum-only', showWalletLoginFirst: true },
    embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
  }}><WalletApp /></PrivyProvider> : <MissingConfiguration />}</WalletBoundary>);
}
