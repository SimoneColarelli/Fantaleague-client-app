import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = '__Host-fantaleague-admin';
export const MAX_AGE = 8 * 60 * 60;

function settings() {
    const password = process.env.ADMIN_PASSWORD;
    const secret = process.env.ADMIN_SESSION_SECRET;
    if (!password || password.length < 16 || !secret || secret.length < 32) {
        throw new Error('Admin configuration missing');
    }
    return { password, secret };
}

function digest(value) {
    return createHash('sha256').update(value).digest();
}

export function checkPassword(input) {
    return typeof input === 'string' && timingSafeEqual(digest(input), digest(settings().password));
}

function signature(expiry) {
    const { password, secret } = settings();
    return createHmac('sha256', secret).update(`${expiry}:${digest(password).toString('hex')}`).digest('hex');
}

export function sessionCookie(now = Date.now()) {
    const expiry = Math.floor(now / 1000) + MAX_AGE;
    return `${COOKIE}=${expiry}.${signature(expiry)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}

export function clearCookie() {
    return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function authenticated(request, now = Date.now()) {
    const token = (request.headers.get('cookie') || '').split(';')
        .map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!token) return false;
    const match = /^(\d+)\.([a-f0-9]{64})$/.exec(token);
    if (!match) return false;
    const expiry = Number(match[1]);
    if (expiry <= Math.floor(now / 1000) || expiry > Math.floor(now / 1000) + MAX_AGE) return false;
    return timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(signature(expiry), 'hex'));
}

export function sameOrigin(request) {
    return request.headers.get('origin') === new URL(request.url).origin;
}

export function json(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
    });
}

export async function readBody(request) {
    const body = await request.text();
    if (body.length > 4096) throw new Error('Body too large');
    return JSON.parse(body);
}
