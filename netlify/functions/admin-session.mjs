import { authenticated, checkPassword, sessionCookie, clearCookie, sameOrigin, json, readBody } from '../lib/auth.mjs';

export default async function handler(request) {
    try {
        if (request.method === 'GET') return json({ authenticated: authenticated(request) });
        if (!['POST', 'DELETE'].includes(request.method)) return json({ error: 'Metodo non consentito.' }, 405);
        if (!sameOrigin(request)) return json({ error: 'Richiesta non consentita.' }, 403);
        if (request.method === 'DELETE') return json({ authenticated: false }, 200, { 'Set-Cookie': clearCookie() });
        let body;
        try { body = await readBody(request); } catch { return json({ error: 'Richiesta non valida.' }, 400); }
        if (!checkPassword(body?.password)) return json({ error: 'Password non valida.' }, 401);
        return json({ authenticated: true }, 200, { 'Set-Cookie': sessionCookie() });
    } catch {
        return json({ error: 'Accesso admin non configurato. Contatta il gestore dell’app.' }, 503);
    }
}

export const config = {
    path: '/api/admin-session',
    rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
