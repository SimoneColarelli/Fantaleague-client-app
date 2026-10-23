import { getStore } from '@netlify/blobs';
import { authenticated, sameOrigin, json, readBody } from '../lib/auth.mjs';
import { updatePlayer, playerKey, readDatabase } from '../lib/players.mjs';

export const config = { path: '/api/players' };

export function createHandler(storeFactory = getStore) {
return async function handler(request) {
    if (!['GET', 'PATCH'].includes(request.method)) return json({ error: 'Metodo non consentito.' }, 405);
    try {
        if (request.method === 'PATCH') {
            if (!sameOrigin(request)) return json({ error: 'Richiesta non consentita.' }, 403);
            if (!authenticated(request)) return json({ error: 'Accedi come admin per salvare.' }, 401);
            let body;
            try { body = await readBody(request); } catch { return json({ error: 'Richiesta non valida.' }, 400); }
            const player = updatePlayer(body);
            if (!player) return json({ error: 'È consentita solo la modifica di Convocato per un giocatore esistente.' }, 400);
            const store = storeFactory({ name: process.env.CONVOCATI_STORE || 'fantaleague-convocati', consistency: 'strong' });
            await store.setJSON(playerKey(player.nome), { convocato: body.convocato });
            return json({ nome: player.nome, convocato: body.convocato });
        }
        const store = storeFactory({ name: process.env.CONVOCATI_STORE || 'fantaleague-convocati', consistency: 'strong' });
        return json(await readDatabase(store));
    } catch {
        return json({ error: 'Servizio non disponibile. Riprova tra poco.' }, 503);
    }
}
}

export default createHandler();
