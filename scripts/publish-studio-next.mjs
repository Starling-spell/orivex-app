import {copyFileSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const manifest=JSON.parse(readFileSync('deployments/genlayer-studio-next.json','utf8'));
if(manifest.chainId!==61997 || !manifest.usableForProofs || manifest.smoke.status!=='SUCCESS')throw new Error('Require verified Studio Next deployment');
copyFileSync('deployments/genlayer-studio-next.json','public/genlayer-studio-next.json');
copyFileSync('deployments/genlayer-next-examples.json','public/genlayer-next-examples.json');
mkdirSync('public/docs',{recursive:true});
for(const file of ['STUDIO-NEXT.md','HACKATHON.md','DEMO.md','RESULTS.md','guide.html','TASK-BOARD.md'])copyFileSync('docs/'+file,'public/docs/'+file);
if(manifest.protocolVersion===4){
  const report=JSON.parse(readFileSync('deployments/task-board-studio-next.json','utf8'));
  if(report.address!==manifest.address||report.sourceSha256!==manifest.sourceSha256)throw new Error('Task board evidence mismatch');
  copyFileSync('deployments/task-board-studio-next.json','public/task-board-studio-next.json');
  mkdirSync('public/archive',{recursive:true});
  copyFileSync('deployments/archive/genlayer-studio-next-v3.json','public/archive/genlayer-studio-next-v3.json');
  mkdirSync('public/receipts',{recursive:true});
  for(const [name,receipt] of Object.entries(report.transactions))writeFileSync(`public/receipts/${receipt.hash}.json`,JSON.stringify({kind:'CONSENSUS_RECEIPT_SUMMARY',chainId:61997,name,...receipt},null,2)+'\n');
}
console.log('Published Studio Next proof and guide; historical artifacts stay in archive.');
