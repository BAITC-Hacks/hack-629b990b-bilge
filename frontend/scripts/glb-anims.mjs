// Prints GLB animation and node names (reads the JSON chunk without three.js).
import { readFileSync, writeFileSync } from 'node:fs';
const files = process.argv.slice(2);
let out = '';
for (const f of files) {
  const b = readFileSync(f);
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
  out += `${f}\n  anims: ${(json.animations ?? []).map((a) => a.name).join(', ')}\n  nodes: ${(json.nodes ?? []).map((n) => n.name).join(', ')}\n`;
}
writeFileSync(new URL('../glb-anims.txt', import.meta.url), out);
console.log('ok');
