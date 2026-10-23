import database from '../../data.json' with { type: 'json' };

export function playerKey(nome) {
    return `player-name/${encodeURIComponent(nome)}`;
}

export function updatePlayer(body) {
    if (!body || Object.keys(body).length !== 2 || typeof body.convocato !== 'boolean') return null;
    // Accept IDs from already-open older admin pages, but always persist by name.
    let matching = [];
    if (typeof body.nome === 'string') matching = database.giocatori.filter(player => player.nome === body.nome);
    else if (Number.isSafeInteger(body.id)) matching = database.giocatori.filter(player => player.id === body.id);
    if (matching.length !== 1 || matching[0].deleted) return null;
    const player = matching[0];
    return database.giocatori.filter(candidate => candidate.nome === player.nome).length === 1 ? player : null;
}

export function validUpdate(body) {
    return !!updatePlayer(body);
}

async function readOverrides(store, prefix) {
    const overrides = new Map();
    for await (const page of store.list({ prefix, paginate: true })) {
        await Promise.all(page.blobs.map(async blob => {
            const value = await store.get(blob.key, { type: 'json' });
            if (value && typeof value.convocato === 'boolean') {
                overrides.set(blob.key, value.convocato);
            }
        }));
    }
    return overrides;
}

export async function readDatabase(store, source = database) {
    const named = await readOverrides(store, 'player-name/');
    return {
        ...source,
        giocatori: source.giocatori.map(player => {
            const key = playerKey(player.nome);
            if (named.has(key)) return { ...player, convocato: named.get(key) };
            return { ...player };
        })
    };
}

// Copy existing overrides without deleting legacy records or replacing newer
// name-based saves. Run once after deploying the name-based write endpoint.
export async function migrateLegacyOverrides(store) {
    const legacy = await readOverrides(store, 'player/');
    let copied = 0;
    let skipped = 0;
    for (const [key, convocato] of legacy) {
        const player = database.giocatori.find(candidate => `player/${candidate.id}` === key);
        if (!player || database.giocatori.filter(candidate => candidate.nome === player.nome).length !== 1) {
            skipped++;
            continue;
        }
        const result = await store.setJSON(playerKey(player.nome), { convocato }, { onlyIfNew: true });
        if (result.modified) copied++;
        else skipped++;
    }
    return { copied, skipped };
}
