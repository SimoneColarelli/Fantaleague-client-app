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

// Netlify Blobs decodes percent-encoded keys server-side, so a key written as
// "player-name/Santos%20A." is listed back as "player-name/Santos A.".
// Compare decoded names so both forms match the player.
function keyName(key, prefix) {
    const raw = key.slice(prefix.length);
    try { return decodeURIComponent(raw); } catch { return raw; }
}

export async function readDatabase(store, source = database) {
    const prefix = 'player-name/';
    const named = new Map();
    for (const [key, convocato] of await readOverrides(store, prefix)) named.set(keyName(key, prefix), convocato);
    return {
        ...source,
        giocatori: source.giocatori.map(player => {
            if (named.has(player.nome)) return { ...player, convocato: named.get(player.nome) };
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
