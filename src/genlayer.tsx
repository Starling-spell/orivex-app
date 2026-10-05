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
  proof?: Proof; checkedAt?: string; expected?: string; consensus?: { votes: Record<string, string> };
  credentialProofId?: number; verifiedCount?: number };
type Task = { task_id: string; requester: string; agent: string; claim: string; criterion: string;
  status: string; proof_id: number };
type VerifiedWork = { proofId: number; taskId: string; agent: string; requester: string };
const client = createClient({ chain: studioDevnet });
if (manifest.chainId !== 61997 || studioDevnet.id !== 61997) throw new Error('Lab deployment must use Studio Next (61997).');
const explorer = 'https://explorer-studio-dev.genlayer.com';
const address = manifest.address as `0x${string}`;
const upgraded = (manifest.smoke.proof as Proof).schema_version === 3;
const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
const proofTemplates = [
  { id: 'license-review', name: 'License review: supported claim', expected: 'SUCCESS',
    claim: manifest.smoke.proof.claim, criterion: manifest.smoke.proof.criterion },
  { id: 'license-restriction', name: 'License review: contradicted claim', expected: 'FAILED',
    claim: 'The license forbids redistribution of the software.',
    criterion: 'SUCCESS only if the license explicitly forbids redistribution. FAILED if it explicitly grants permission to distribute the software.' },
];

export function AgentLab() {
  const [templateId, setTemplateId] = useState(proofTemplates[0].id);
  const [templateNotice, setTemplateNotice] = useState('');
  const [taskDraft, setTaskDraft] = useState({ taskId: '', agent: '', claim: '', criterion: '' });
  const [creatingTask, setCreatingTask] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const [verifiedWork, setVerifiedWork] = useState<VerifiedWork[]>([]);
  const [manual, setManual] = useState({ taskId: '', reference: '', url: '', digest: '' });
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
  const template = proofTemplates.find(item => item.id === templateId)!;
  function applyTemplate() {
    if (creatingTask || verifying || manualDigesting) return;
    const taskId = `orivex:example:${template.id}:${crypto.randomUUID()}`;
    setTaskDraft(value => ({ taskId, agent: value.agent, claim: template.claim, criterion: template.criterion }));
    setManual({ taskId, reference: `${taskId}:proof`, url: manifest.smoke.proof.evidence_url,
      digest: manifest.smoke.proof.evidence_sha256 });
    setTask(null); setError('');
    setTemplateNotice(`${template.name} loaded. Enter the assigned agent wallet below, then create the task with a different requester wallet.`);
  }
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
      if (upgraded) await loadVerifiedDirectory();
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
    const credentialProofId = live.schema_version === 3 && live.task_id
      ? Number(await client.readContract({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL, address, functionName: 'get_credential', args: [live.submitter, live.task_id] })) : undefined;
    const verifiedCount = live.schema_version === 3
      ? Number(await client.readContract({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL, address, functionName: 'get_verified_count', args: [live.submitter] })) : undefined;
    return { id: `onchain-${id}`, name: live.reference_id, capability: 'Onchain proof', proofId: id, verifyTx: '', proof: live, checkedAt: new Date().toISOString(), credentialProofId, verifiedCount };
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
        validateReceipt(receipt, manifest.address, live.submitter);
        const call = (receipt.data as { calldata?: { readable?: string } })?.calldata?.readable;
        if (!call?.includes('"":"verify_proof"') || !call.includes(`"args":[${entry.proofId},]`)) throw new Error('Receipt refers to a different proof.');
        votes = receipt.consensus_data!.votes!;
      }
      const credentialProofId = live.schema_version === 3 && live.task_id
        ? Number(await client.readContract({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
          address, functionName: 'get_credential', args: [live.submitter, live.task_id] })) : undefined;
      const verifiedCount = live.schema_version === 3
        ? Number(await client.readContract({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
          address, functionName: 'get_verified_count', args: [live.submitter] })) : undefined;
      if (live.schema_version === 3 && credentialProofId !== (live.status === 'SUCCESS' ? live.proof_id : 0))
        throw new Error('Credential state does not match the finalized judgment.');
      setExamples(items => items.map(item => item.id === entry.id ? { ...item, proof: live, checkedAt: new Date().toISOString(), credentialProofId, verifiedCount, consensus: votes ? { votes } : item.consensus } : item));
      setMessage(entry.verifyTx
        ? 'Live check passed: source, finalized consensus, submitter and proof commitment match. Evidence bytes can be rechecked with npm run genlayer:check.'
        : 'Live proof loaded from Studio Next. Submit/verify receipts are not attached to this lookup.');
    } catch (cause) { setError(cause instanceof Error && /differs|mismatch|invalid|Receipt|receipt|proof/i.test(cause.message) ? cause.message : 'Studio Next could not be checked. Saved receipt remains visible; retry or run npm run genlayer:check.'); setMessage('Live verification incomplete.'); }
    finally { setChecking(false); }
  }
  const votes = Object.values(entry.consensus?.votes ?? {});
  async function loadTask(taskId: string) {
    if (!taskId.trim()) throw new Error('Enter a task ID.');
    const raw = await client.readContract({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
      address, functionName: 'get_task', args: [taskId.trim()] });
    const next = JSON.parse(String(raw)) as Task;
    if (next.task_id !== taskId.trim() || !/^0x[0-9a-f]{40}$/i.test(next.requester)
      || !/^0x[0-9a-f]{40}$/i.test(next.agent)) throw new Error('Invalid onchain task.');
    setTask(next);
    return next;
  }
  async function loadVerifiedDirectory() {
    const total = Number(await client.readContract({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
      address, functionName: 'total_proofs' }));
    const approved: VerifiedWork[] = [];
    for (let id = total; id > Math.max(0, total - 50); id--) {
      try {
        const item = await readOnchainProof(id);
        const record = item.proof;
        if (record?.schema_version === 3 && record.status === 'SUCCESS' && record.task_id && record.requester
          && item.credentialProofId === id)
          approved.push({ proofId: id, taskId: record.task_id, agent: record.submitter, requester: record.requester });
      } catch { /* Pending or invalid proofs never enter the verified directory. */ }
    }
    setVerifiedWork(approved);
  }
  async function createTask() {
    if (!taskDraft.taskId.trim() || !/^0x[0-9a-f]{40}$/i.test(taskDraft.agent)
      || !taskDraft.claim.trim() || !taskDraft.criterion.trim()) { setError('Fill the task ID, agent address, claim, and criterion.'); return; }
    setCreatingTask(true); setError('');
    try {
      const { account, client: writer } = await studioWalletWriter();
      if (account.toLowerCase() === taskDraft.agent.toLowerCase()) throw new Error('Use a different wallet for the requester and agent. Open your wallet menu, click Connect another wallet, and select that wallet as the requester. After creating the task, select the assigned agent wallet to submit evidence.');
      const tx = txHash(await writer.writeContract({ address, functionName: 'create_task',
        args: [taskDraft.taskId.trim(), taskDraft.agent, taskDraft.claim.trim(), taskDraft.criterion.trim()],
        value: 0n, leaderOnly: false, fees: await studioFees(writer) }));
      const receipt = await client.waitForTransactionReceipt({ hash: tx, waitUntil: 'finalized', fullTransaction: true, interval: 5000, retries: 180 });
      validateReceipt(receipt, address, account);
      const next = await waitUntil('Task was not readable after finalization.', async () => {
        try { return await loadTask(taskDraft.taskId); } catch { return undefined; }
      }, 40, 3000);
      setManual(value => ({ ...value, taskId: next.task_id }));
      setMessage(`Task ${next.task_id} is fixed onchain. The assigned agent can now submit evidence.`);
    } catch (cause) { setError(studioError(cause)); }
    finally { setCreatingTask(false); }
  }
  async function digestEvidence() {
    if (!manual.url) return;
    setManualDigesting(true); setError('');
    try { const response = await fetch(manual.url); if (!response.ok) throw new Error(`Evidence returned HTTP ${response.status}`); const bytes = new Uint8Array(await response.arrayBuffer()); const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join(''); setManual(value => ({ ...value, digest })); setMessage('Evidence digest calculated. Click Verify and approve the wallet transactions. The judgment will appear here.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not fetch evidence.'); }
    finally { setManualDigesting(false); }
  }
  const manualReady = task?.task_id === manual.taskId && (task.status === 'OPEN'
    ? Object.values(manual).every(Boolean) && /^[0-9a-f]{64}$/i.test(manual.digest)
    : task.status === 'SUBMITTED' && Number.isSafeInteger(task.proof_id) && task.proof_id > 0);
  async function verifyOnchain() {
    if (!manualReady) { setError('Fill every field and hash the evidence before verifying.'); return; }
    setVerifying(true); setError(''); setPendingSubmitTx(''); setPendingVerifyTx('');
    try {
      const { account, client: writer } = await studioWalletWriter();
      const currentTask = await loadTask(manual.taskId);
      if (!['OPEN', 'SUBMITTED'].includes(currentTask.status) || currentTask.agent.toLowerCase() !== account.toLowerCase())
        throw new Error('Connect the assigned agent wallet to an open or submitted task.');
      let id = currentTask.proof_id;
      const pendingKey = `orivex:61997:${address}:${account}:pending`;
      let submitTx: Hash | '' = '';
      if (currentTask.status === 'OPEN') {
        setMessage(`Approve the submit transaction in your wallet (${account.slice(0, 6)}…${account.slice(-4)})…`);
        submitTx = txHash(await writer.writeContract({
          address, functionName: 'submit_proof', value: 0n, leaderOnly: false, fees: await studioFees(writer),
          args: [manual.taskId, manual.reference, manual.url, manual.digest.toLowerCase()],
        }));
        setPendingSubmitTx(submitTx);
        try { localStorage.setItem(pendingKey, JSON.stringify({submitTx,reference:manual.reference})); } catch { /* The receipt stays visible in this session. */ }
        const submitted = await client.waitForTransactionReceipt({hash:submitTx,waitUntil:'finalized',fullTransaction:true,interval:5000,retries:180});
        validateReceipt(submitted,address,account);
        setMessage('Claim submitted. Waiting for Studio Next to assign a proof ID…');
        await new Promise(resolve => setTimeout(resolve, 50));
        id = await waitUntil('Timed out waiting for Studio Next to assign a proof ID.', async () => {
          try {
            return parseProofId(await client.readContract({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL, address, functionName: 'get_proof_id', args: [account, manual.reference] }));
          } catch { return undefined; }
        }, 40, 3000);
        setTask({ ...currentTask, status: 'SUBMITTED', proof_id: id });
      }
      if (!Number.isSafeInteger(id) || id < 1) throw new Error('Submitted task did not return a proof ID.');
      setLookupId(String(id));
      setMessage(`Proof #${id} is on-chain. Approve the verify transaction in your wallet…`);
      let savedVerifyTx = '';
      try {
        const saved = JSON.parse(localStorage.getItem(pendingKey) ?? 'null');
        if (saved?.proofId === id && /^0x[0-9a-f]{64}$/i.test(saved.verifyTx ?? '')) savedVerifyTx = saved.verifyTx;
      } catch { /* Verification can continue without browser storage. */ }
      const verifyTx = savedVerifyTx ? txHash(savedVerifyTx) : txHash(await writer.writeContract({
        address, functionName: 'verify_proof', args: [id], value: 0n, leaderOnly: false, fees: await studioFees(writer),
      }));
      setPendingVerifyTx(verifyTx);
      try { localStorage.setItem(pendingKey, JSON.stringify({submitTx,verifyTx,proofId:id,reference:manual.reference})); } catch { /* The receipt stays visible in this session. */ }
      const verified = await client.waitForTransactionReceipt({hash:verifyTx,waitUntil:'finalized',fullTransaction:true,interval:5000,retries:180});
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
        credentialProofId: Number(await client.readContract({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
          address, functionName: 'get_credential', args: [account, manual.taskId] })),
        verifiedCount: Number(await client.readContract({ transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
          address, functionName: 'get_verified_count', args: [account] })),
      };
      setExamples(items => [...items.filter(entry => entry.id !== item.id), item]);
      setSelected(item.id);
      setTask({ ...currentTask, status: live.status, proof_id: id });
      try { localStorage.removeItem(pendingKey); } catch { /* Finalized state remains authoritative. */ }
      if (live.status === 'SUCCESS') await loadVerifiedDirectory();
      setMessage(live.status === 'SUCCESS'
        ? `Validators approved proof #${id}. A nontransferable task credential was issued to ${account}.`
        : `Validators judged proof #${id} ${live.status}. No task credential was issued.`);
      document.getElementById('lab-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (cause) {
      setError(studioError(cause));
      setMessage('On-chain verification did not finish.');
    } finally { setVerifying(false); }
  }
  return <div className="agent-lab">
    <div className="lab-heading"><div><p>GenLayer Studio Next · Chain 61997</p><h2>Inspect an agent’s claim.</h2></div><a href="/docs/guide.html">User guide ↗</a></div>
    <p>A requester fixes the claim and criterion before an agent submits pinned evidence. Validator consensus issues a task credential only for a successful proof.</p>
    <div className="lab-actions"><button className="btn btn-primary" disabled={loading || checking} onClick={loadExamples}>{loading ? 'Loading receipts…' : 'Load agent examples'}</button><a className="btn btn-ghost" href="https://studio-next.genlayer.com" target="_blank" rel="noreferrer">Open GenLayer Studio ↗</a></div>
    {upgraded && <section className="lab-templates" aria-labelledby="template-heading">
      <h3 id="template-heading">Try an example template</h3>
      <p>Fill both steps with a pinned document, its SHA-256, and a fresh task ID. Review the fields before sending a transaction.</p>
      <div className="lab-actions template-controls">
        <label>Example template<select value={templateId} disabled={creatingTask || verifying || manualDigesting}
          onChange={event => setTemplateId(event.target.value)}>
          {proofTemplates.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <button className="btn btn-primary" disabled={creatingTask || verifying || manualDigesting} onClick={applyTemplate}>Use template</button>
        <button className="btn btn-ghost" disabled={checking || verifying} onClick={() => {
          setSelected('smoke'); setError('');
          document.getElementById('lab-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}>View completed example</button>
      </div>
      <p>Expected verdict: <strong>{template.expected}</strong> if the pinned evidence is available. Validators determine the actual result. Only SUCCESS issues a task credential.</p>
      <ol><li>Enter the agent wallet address. In the header wallet menu, use Connect another wallet and select a different requester wallet to create the onchain task.</li>
        <li>Switch to the assigned agent wallet. Fetch and hash the evidence to check the prefilled digest.</li>
        <li>Submit and verify, then inspect the finalized verdict and credential.</li></ol>
      <p><a href={manifest.smoke.proof.evidence_url} target="_blank" rel="noreferrer">Read the pinned example evidence ↗</a>. Viewing the completed example requires no wallet.</p>
      {templateNotice && <p className="lab-message" role="status">{templateNotice}</p>}
    </section>}
    <section className="manual-proof card">{upgraded ? <><h3>1 · Request work</h3><p>Connect the requester wallet. This wallet fixes the task before the assigned agent can provide evidence.</p><div className="manual-grid"><label>Task ID<input value={taskDraft.taskId} onChange={event => setTaskDraft({ ...taskDraft, taskId: event.target.value })} placeholder="audit-2026-001" /></label><label>Assigned agent wallet<input value={taskDraft.agent} onChange={event => setTaskDraft({ ...taskDraft, agent: event.target.value })} placeholder="0x…" /></label><label>Claim<input value={taskDraft.claim} onChange={event => setTaskDraft({ ...taskDraft, claim: event.target.value })} placeholder="Agent completed the audit" /></label><label>Acceptance criterion<textarea value={taskDraft.criterion} onChange={event => setTaskDraft({ ...taskDraft, criterion: event.target.value })} placeholder="Pinned report must show scope, findings, and completed review" /></label></div><div className="lab-actions"><button className="btn btn-primary" disabled={creatingTask || verifying} onClick={createTask}>{creatingTask ? 'Creating task…' : 'Create onchain task'}</button></div>
      <h3>2 · Prove the work</h3><p>Connect the assigned agent wallet. The claim and criterion below come from the requester’s onchain task and cannot be edited here.</p><div className="manual-grid"><label>Task ID<input value={manual.taskId} onChange={event => { setManual({ ...manual, taskId: event.target.value }); setTask(null); }} placeholder="audit-2026-001" /></label><label>Reference ID<input value={manual.reference} onChange={event => setManual({ ...manual, reference: event.target.value })} placeholder="agent-run-001" /></label><label>Evidence URL<input value={manual.url} onChange={event => setManual({ ...manual, url: event.target.value })} placeholder="https://raw.githubusercontent.com/..." /></label><label>Evidence SHA-256<input value={manual.digest} onChange={event => setManual({ ...manual, digest: event.target.value })} placeholder="64 hex characters" /></label></div><div className="lab-actions"><button className="btn btn-ghost" disabled={!manual.taskId || verifying} onClick={() => { void loadTask(manual.taskId).catch(cause => setError(studioError(cause))); }}>Load fixed task</button><button className="btn btn-ghost" disabled={!manual.url || manualDigesting || verifying} onClick={digestEvidence}>{manualDigesting ? 'Fetching evidence…' : 'Fetch and hash evidence'}</button><button className="btn btn-primary" disabled={!manualReady || verifying} onClick={verifyOnchain}>{verifying ? 'Verifying…' : 'Submit and verify'}</button></div>
      {task && <div className="lab-message"><strong>{task.status} · {task.task_id}</strong><p>Requester: <code>{task.requester}</code></p><p>Assigned agent: <code>{task.agent}</code></p><p>Claim: {task.claim}</p><p>Criterion: {task.criterion}</p></div>}
      <p className="lab-message">A successful verdict issues a nontransferable credential for this task and increments the agent’s verified work count. Separate wallets alone do not prove independent real-world identities.</p></> : <><h3>Legacy deployment</h3><p>This deployment used submitter-defined criteria. New task creation and credential issuance require the v3 contract deployment. Existing receipts remain inspectable below.</p></>}
      {(verifying || pendingSubmitTx || pendingVerifyTx) && <p className="lab-message" role="status">{message}</p>}
      {pendingSubmitTx && <p className="tx-link">Pending submit transaction: <a href={`${explorer}/tx/${pendingSubmitTx}`} target="_blank" rel="noreferrer">{pendingSubmitTx}</a></p>}
      {pendingVerifyTx && <p className="tx-link">Pending verify transaction: <a href={`${explorer}/tx/${pendingVerifyTx}`} target="_blank" rel="noreferrer">{pendingVerifyTx}</a></p>}
      {error && <p className="lab-error" role="alert">{error}</p>}
      <div className="lab-actions lookup-row"><label>Onchain proof ID<input value={lookupId} onChange={event => setLookupId(event.target.value)} placeholder="7" inputMode="numeric" /></label><button className="btn btn-primary" disabled={lookingUp || checking || verifying || !lookupId.trim()} onClick={lookupProof}>{lookingUp ? 'Looking up…' : 'Look up proof'}</button></div></section>
    {upgraded && <section className="manual-proof card"><h3>Verified work directory</h3><p>Only agents with a SUCCESS proof and a matching onchain task credential appear here. Showing the latest 50 proofs.</p>{verifiedWork.length ? <ul>{verifiedWork.map(item => <li key={item.proofId}><button className="btn btn-ghost" onClick={() => { setLookupId(String(item.proofId)); void readOnchainProof(item.proofId).then(found => { setExamples(items => [...items.filter(existing => existing.id !== found.id), found]); setSelected(found.id); }).catch(cause => setError(studioError(cause))); }}>Proof #{item.proofId} · {item.taskId}</button> Agent <code>{item.agent}</code></li>)}</ul> : <p>No eligible agents in the latest 50 proofs.</p>}</section>}
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
          {proof.requester && <><dt>Requester</dt><dd><a href={`${explorer}/address/${proof.requester}`} target="_blank" rel="noreferrer">{proof.requester}</a></dd><dt>Task</dt><dd>{proof.task_id}</dd><dt>Credential</dt><dd>{entry.credentialProofId === undefined ? 'Recheck onchain' : entry.credentialProofId === entry.proofId ? `Issued · proof #${entry.proofId}` : 'Not issued'}</dd><dt>Verified work count</dt><dd>{entry.verifiedCount ?? 'Recheck onchain'}</dd></>}
          <dt>Consensus</dt><dd>{votes.length ? `${votes.filter(v => v === 'agree').length} agree / ${votes.length} assigned; ${votes.filter(v => v === 'idle').length} idle` : 'See transaction receipt'}</dd>
          <dt>Last checked</dt><dd>{entry.checkedAt ? new Date(entry.checkedAt).toLocaleString() : 'Not checked in this session'}</dd>
        </dl></> : <p>This example has not finalized.</p>}
        <button className="btn btn-primary" disabled={checking || loading || verifying || !proof} onClick={recheck}>{checking ? 'Checking Studio Next…' : 'Recheck onchain'}</button>
        <p className="lab-message" role="status">{message}</p>{error && <p className="lab-error" role="alert">{error}</p>}
      </article></div>
    <p className="lab-footnote">Agent names describe local programs, not independently authenticated identities. The on-chain judgment covers the claim and evidence only.</p>
  </div>;
}

const labSlot = document.getElementById('genlayer-slot');
if (labSlot) createRoot(labSlot).render(<AgentLab />);
