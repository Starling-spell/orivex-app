import './wallet.css';

function fallback(id: string, marker: string, html: string) {
  return window.setTimeout(() => {
    const slot = document.getElementById(id);
    if (slot?.textContent?.includes(marker)) slot.innerHTML = html;
  }, 8000);
}

const walletTimer = fallback(
  'wallet-slot',
  'Loading wallet',
  '<button class="wallet-btn" onclick="window.location.reload()">Retry wallet connection</button>',
);
const labTimer = fallback(
  'genlayer-slot',
  'Loading GenLayer',
  '<p>Agent Lab is taking too long to load. <a href="/docs/guide.html">Open the verification guide ↗</a></p>',
);

void import('../app.js').catch(error => console.error('Legacy UI failed to initialize', error));
void import('./genlayer').then(() => window.clearTimeout(labTimer)).catch(() => {
  const slot = document.getElementById('genlayer-slot');
  if (slot) slot.textContent = 'Agent lab could not load. Reload the page or run npm run genlayer:check in the terminal.';
});
void import('./wallet').then(module => module.mountWallet()).then(() => window.clearTimeout(walletTimer)).catch(() => {
  const slot = document.getElementById('wallet-slot');
  if (slot) slot.innerHTML = '<button class="wallet-btn" onclick="window.location.reload()">Retry wallet connection</button>';
});
