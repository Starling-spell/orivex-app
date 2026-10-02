import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant, type Hash } from 'genlayer-js/types';
import { canonicalProof, validateProof, validateReceipt, type Proof } from './proof';
import { parseProofId, parseProofRecord, studioError, studioWalletWriter, studioFees, txHash, waitUntil } from './studio';
import manifest from '../deployments/genlayer-studio-next.json';
import './genlayer.css';

type Example = { id: string; name: string; capability: string; proofId: number; verifyTx: string;
  proof?: Proof; checkedAt?: string; expected?: string; consensus?: { votes: Record<string, string> } };
const client = createClient({ chain: studioDevnet });
if (manifest.chainId !== 61997 || studioDevnet.id !== 61997) throw new Error('Lab deployment must use Studio Next (61997).');
const explorer = 'https://explorer-studio-dev.genlayer.com';
const address = manifest.address as `0x${string}`;
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');

function AgentLab() {
  const [manual, setManual] = useState({ reference: '', claim: '', criterion: '', url: '', digest: '' });
  const [manualDigesting, setManualDigesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [pendingSubmitTx, setPendingSubmitTx] = useState('');
  const [pendingVerifyTx, setPendingVerifyTx] = useState('');
  const [lookupId, setLookupId] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const smoke = { id: 'smoke', name: 'Document smoke proof', capability: 'Deployment verification', proofId: 1,
    verifyTx: manifest.smoke.verifyTx, proof: manifest.smoke.proof as Proof, checkedAt: manifest.checkedAt };
  const [examples, setExamples] = useState<Example[]>([smoke]);
  const [selected, setSelected] = useState('smoke');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('Saved receipt. Recheck to read Studio Next now.');
  const [error, setError] = useState('');
  const entry = examples.find(example => example.id === selected) ?? examples[0];
  const proof = entry.proof;
  useEffect(() => { void loadExamples(); }, []);
  async function loadExamples() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/genlayer-next-examples.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Example receipts are not available yet. Run npm run genlayer:examples, then npm run genlayer:publish.');
      const report = await response.json();
      if (report.address !== manifest.address || report.chainId !== 61997 || !Array.isArray(report.examples)) throw new Error('Example deployment does not match this build.');
      const records = report.examples.filter((item: Example) => item.proof && item.verifyTx);
      for (const item of records) {
        validateProof(item.proof, manifest.address, item.proofId);
        if (await hash(canonicalProof(item.proof)) !== item.proof.proof_hash) throw new Error('Saved proof hash mismatch.');
      }
      const latest = await loadLatestOnchain(records.map((item: Example) => item.proofId));
      setExamples(latest ? [smoke, ...records, latest] : [smoke, ...records]);
      setMessage(latest
        ? `${records.length} saved receipts loaded, plus live proof #${latest.proofId}. Select one, then recheck onchain.`
        : `${records.length} agent example receipts loaded. Select one, then recheck onchain.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load examples.'); }
    finally { setLoading(false); }
  }
  async function readOnchainProof(id: number): Promise<Example> {
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('Enter a positive proof ID.');
    const raw = await client.readContract({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL, address, functionName: 'get_proof', args: [id] });
    const live: Proof = JSON.parse(String(raw));
    validateProof(live, manifest.address, id);
    if (await hash(canonicalProof(live)) !== live.proof_hash) throw new Error('Onchain proof hash mismatch.');
    return { id: `onchain-${id}`, name: live.reference_id, capability: 'Onchain proof', proofId: id, verifyTx: '', proof: live, checkedAt: new Date().toISOString() };
  }
  async function loadLatestOnchain(knownIds: number[]) {
    try {
      const total = Number(await client.readContract({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL, address, functionName: 'total_proofs' }));
      for (let id = total; id >= 1; id--) {
        if (id === smoke.proofId || knownIds.includes(id)) continue;
        try { return await readOnchainProof(id); } catch { /* Pending or invalid records are skipped. */ }
      }
    } catch { /* Saved receipts remain visible if Studio Next is unreachable. */ }
    return undefined;
  }
  async function lookupProof() {
    setLookingUp(true); setError('');
    try {
      const item = await readOnchainProof(Number(lookupId.trim()));
      setExamples(items => [...items.filter(entry => entry.id !== item.id), item]);
      setSelected(item.id);
      setMessage(`Loaded proof #${item.proofId} from Studio Next (${item.proof?.status}).`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load that proof.'); }
    finally { setLookingUp(false); }
  }
  async function recheck() {
    setChecking(true); setError(''); setMessage('Reading finalized state and consensus receipt…');
    try {
      const source = await client.getContractCode(address);
      if (await hash(typeof source === 'string' ? source : new TextDecoder().decode(source)) !== manifest.sourceSha256) throw new Error('The onchain source differs from this deployment.');
      const raw = await client.readContract({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL, address, functionName: 'get_proof', args: [entry.proofId] });
      const live: Proof = JSON.parse(String(raw));
      validateProof(live, manifest.address, entry.proofId);
      if (await hash(canonicalProof(live)) !== live.proof_hash) throw new Error('Proof commitment mismatch.');
      let votes: Record<string, string> | undefined;
      if (entry.verifyTx) {
        const receipt = await client.getTransaction({ hash: entry.verifyTx as Hash });
        validateReceipt(receipt, manifest.address, manifest.deployer);
        const call = (receipt.data as { calldata?: { readable?: string } })?.calldata?.readable;
        if (!call?.includes('"":"verify_proof"') || !call.includes(`"args":[${entry.proofId},]`)) throw new Error('Receipt refers to a different proof.');
        if (live.submitter.toLowerCase() !== manifest.deployer.toLowerCase()) throw new Error('Proof submitter mismatch.');
        votes = receipt.consensus_data!.votes!;
      }
      setExamples(items => items.map(item => item.id === entry.id ? { ...item, proof: live, checkedAt: new Date().toISOString(), consensus: votes ? { votes } : item.consensus } : item));
      setMessage(entry.verifyTx
        ? 'Live check passed: source, finalized consensus, submitter and proof commitment match. Evidence bytes can be rechecked with npm run genlayer:check.'
        : 'Live proof loaded from Studio Next. Submit/verify receipts are not attached to this lookup.');
    } catch (cause) { setError(cause instanceof Error && /differs|mismatch|invalid|Receipt|receipt|proof/i.test(cause.message) ? cause.message : 'Studio Next could not be checked. Saved receipt remains visible; retry or run npm run genlayer:check.'); setMessage('Live verification incomplete.'); }
    finally { setChecking(false); }
  }
  const votes = Object.values(entry.consensus?.votes ?? {});
  async function digestEvidence() {
    if (!manual.url) return;
    setManualDigesting(true); setError('');
    try { const response = await fetch(manual.url); if (!response.ok) throw new Error(`Evidence returned HTTP ${response.status}`); const bytes = new Uint8Array(await response.arrayBuffer()); const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join(''); setManual(value => ({ ...value, digest })); setMessage('Evidence digest calculated. Click Verify and approve the wallet transactions. The judgment will appear here.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not fetch evidence.'); }
    finally { setManualDigesting(false); }
  }
  const manualReady = Object.values(manual).every(Boolean);
  async function verifyOnchain() {
    if (!manualReady) { setError('Fill every field and hash the evidence before verifying.'); return; }
    setVerifying(true); setError(''); setPendingSubmitTx(''); setPendingVerifyTx('');
    try {
      const { account, client: writer } = await studioWalletWriter();
      setMessage(`Approve the submit transaction in your wallet (${account.slice(0, 6)}…${account.slice(-4)})…`);
      const submitTx = txHash(await writer.writeContract({
        address, functionName: 'submit_proof', value: 0n, leaderOnly: false, fees: await studioFees(writer),
        args: [manual.reference, manual.claim, manual.criterion, manual.url, manual.digest.toLowerCase()],
      }));
      setPendingSubmitTx(submitTx);
      localStorage.setItem(`orivex:61997:${address}:${account}:pending`, JSON.stringify({submitTx,reference:manual.reference}));
      const submitted = await client.waitForTransactionReceipt({hash:submitTx,waitUntil:'finalized',fullTransaction:true});
      validateReceipt(submitted,address,account);
      setMessage('Claim submitted. Waiting for Studio Next to assign a proof ID…');
      await new Promise(resolve => setTimeout(resolve, 50));
      const id = await waitUntil('Timed out waiting for Studio Next to assign a proof ID.', async () => {
        try {
          return parseProofId(await client.readContract({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL, address, functionName: 'get_proof_id', args: [account, manual.reference] }));
        } catch { return undefined; }
      }, 40, 3000);
      setLookupId(String(id));
      setMessage(`Proof #${id} is on-chain. Approve the verify transaction in your wallet…`);
      const verifyTx = txHash(await writer.writeContract({
        address, functionName: 'verify_proof', args: [id], value: 0n, leaderOnly: false,
      }));
      setPendingVerifyTx(verifyTx);
      localStorage.setItem(`orivex:61997:${address}:${account}:pending`, JSON.stringify({submitTx,verifyTx,proofId:id,reference:manual.reference}));
      const verified = await client.waitForTransactionReceipt({hash:verifyTx,waitUntil:'finalized',fullTransaction:true});
      validateReceipt(verified,address,account);
      setMessage(`Proof #${id} sent for verification. Waiting for validator consensus…`);
      const live = await waitUntil('Timed out waiting for validator consensus.', async () => {
        try {
          const proof = parseProofRecord(await client.readContract({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL, address, functionName: 'get_proof', args: [id] })) as Proof | undefined;
          if (!proof || !['SUCCESS', 'FAILED', 'INCONCLUSIVE'].includes(proof.status) || !proof.proof_hash) return undefined;
          validateProof(proof, address, id);
          if (await hash(canonicalProof(proof)) !== proof.proof_hash) throw new Error('Proof commitment mismatch.');
          return proof;
        } catch { return undefined; }
      }, 80, 4000);
      const item: Example = {
        id: `onchain-${id}`, name: live.reference_id, capability: 'Live verification', proofId: id,
        verifyTx, proof: live, checkedAt: new Date().toISOString(),
      };
      setExamples(items => [...items.filter(entry => entry.id !== item.id), item]);
      setSelected(item.id);
      setMessage(`Validators judged this claim ${live.status}. The result is stored on Studio Next and shown below.`);
      document.getElementById('lab-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (cause) {
      setError(studioError(cause));
      setMessage('On-chain verification did not finish.');
    } finally { setVerifying(false); }
  }
  return <div className="agent-lab">
    <div className="lab-heading"><div><p>GenLayer Studio Next · Chain 61997</p><h2>Inspect an agent’s claim.</h2></div><a href="/docs/guide.html">User guide ↗</a></div>
    <p>Executable research and review agents submit claims against pinned public evidence. An intelligent contract records the validator-agreed judgment.</p>
    <div className="lab-actions"><button className="btn btn-primary" disabled={loading || checking} onClick={loadExamples}>{loading ? 'Loading receipts…' : 'Load agent examples'}</button><a className="btn btn-ghost" href="https://studio-next.genlayer.com" target="_blank" rel="noreferrer">Open GenLayer Studio ↗</a></div>
    <section className="manual-proof card"><h3>Verify an agent manually</h3><p>Enter an externally acquired claim and immutable evidence. This page submits the proof to Studio Next, waits for validator consensus, and shows SUCCESS, FAILED, or INCONCLUSIVE here.</p><div className="manual-grid"><label>Reference ID<input value={manual.reference} onChange={event => setManual({ ...manual, reference: event.target.value })} placeholder="agent-run-001" /></label><label>Claim<input value={manual.claim} onChange={event => setManual({ ...manual, claim: event.target.value })} placeholder="Agent completed the audit" /></label><label>Criterion<textarea value={manual.criterion} onChange={event => setManual({ ...manual, criterion: event.target.value })} placeholder="Evidence must show the completed audit and its result" /></label><label>Evidence URL<input value={manual.url} onChange={event => setManual({ ...manual, url: event.target.value })} placeholder="https://raw.githubusercontent.com/..." /></label><label>Evidence SHA-256<input value={manual.digest} onChange={event => setManual({ ...manual, digest: event.target.value })} placeholder="64 hex characters" /></label></div><div className="lab-actions"><button className="btn btn-ghost" disabled={!manual.url || manualDigesting || verifying} onClick={digestEvidence}>{manualDigesting ? 'Fetching evidence…' : 'Fetch and hash evidence'}</button><button className="btn btn-primary" disabled={!manualReady || verifying} onClick={verifyOnchain}>{verifying ? 'Verifying…' : 'Verify'}</button></div>
      <p className="lab-message">Hash the evidence, then click Verify. Approve the wallet transactions. The validator judgment appears in this page after consensus.</p>
      {(verifying || pendingSubmitTx || pendingVerifyTx) && <p className="lab-message" role="status">{message}</p>}
      {pendingSubmitTx && <p className="tx-link">Pending submit transaction: <a href={`${explorer}/tx/${pendingSubmitTx}`} target="_blank" rel="noreferrer">{pendingSubmitTx}</a></p>}
      {pendingVerifyTx && <p className="tx-link">Pending verify transaction: <a href={`${explorer}/tx/${pendingVerifyTx}`} target="_blank" rel="noreferrer">{pendingVerifyTx}</a></p>}
      {error && <p className="lab-error" role="alert">{error}</p>}
      <div className="lab-actions lookup-row"><label>Onchain proof ID<input value={lookupId} onChange={event => setLookupId(event.target.value)} placeholder="7" inputMode="numeric" /></label><button className="btn btn-primary" disabled={lookingUp || checking || verifying || !lookupId.trim()} onClick={lookupProof}>{lookingUp ? 'Looking up…' : 'Look up proof'}</button></div></section>
    <div className="lab-layout"><div className="lab-list" aria-label="Agent examples">{examples.map(item => <button key={item.id} aria-pressed={entry.id === item.id} disabled={checking} onClick={() => { setSelected(item.id); setError(''); setMessage('Saved receipt. Recheck to read Studio Next now.'); }}><strong>{item.name}</strong><span>{item.capability}</span><small>{item.proof?.status ?? 'PENDING'} · #{item.proofId}</small></button>)}</div>
      <article className="lab-proof" id="lab-result"><div className="lab-proof-title"><h3>{entry.name}</h3><span className={`proof-status status-${proof?.status.toLowerCase()}`}>{proof?.status ?? 'PENDING'}</span></div>
        {proof ? <><h4>Claim</h4><p>{proof.claim}</p><h4>Evaluation criterion</h4><p>{proof.criterion}</p><dl>
          <dt>Evidence</dt><dd><a href={proof.evidence_url} target="_blank" rel="noreferrer">Open pinned document ↗</a></dd>
          <dt>Evidence SHA-256</dt><dd><code>{proof.evidence_sha256}</code></dd>
          <dt>Proof SHA-256</dt><dd><code>{proof.proof_hash}</code></dd>
          {entry.verifyTx ? <><dt>Verification transaction</dt><dd><a href={`${explorer}/tx/${entry.verifyTx}`} target="_blank" rel="noreferrer">{entry.verifyTx}</a></dd></> : null}
          {entry.verifyTx && !entry.id.startsWith('onchain-') ? <><dt>Receipt export</dt><dd><a href={`/receipts/${entry.verifyTx}.json`} target="_blank" rel="noreferrer">Open full consensus receipt JSON ↗</a></dd></> : null}
          <dt>Contract</dt><dd><a href={`${explorer}/address/${manifest.address}`} target="_blank" rel="noreferrer">{manifest.address}</a></dd>
          <dt>Submitter</dt><dd><a href={`${explorer}/address/${proof.submitter}`} target="_blank" rel="noreferrer">{proof.submitter}</a></dd>
          <dt>Consensus</dt><dd>{votes.length ? `${votes.filter(v => v === 'agree').length} agree / ${votes.length} assigned; ${votes.filter(v => v === 'idle').length} idle` : 'See transaction receipt'}</dd>
          <dt>Last checked</dt><dd>{entry.checkedAt ? new Date(entry.checkedAt).toLocaleString() : 'Not checked in this session'}</dd>
        </dl></> : <p>This example has not finalized.</p>}
        <button className="btn btn-primary" disabled={checking || loading || verifying || !proof} onClick={recheck}>{checking ? 'Checking Studio Next…' : 'Recheck onchain'}</button>
        <p className="lab-message" role="status">{message}</p>{error && <p className="lab-error" role="alert">{error}</p>}
      </article></div>
    <p className="lab-footnote">Agent names describe local programs, not independently authenticated identities. The on-chain judgment covers the claim and evidence only.</p>
  </div>;
}

createRoot(document.getElementById('genlayer-slot')!).render(<AgentLab />);
