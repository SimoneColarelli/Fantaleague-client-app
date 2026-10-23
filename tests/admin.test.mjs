import test from 'node:test';
import assert from 'node:assert/strict';
import database from '../data.json' with { type: 'json' };
import { authenticated, checkPassword, sessionCookie, sameOrigin, MAX_AGE } from '../netlify/lib/auth.mjs';
import { readDatabase, validUpdate, playerKey, migrateLegacyOverrides } from '../netlify/lib/players.mjs';
import sessionHandler from '../netlify/functions/admin-session.mjs';
import playersHandler, { createHandler } from '../netlify/functions/players.mjs';

process.env.ADMIN_PASSWORD = 'test-password-with-16-characters';
process.env.ADMIN_SESSION_SECRET = 'test-session-secret-with-more-than-32-characters';
const origin = 'https://example.netlify.app';
const request = (path, options = {}) => new Request(`${origin}/api/${path}`, options);
const cookie = sessionCookie().split(';')[0];

test('password is checked and cookies are protected', () => {
    assert.equal(checkPassword(process.env.ADMIN_PASSWORD), true);
    assert.equal(checkPassword('wrong'), false);
    assert.equal(checkPassword(null), false);
    assert.match(sessionCookie(), /HttpOnly; Secure; SameSite=Strict/);
    assert.equal(authenticated(request('players', { headers: { cookie } })), true);
    assert.equal(authenticated(request('players')), false);
});

test('expired, forged and rotated sessions are rejected', () => {
    const now = Date.now();
    const issued = sessionCookie(now).split(';')[0];
    assert.equal(authenticated(request('players', { headers: { cookie: issued } }), now + (MAX_AGE + 1) * 1000), false);
    assert.equal(authenticated(request('players', { headers: { cookie: issued.slice(0, -1) + (issued.endsWith('0') ? '1' : '0') } })), false);
    const previous = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_PASSWORD = 'rotated-password-more-than-16';
    assert.equal(authenticated(request('players', { headers: { cookie: issued } })), false);
    process.env.ADMIN_PASSWORD = previous;
});

test('only same-origin mutations are allowed', () => {
    assert.equal(sameOrigin(request('players', { headers: { origin } })), true);
    assert.equal(sameOrigin(request('players', { headers: { origin: 'https://evil.example' } })), false);
    assert.equal(sameOrigin(request('players')), false);
});

test('only convocato of an existing non-deleted player can change', () => {
    const player = database.giocatori.find(p => !p.deleted);
    assert.equal(validUpdate({ id: player.id, convocato: false }), true);
    assert.equal(validUpdate({ nome: player.nome, convocato: false }), true);
    for (const body of [{ id: player.id, convocato: 'false' }, { id: player.id, convocato: true, nome: 'changed' },
        { id: -1, convocato: true }, { id: String(player.id), convocato: true },
        { nome: player.nome, convocato: 'false' }, { nome: 'Unknown player', convocato: true },
        { nome: player.nome.toUpperCase(), convocato: true }, { nome: player.nome, convocato: true, squadra: 'changed' }, null]) {
        assert.ok(!validUpdate(body));
    }
    const deleted = database.giocatori.find(p => p.deleted);
    if (deleted) assert.ok(!validUpdate({ id: deleted.id, convocato: true }));
});

test('saved overrides preserve all other data and are reapplied to the seed', async () => {
    const original = structuredClone(database);
    const player = database.giocatori[0];
    const store = {
        async *list({ prefix }) { yield { blobs: prefix === 'player-name/' ? [{ key: playerKey(player.nome) }] : [] }; },
        async get() { return { convocato: !player.convocato }; }
    };
    const result = await readDatabase(store);
    assert.deepEqual(result, { ...original, giocatori: original.giocatori.map(p => p.id === player.id ? { ...p, convocato: !p.convocato } : p) });
    assert.deepEqual(database, original);
    assert.deepEqual(await readDatabase(store), result);
});

test('session endpoints reject wrong passwords and cross-origin login', async () => {
    const login = (headers, password) => sessionHandler(request('admin-session', { method: 'POST', headers, body: JSON.stringify({ password }) }));
    assert.equal((await login({ origin }, 'wrong')).status, 401);
    assert.equal((await login({ origin: 'https://evil.example' }, process.env.ADMIN_PASSWORD)).status, 403);
    const success = await login({ origin }, process.env.ADMIN_PASSWORD);
    assert.equal(success.status, 200);
    assert.match(success.headers.get('set-cookie'), /HttpOnly; Secure/);
    assert.equal((await sessionHandler(request('admin-session', { method: 'DELETE', headers: { origin } }))).headers.get('set-cookie').includes('Max-Age=0'), true);
});

test('write endpoint enforces authentication, origin and field whitelist', async () => {
    const update = headers => playersHandler(request('players', { method: 'PATCH', headers, body: JSON.stringify({ id: 1, convocato: false, nome: 'changed' }) }));
    assert.equal((await update({ origin })).status, 401);
    assert.equal((await update({ origin: 'https://evil.example', cookie })).status, 403);
    assert.equal((await update({ origin, cookie })).status, 400);
    assert.equal((await playersHandler(request('players', { method: 'PUT' }))).status, 405);
});

test('authenticated save is persisted and visible in a subsequent public read', async () => {
    const stored = new Map();
    const store = {
        async setJSON(key, value) { stored.set(key, structuredClone(value)); },
        async get(key) { return stored.get(key); },
        async *list({ prefix }) { yield { blobs: [...stored.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; }
    };
    const handler = createHandler(options => {
        assert.equal(options.consistency, 'strong');
        return store;
    });
    const player = database.giocatori.find(p => !p.deleted);
    const result = await handler(request('players', { method: 'PATCH', headers: { origin, cookie },
        body: JSON.stringify({ nome: player.nome, convocato: !player.convocato }) }));
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { nome: player.nome, convocato: !player.convocato });
    assert.deepEqual([...stored.keys()], [playerKey(player.nome)]);
    const publicRead = await createHandler(() => store)(request('players'));
    const data = await publicRead.json();
    assert.deepEqual(data.giocatori.find(p => p.id === player.id), { ...player, convocato: !player.convocato });
    assert.equal(publicRead.headers.get('cache-control'), 'no-store');
    const failed = createHandler(() => ({ async setJSON() { throw new Error('unavailable'); } }));
    assert.equal((await failed(request('players', { method: 'PATCH', headers: { origin, cookie },
        body: JSON.stringify({ id: player.id, convocato: player.convocato }) }))).status, 503);
});

test('name-based keys preserve exact characters and survive ID changes', async () => {
    const nome = "D’Ambrosio / Test % à";
    assert.equal(playerKey(nome), `player-name/${encodeURIComponent(nome)}`);
    assert.notEqual(playerKey('Player'), playerKey('player'));
    assert.notEqual(playerKey('Player'), playerKey('Player '));
    const player = database.giocatori[0];
    const namedKey = playerKey(player.nome);
    const store = {
        async *list({ prefix }) { yield { blobs: prefix === 'player-name/' ? [{ key: namedKey }] : [] }; },
        async get() { return { convocato: !player.convocato }; }
    };
    const source = { ...database, giocatori: [{ ...player, id: 999999 }] };
    assert.deepEqual((await readDatabase(store, source)).giocatori, [{ ...player, id: 999999, convocato: !player.convocato }]);
});

test('migration preserves legacy data and never replaces newer named saves', async () => {
    const [first, second] = database.giocatori;
    const stored = new Map([
        [`player/${first.id}`, { convocato: false }],
        [`player/${second.id}`, { convocato: true }],
        [playerKey(first.nome), { convocato: true }]
    ]);
    const store = {
        async *list({ prefix }) { yield { blobs: [...stored.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }; },
        async get(key) { return stored.get(key); },
        async setJSON(key, value, options) {
            assert.equal(options.onlyIfNew, true);
            if (stored.has(key)) return { modified: false };
            stored.set(key, value);
            return { modified: true };
        }
    };
    assert.deepEqual(await migrateLegacyOverrides(store), { copied: 1, skipped: 1 });
    assert.deepEqual(stored.get(`player/${first.id}`), { convocato: false });
    assert.deepEqual(stored.get(playerKey(first.nome)), { convocato: true });
    assert.deepEqual(stored.get(playerKey(second.nome)), { convocato: true });
    const result = await readDatabase(store);
    assert.equal(result.giocatori.find(p => p.nome === first.nome).convocato, true);
    assert.deepEqual(await migrateLegacyOverrides(store), { copied: 0, skipped: 2 });
});

test('older admin pages can save by ID, but storage uses the name', async () => {
    const player = database.giocatori.find(p => !p.deleted);
    let actualKey;
    const handler = createHandler(() => ({ async setJSON(key) { actualKey = key; } }));
    const result = await handler(request('players', { method: 'PATCH', headers: { origin, cookie },
        body: JSON.stringify({ id: player.id, convocato: false }) }));
    assert.equal(result.status, 200);
    assert.equal(actualKey, playerKey(player.nome));
});

test('legacy IDs cannot assign an archived value to a different player', async () => {
    const player = database.giocatori[0];
    const store = {
        async *list({ prefix }) {
            assert.equal(prefix, 'player-name/');
            yield { blobs: [] };
        },
        async get() { throw new Error('Archived ID records must not be read'); }
    };
    const source = { ...database, giocatori: [{ ...player, nome: 'Different player with reused ID' }] };
    assert.deepEqual(await readDatabase(store, source), source);
});
