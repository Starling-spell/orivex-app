export type Proof = {
  schema_version: number; domain: string; chain_id: number; contract_address: string;
  proof_id: number; submitter: string; reference_id: string; claim: string; criterion: string;
  requester?: string; task_id?: string;
  evidence_url: string; evidence_sha256: string; status: string; proof_hash: string;
};

// Matches Python json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=True).
export function canonicalProof(proof: Proof): string {
  const { proof_hash: _hash, ...fields } = proof;
  const sorted = Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(sorted).replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function validateProof(proof: Proof, address: string, id: number): void {
  const legacy = proof.schema_version === 2 && proof.domain === 'orivex.evidence-proof.v2';
  const tasked = proof.schema_version === 3 && proof.domain === 'orivex.evidence-proof.v3'
    && /^0x[0-9a-f]{40}$/i.test(proof.requester ?? '') && Boolean(proof.task_id?.trim())
    && proof.requester?.toLowerCase() !== proof.submitter?.toLowerCase();
  if ((!legacy && !tasked) || proof.chain_id !== 61997
      || proof.contract_address?.toLowerCase() !== address.toLowerCase() || proof.proof_id !== id
      || !Number.isSafeInteger(id) || id < 1
      || !/^0x[0-9a-f]{40}$/i.test(proof.submitter)
      || !/^[0-9a-f]{64}$/.test(proof.evidence_sha256)
      || !/^[0-9a-f]{64}$/.test(proof.proof_hash)
      || !['SUCCESS', 'FAILED', 'INCONCLUSIVE'].includes(proof.status)) {
    throw new Error('Proof domain, identity, or final result is invalid.');
  }
}

export function validateReceipt(receipt: any, address: string, sender?: string): void {
  const leaders = receipt.consensus_data?.leader_receipt;
  if (receipt.statusName !== 'FINALIZED' || receipt.txExecutionResultName !== 'FINISHED_WITH_RETURN'
      || receipt.leader_only !== false || receipt.result_name !== 'MAJORITY_AGREE'
      || receipt.to_address?.toLowerCase() !== address.toLowerCase()
      || (sender && receipt.from_address?.toLowerCase() !== sender.toLowerCase())
      || !Array.isArray(leaders) || !leaders.length || !leaders.some((item: any) => item.mode === 'leader' && item.execution_result === 'SUCCESS')) {
    throw new Error('Receipt must have finalized successful consensus for this contract and submitter.');
  }
}
