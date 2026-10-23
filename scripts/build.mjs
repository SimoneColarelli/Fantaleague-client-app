import { mkdir, copyFile, cp } from 'node:fs/promises';
import database from '../data.json' with { type: 'json' };

const names = new Set();
for (const player of database.giocatori) {
    if (typeof player.nome !== 'string' || !player.nome.length || names.has(player.nome)) {
        throw new Error('Every player must have a non-empty unique name before deployment.');
    }
    names.add(player.nome);
}

await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'data.json', 'regolamento.md', 'manifest.webmanifest',
    'pwa.js', 'sw.js', 'admin.html', 'admin.js', 'admin.css']) {
    await copyFile(file, `dist/${file}`);
}
await cp('image', 'dist/image', { recursive: true });
