import { readdirSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);
const sourceMaps = readdirSync(dist, { recursive: true }).filter(file => file.endsWith('.map'));
if (sourceMaps.length) throw new Error(`Production output contains standalone source maps: ${sourceMaps.join(', ')}`);
console.log('No standalone source maps in the production bundle.');
