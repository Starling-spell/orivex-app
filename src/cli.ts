function shellArg(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function cliPayload(contract: string, fields: { taskId: string; agent: string; reference: string; claim: string; criterion: string; url: string; digest: string }) {
  const taskArgs = [fields.taskId, fields.agent, fields.claim, fields.criterion].map(shellArg).join(' ');
  const proofArgs = [fields.taskId, fields.reference, fields.url, fields.digest].map(shellArg).join(' ');
  return [
    'npx --no-install genlayer network set studio-dev',
    '# Requester wallet:',
    `npx --no-install genlayer write ${contract} create_task --args ${taskArgs}`,
    '# Switch to the assigned agent wallet:',
    `npx --no-install genlayer write ${contract} submit_proof --args ${proofArgs}`,
    `npx --no-install genlayer write ${contract} verify_proof --args <PROOF_ID>`,
  ].join('\n');
}
