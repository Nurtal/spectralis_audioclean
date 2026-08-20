// Copie le module RNNoise (glue ESM + binaire WASM) dans public/wasm/rnnoise/.
// Le chargement se fait à l'exécution depuis cette URL publique : rien de tout
// cela n'entre dans le bundle, et le .wasm n'est demandé qu'au premier usage.
import { copyFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'node_modules/@jitsi/rnnoise-wasm/dist');
const to = resolve(root, 'public/wasm/rnnoise');

try {
  await access(from);
} catch {
  console.warn('[rnnoise] @jitsi/rnnoise-wasm absent — le site tournera en repli spectral.');
  process.exit(0);
}

await mkdir(to, { recursive: true });
for (const f of ['rnnoise.js', 'rnnoise.wasm']) {
  await copyFile(resolve(from, f), resolve(to, f));
}
await copyFile(
  resolve(root, 'node_modules/@jitsi/rnnoise-wasm/LICENSE'),
  resolve(to, 'LICENSE'),
);
console.log('[rnnoise] copié dans public/wasm/rnnoise/');
