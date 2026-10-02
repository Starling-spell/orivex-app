import { expect, it } from 'vitest';
import { cliPayload } from './cli';

it('builds submit and verify commands on the lab page instead of sending users to the guide', () => {
  const commands = cliPayload('0xd8571C4605C3Fb63B02b75614a53d753656e66a1', {
    taskId: 'audit-001',
    agent: '0x8B9bb0Bd9FB3Ba549036BdE0fB1971a5BD9C4F41',
    reference: 'orivex:manual:ownership-review:2026-09-14',
    claim: 'The transferOwnership function can only be called by the current owner.',
    criterion: 'SUCCESS if transferOwnership is restricted to the current owner.',
    url: 'https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/c64a1edb67b6e3f4a15cca8909c9482ad33a02b0/contracts/access/Ownable.sol',
    digest: '38578bd71c0a909840e67202db527cc6b4e6b437e0f39f0c909da32c1e30cb81',
  });
  expect(commands).toContain('create_task --args "audit-001"');
  expect(commands).toContain('Switch to the assigned agent wallet');
  expect(commands).toContain('npx --no-install genlayer write 0xd8571C4605C3Fb63B02b75614a53d753656e66a1 submit_proof --args');
  expect(commands).toContain('"orivex:manual:ownership-review:2026-09-14"');
  expect(commands).toContain('verify_proof --args <PROOF_ID>');
  expect(commands).not.toContain('genlayer contract write');
  expect(commands).not.toContain('/docs/guide.html');
});
