import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import deploy from "../../deploy/01-proof.js";

const root = process.cwd();
const source = readFileSync("contracts/OrivexProofRegistry.py", "utf8");
const previous = JSON.parse(readFileSync("deployments/genlayer-studionet.json", "utf8"));
const evidence = Buffer.from('MIT License test fixture');
previous.smoke.proof.evidence_sha256 = createHash('sha256').update(evidence).digest('hex');
mkdirSync(".genlayer-local", { recursive: true });

test("refuses a fee-bearing network before fetching evidence or deploying", async () => {
  await assert.rejects(deploy({ getChainId: async () => 8453 }), /studio-dev/);
});

for (const execution of ["ERROR", "SUCCESS"]) {
  test(`finalized ${execution} is handled independently from lifecycle status`, async () => {
    const directory = mkdtempSync(resolve(root, ".genlayer-local/deploy-check-"));
    const originalFetch = globalThis.fetch;
    let writes = 0;
    try {
      process.chdir(directory);
      mkdirSync("contracts");
      writeFileSync("contracts/OrivexProofRegistry.py", source);
      mkdirSync("deployments"); mkdirSync("public");
      writeFileSync("deployments/genlayer-studionet.json", JSON.stringify(previous));
      mkdirSync("artifacts/genlayer-next-v3", { recursive: true });
      writeFileSync("artifacts/genlayer-next-v3/journal.json", JSON.stringify({ chainId: 61997,
        sourceSha256: createHash('sha256').update(source).digest('hex'), createTaskTx: '0x' + 'a'.repeat(64) }));
      globalThis.fetch = async () => new Response(evidence);
      const address = "0x" + "1".repeat(40);
      const requester = '0x' + '4'.repeat(40);
      const proof = { chain_id:61997, claim:"A test claim", proof_id:1, schema_version:3, requester, status:"SUCCESS" };
      const proof_hash = createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(proof).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)))).digest("hex");
      const client = {
        getChainId: async () => 61997,
        estimateTransactionFees: async () => ({ distribution:{ test:true }, feeValue:123n }),
        deployContract: async () => "0x" + "2".repeat(64),
        waitForTransactionReceipt: async () => ({
          statusName: "FINALIZED", txExecutionResultName: execution === 'ERROR' ? 'ERROR' : 'FINISHED_WITH_RETURN', data: { contract_address: address },
          from_address: "0x" + "3".repeat(40),
          consensus_data: { leader_receipt: [{ execution_result: execution }] },
        }),
        getContractCode: async () => source,
        getContractSchema: async () => ({ methods: { submit_proof: {}, verify_proof: {} } }),
        writeContract: async ({ fees }) => { assert.equal(fees.feeValue,123n); writes++; return "0x" + String(writes + 3).repeat(64); },
        readContract: async ({ functionName }) => functionName === 'get_task' ? JSON.stringify({ agent:'0x' + '3'.repeat(40), requester, status:'OPEN' })
          : ['get_proof_id','get_credential','get_verified_count'].includes(functionName) ? 1 : JSON.stringify({ ...proof, proof_hash }),
      };
      if (execution === "ERROR") {
        await assert.rejects(deploy(client), /execution failed/);
        assert.equal(writes, 0, "failed deployment cannot submit or verify a proof");
      } else {
        await deploy(client);
        const manifest = JSON.parse(readFileSync("deployments/genlayer-studio-next.json", "utf8"));
        assert.equal(writes, 2);
        assert.equal(manifest.usableForProofs, true);
        assert.equal(manifest.smoke.proof.proof_hash, proof_hash);
      }
    } finally {
      globalThis.fetch = originalFetch;
      process.chdir(root);
    }
  });
}
