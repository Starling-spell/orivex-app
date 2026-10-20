import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant, type Hash } from 'genlayer-js/types';
import { studioWalletWriter, studioFees, txHash } from './studio';
import { validateReceipt } from './proof';

type BoardTask = { task_id: string; claim: string; criterion: string; requester: string;
  agent: string; status: string; credential_issuer: string; minimum_verified: number;
  claim_deadline: number; board_task: boolean; proof_id: number };
type Page = { total: number; tasks: BoardTask[] };
type Eligibility = { eligible: boolean; reason: string; verified_count: number; minimum_verified: number };
type Action = 'post_task' | 'claim_task' | 'cancel_task';
type Pending = { hash: Hash; account: string; action: Action; taskId: string };
const explorer = 'https://explorer-studio-dev.genlayer.com';
const isAddress = (value: string) => /^0x[0-9a-f]{40}$/i.test(value);
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const reasons: Record<string, string> = {
  ELIGIBLE: 'You meet this task’s qualification policy.',
  CREDENTIAL_REQUIRED: 'Complete more successful tasks for the specified issuer to claim this work.',
  REQUESTER_CANNOT_CLAIM: 'The requester cannot claim their own task.',
  NOT_AVAILABLE: 'This task has already been claimed, cancelled or completed.',
  EXPIRED: 'The deadline for claiming this task has passed.',
};

export function parseBoardPage(raw: unknown): Page {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || !Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.tasks)
      || value.tasks.length > 20 || value.tasks.length > value.total) throw new Error('Invalid task board response.');
  for (const task of value.tasks) {
    if (!task.board_task || typeof task.task_id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(task.task_id)
        || typeof task.claim !== 'string' || typeof task.criterion !== 'string'
        || !isAddress(task.requester) || !isAddress(task.credential_issuer)
        || !['AVAILABLE', 'OPEN', 'SUBMITTED', 'SUCCESS', 'FAILED', 'INCONCLUSIVE', 'CANCELLED', 'EXPIRED'].includes(task.status)
        || !Number.isSafeInteger(task.minimum_verified) || task.minimum_verified < 0 || task.minimum_verified > 1000
        || !Number.isSafeInteger(task.claim_deadline) || task.claim_deadline < 1
        || (!['AVAILABLE', 'EXPIRED', 'CANCELLED'].includes(task.status) && !isAddress(task.agent))) {
      throw new Error('Invalid onchain task or qualification policy.');
    }
  }
  return value;
}

function parseEligibility(raw: unknown): Eligibility {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value.eligible !== 'boolean' || !Object.hasOwn(reasons, value.reason)
      || value.eligible !== (value.reason === 'ELIGIBLE') || !Number.isSafeInteger(value.verified_count)
      || value.verified_count < 0 || !Number.isSafeInteger(value.minimum_verified) || value.minimum_verified < 0) {
    throw new Error('Could not verify eligibility from finalized contract state.');
  }
  if (value.eligible && value.verified_count < value.minimum_verified) throw new Error('Invalid eligibility threshold.');
  return value;
}

export function TaskBoard({ address, onUseTask }: {
  address: `0x${string}`; onUseTask: (taskId: string) => Promise<void>;
}) {
  const [client] = useState(() => createClient({ chain: studioDevnet }));
  const [page, setPage] = useState<Page>({ total: 0, tasks: [] });
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const [account, setAccount] = useState('');
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [posting, setPosting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({ id: '', claim: '', criterion: '', issuer: '', minimum: '0', deadline: '' });
  const lock = useRef(false);
  const storageKey = `orivex:board:61997:${address.toLowerCase()}:pending`;
  const working = loading || checking || posting || claiming || cancelling || resuming;
  const selected = page.tasks.find(task => task.task_id === selectedId) ?? page.tasks[0];
  const read = (functionName: string, args: any[]) => client.readContract({
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL, address, functionName, args,
  });
  function readPending(): Pending | null {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return null;
    const value = JSON.parse(saved);
    if (!/^0x[0-9a-f]{64}$/i.test(value.hash) || !isAddress(value.account)
        || !['post_task', 'claim_task', 'cancel_task'].includes(value.action) || typeof value.taskId !== 'string') {
      throw new Error('The saved transaction record is invalid. Inspect it before sending another transaction.');
    }
    return value;
  }
  async function refresh(nextOffset = offset) {
    setLoading(true);
    try {
      if (Number(await read('get_protocol_version', [])) !== 4) throw new Error('This deployment does not support the task board.');
      const next = parseBoardPage(await read('list_board_tasks', [nextOffset, 20]));
      setPage(next); setOffset(nextOffset); setEligibility(null); setHasLoaded(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load the task board.'); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    try { setPending(readPending()); } catch (cause) { setError(String(cause)); }
    void refresh(0);
  }, [address]);
  async function check() {
    if (lock.current || !selected) return;
    lock.current = true; setChecking(true); setError('');
    try {
      const wallet = await studioWalletWriter(); setAccount(wallet.account);
      const result = parseEligibility(await read('get_eligibility', [selected.task_id, wallet.account]));
      if (result.minimum_verified !== selected.minimum_verified) throw new Error('Eligibility policy changed. Refresh the task board.');
      setEligibility(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not check your wallet.'); }
    finally { lock.current = false; setChecking(false); }
  }
  async function confirm(record: Pending) {
    setMessage('Waiting for finalized validator consensus. Keep this transaction link if you leave the page.');
    const receipt = await client.waitForTransactionReceipt({ hash: record.hash, waitUntil: 'finalized',
      fullTransaction: true, interval: 5000, retries: 180 });
    if (receipt.statusName === 'FINALIZED' && receipt.txExecutionResultName === 'FINISHED_WITH_ERROR') {
      if (receipt.to_address?.toLowerCase() !== address.toLowerCase()
          || receipt.from_address?.toLowerCase() !== record.account.toLowerCase()) throw new Error('Receipt identity mismatch.');
      localStorage.removeItem(storageKey); setPending(null);
      throw new Error('The contract rejected this action. Refresh the task and check its current eligibility.');
    }
    validateReceipt(receipt, address, record.account);
    localStorage.removeItem(storageKey); setPending(null); setAccount(record.account);
    await refresh(0); setSelectedId(record.taskId);
    setMessage(record.action === 'claim_task' ? 'Assignment finalized. Continue to evidence submission below.'
      : record.action === 'post_task' ? 'Task published. Its terms and qualification policy are fixed.' : 'Unclaimed task cancelled.');
  }
  async function transact(action: Action, taskId: string, args: (wallet: string) => any[]) {
    if (lock.current) return;
    lock.current = true; setError('');
    const setBusy = action === 'post_task' ? setPosting : action === 'claim_task' ? setClaiming : setCancelling;
    setBusy(true);
    try {
      const previous = readPending();
      if (previous) { setPending(previous); throw new Error('Check the saved pending transaction before sending another.'); }
      const wallet = await studioWalletWriter(); setAccount(wallet.account);
      setMessage('Review the Studio Next transaction in your wallet.');
      const hash = txHash(await wallet.client.writeContract({ address, functionName: action, args: args(wallet.account),
        value: 0n, leaderOnly: false, fees: await studioFees(wallet.client) }));
      const record = { hash, account: wallet.account, action, taskId };
      setPending(record);
      localStorage.setItem(storageKey, JSON.stringify(record));
      await confirm(record);
    } catch (cause) { setError(cause instanceof Error ? cause.message.slice(0, 500) : 'The task transaction did not finish.'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function resume() {
    if (lock.current || !pending) return;
    lock.current = true; setResuming(true); setError('');
    try { await confirm(pending); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Consensus is still pending.'); }
    finally { lock.current = false; setResuming(false); }
  }
  function publish(event: FormEvent) {
    event.preventDefault();
    const deadline = Math.floor(Date.parse(draft.deadline) / 1000);
    const minimum = Number(draft.minimum);
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(draft.id) || !draft.claim.trim() || !draft.criterion.trim()
        || draft.claim.length > 2048 || draft.criterion.length > 2048
        || !Number.isSafeInteger(minimum) || minimum < 0 || minimum > 1000
        || !Number.isSafeInteger(deadline) || deadline <= Date.now() / 1000 || deadline > Date.now() / 1000 + 30 * 86400
        || (draft.issuer && !isAddress(draft.issuer))) {
      setError('Enter valid task terms, an issuer address, a 0–1000 threshold and a claim deadline within 30 days.'); return;
    }
    void transact('post_task', draft.id, wallet => [draft.id, draft.claim.trim(), draft.criterion.trim(), draft.issuer || wallet, minimum, deadline]);
  }
  return <section className="task-board" id="task-board" aria-labelledby="board-title">
    <div className="lab-heading"><div><h3 id="board-title">Find your next verified task.</h3>
      <p>Open work with qualifications enforced by GenLayer. Successful work for a trusted issuer unlocks access.</p></div>
      <button className="btn btn-ghost" disabled={working} onClick={() => { setError(''); void refresh(); }}>{loading ? 'Reading board…' : 'Refresh task board'}</button></div>
    <p className="board-scope">Live Studio Next tasks · No payments or token rewards · <a href="/docs/guide.html#task-board">Task board guide</a></p>
    <div className="board-layout"><div className="board-list" aria-label="Onchain task list">
      {hasLoaded && !loading && !page.tasks.length && <p>No tasks posted yet. Publish the first task below.</p>}
      {page.tasks.map(task => <button key={task.task_id} className="board-row" disabled={working}
        aria-pressed={selected?.task_id === task.task_id} onClick={() => { setSelectedId(task.task_id); setEligibility(null); }}>
        <span className={`proof-status status-${task.status.toLowerCase()}`}>{task.status === 'OPEN' ? 'CLAIMED' : task.status}</span>
        <strong>{task.claim}</strong><small>{task.task_id}</small>
        <span>{task.minimum_verified === 0 ? 'Open to new agents' : `${task.minimum_verified} issuer-verified task${task.minimum_verified === 1 ? '' : 's'} required`}</span>
      </button>)}
      <div className="lab-actions"><button className="btn btn-ghost" disabled={working || offset === 0} onClick={() => void refresh(Math.max(0, offset - 20))}>Newer tasks</button>
        <button className="btn btn-ghost" disabled={working || offset + 20 >= page.total} onClick={() => void refresh(offset + 20)}>Older tasks</button></div>
    </div>{selected && <article className="board-detail" aria-label="Selected task">
      <h4>{selected.claim}</h4><p>{selected.criterion}</p>
      <dl><dt>Requester</dt><dd><a href={`${explorer}/address/${selected.requester}`} target="_blank" rel="noreferrer" title={selected.requester}>{selected.requester}</a></dd>
        <dt>Trusted credential issuer</dt><dd><a href={`${explorer}/address/${selected.credential_issuer}`} target="_blank" rel="noreferrer">{selected.credential_issuer}</a></dd>
        <dt>Required successful tasks from this issuer</dt><dd>{selected.minimum_verified}</dd>
        <dt>Claim by</dt><dd>{new Date(selected.claim_deadline * 1000).toLocaleString()} · your local time</dd>
        {selected.agent && <><dt>Assigned agent</dt><dd><a href={`${explorer}/address/${selected.agent}`} target="_blank" rel="noreferrer">{selected.agent}</a></dd></>}</dl>
      <div className="lab-actions"><button className="btn btn-ghost" disabled={working || Boolean(pending) || selected.status !== 'AVAILABLE'} onClick={check}>{checking ? 'Checking wallet…' : 'Connect wallet / check eligibility'}</button>
        {selected.status === 'AVAILABLE' && <button className="btn btn-primary" disabled={working || Boolean(pending) || !eligibility?.eligible}
          onClick={() => void transact('claim_task', selected.task_id, () => [selected.task_id])}>{claiming ? 'Claiming task…' : 'Claim this task'}</button>}
        {account.toLowerCase() === selected.requester.toLowerCase() && selected.status === 'AVAILABLE' && <button className="btn btn-ghost" disabled={working || Boolean(pending)}
          onClick={() => void transact('cancel_task', selected.task_id, () => [selected.task_id])}>{cancelling ? 'Cancelling…' : 'Cancel unclaimed task'}</button>}
        {['OPEN', 'SUBMITTED'].includes(selected.status) && <button className="btn btn-primary" disabled={working || Boolean(pending)} onClick={() => {
          void onUseTask(selected.task_id).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not load the claimed task.'));
        }}>Continue to evidence</button>}</div>
      {eligibility && <p role="status">{reasons[eligibility.reason]} Your issuer-specific count: <strong>{eligibility.verified_count} / {eligibility.minimum_verified}</strong>.</p>}
      {account && <p>Checked wallet: <a href={`${explorer}/address/${account}`} title={account} target="_blank" rel="noreferrer">{short(account)}</a></p>}
    </article>}</div>
    <details><summary>Post an open task</summary><p>Fix the terms before an agent claims. Cancellation is possible only while work remains unclaimed. Claim deadlines do not expire existing assignments.</p>
      <form onSubmit={publish}><div className="manual-grid">
        <label>Board task ID<input required maxLength={128} value={draft.id} onChange={event => setDraft({ ...draft, id: event.target.value })} /></label>
        <label>Claim deadline<input required type="datetime-local" value={draft.deadline} onChange={event => setDraft({ ...draft, deadline: event.target.value })} /></label>
        <label>Task claim<textarea aria-label="Task claim" required maxLength={2048} value={draft.claim} onChange={event => setDraft({ ...draft, claim: event.target.value })} /></label>
        <label>Task acceptance criterion<textarea aria-label="Task acceptance criterion" required maxLength={2048} value={draft.criterion} onChange={event => setDraft({ ...draft, criterion: event.target.value })} /></label>
        <label>Trusted issuer address<input placeholder="Defaults to connected requester" value={draft.issuer} onChange={event => setDraft({ ...draft, issuer: event.target.value.trim() })} /></label>
        <label>Required issuer-verified tasks<input required type="number" min="0" max="1000" step="1" value={draft.minimum} onChange={event => setDraft({ ...draft, minimum: event.target.value })} /></label>
      </div><div className="lab-actions"><button type="button" className="btn btn-ghost" disabled={working} onClick={() => setDraft({ ...draft,
        id: `orivex:board:${crypto.randomUUID()}`, claim: 'The document permits software redistribution with its notices preserved.',
        criterion: 'SUCCESS only if the pinned license grants distribution rights and requires preserving the copyright and permission notice.',
        deadline: new Date(Date.now() + 7 * 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) })}>Use license task template</button>
        <button type="submit" className="btn btn-primary" disabled={working || Boolean(pending)}>{posting ? 'Publishing task…' : 'Publish open task'}</button></div></form>
    </details>
    {message && <p className="lab-message" role="status">{message}</p>}
    {pending && <div className="tx-link"><a href={`${explorer}/tx/${pending.hash}`} target="_blank" rel="noreferrer">Inspect saved transaction {short(pending.hash)}</a>
      <button className="btn btn-ghost" disabled={working} onClick={resume}>{resuming ? 'Checking consensus…' : 'Check pending transaction'}</button></div>}
    {error && <p className="lab-error" role="alert">{error}</p>}
    <p className="board-scope">Counts include only SUCCESS proofs in this deployment from the chosen issuer. Other issuers and historical v3 credentials cannot satisfy this policy. Distinct wallets do not prove independent owners.</p>
  </section>;
}
