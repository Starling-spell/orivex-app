import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const m=JSON.parse(readFileSync('deployments/genlayer-studio-next.json','utf8'));
const client=createClient({chain:studioDevnet});
if(m.chainId!==61997 || Number(await client.getChainId())!==61997)throw new Error('Wrong Lab chain');
const hash=x=>createHash('sha256').update(x).digest('hex');
if(hash(await client.getContractCode(m.address))!==m.sourceSha256)throw new Error('Source mismatch');
for(const tx of [m.deploymentTx,m.smoke.createTaskTx,m.smoke.submitTx,m.smoke.verifyTx].filter(Boolean)){
 const r=await client.getTransaction({hash:tx});
 if(r.statusName!=='FINALIZED'||r.txExecutionResultName!=='FINISHED_WITH_RETURN')throw new Error('Unsuccessful receipt '+tx);
}
const proof=JSON.parse(String(await client.readContract({address:m.address,functionName:'get_proof',args:[m.smoke.proof.proof_id],transactionHashVariant:TransactionHashVariant.LATEST_FINAL})));
const {proof_hash,...fields}=proof;
const canonical=JSON.stringify(Object.fromEntries(Object.entries(fields).sort(([a],[b])=>a<b?-1:a>b?1:0))).replace(/[\u007f-\uffff]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
if(proof.chain_id!==61997||proof.contract_address.toLowerCase()!==m.address.toLowerCase()||proof.status!=='SUCCESS'||hash(canonical)!==proof_hash)throw new Error('Proof mismatch');
if(proof.schema_version===3){
 const task=JSON.parse(String(await client.readContract({address:m.address,functionName:'get_task',args:[proof.task_id],transactionHashVariant:TransactionHashVariant.LATEST_FINAL})));
 const credential=Number(await client.readContract({address:m.address,functionName:'get_credential',args:[proof.submitter,proof.task_id],transactionHashVariant:TransactionHashVariant.LATEST_FINAL}));
 const count=Number(await client.readContract({address:m.address,functionName:'get_verified_count',args:[proof.submitter],transactionHashVariant:TransactionHashVariant.LATEST_FINAL}));
 if(task.requester!==proof.requester||task.agent!==proof.submitter||task.status!=='SUCCESS'||credential!==proof.proof_id||count<1)throw new Error('Task credential mismatch');
}
console.log(JSON.stringify({chainId:61997,address:m.address,status:proof.status,proofHash:proof_hash,credential:proof.schema_version===3,verified:true}));
