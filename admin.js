'use strict';

const status = document.getElementById('status');
const login = document.getElementById('login');
const editor = document.getElementById('editor');
const list = document.getElementById('players');
const search = document.getElementById('search');
const team = document.getElementById('team');
const logout = document.getElementById('logout');
const refreshIndicator = document.getElementById('refresh-indicator');
let players = [];
let pending = 0;
let refreshing = false;

async function api(path, options = {}) {
    if (!navigator.onLine) throw new Error('Sei offline. Connettiti a Internet per continuare.');
    let response;
    try {
        response = await fetch(`./api/${path}`, {
            cache: 'no-store', credentials: 'same-origin', ...options,
            headers: { 'Content-Type': 'application/json', ...options.headers }
        });
    } catch { throw new Error('Connessione non disponibile. Riprova tra poco.'); }
    let body;
    try { body = await response.json(); } catch {
        throw new Error(response.status === 429 ? 'Troppi tentativi. Riprova tra un minuto.' : 'Servizio non disponibile. Riprova tra poco.');
    }
    if (response.status === 401 && path === 'players') showLogin();
    if (!response.ok) throw new Error(body.error || 'Impossibile completare la richiesta.');
    return body;
}

function showLogin() {
    login.hidden = false;
    editor.hidden = true;
    logout.hidden = true;
    players = [];
    list.replaceChildren();
}

function render() {
    const query = search.value.toLocaleLowerCase('it');
    const visible = players.filter(player => !player.deleted &&
        player.nome.toLocaleLowerCase('it').includes(query) && (!team.value || player.squadra === team.value));
    list.replaceChildren();
    if (!visible.length) {
        const empty = document.createElement('p');
        empty.textContent = 'Nessun giocatore trovato.';
        list.append(empty);
    }
    for (const player of visible) {
        const card = document.createElement('div');
        card.className = 'player';
        const info = document.createElement('div');
        info.className = 'player-info';
        const name = document.createElement('div');
        name.className = 'player-name';
        name.textContent = player.nome;
        const squad = document.createElement('div');
        squad.className = 'player-team';
        squad.textContent = player.squadra;
        info.append(name, squad);
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.playerName = player.nome;
        checkbox.setAttribute('role', 'switch');
        checkbox.setAttribute('aria-label', `Convocato: ${player.nome}`);
        checkbox.checked = player.saving ? player.requested : player.convocato;
        checkbox.disabled = !!player.saving || refreshing || !navigator.onLine;
        label.append(checkbox, document.createTextNode('Convocato'));
        checkbox.addEventListener('change', () => save(player, checkbox));
        card.append(info, label);
        list.append(card);
    }
}

async function loadPlayers() {
    const result = await api('players');
    players = result.giocatori;
    const selected = team.value;
    team.replaceChildren(new Option('Tutte le squadre', ''));
    for (const name of [...new Set(players.filter(p => !p.deleted).map(p => p.squadra))].sort()) {
        team.append(new Option(name, name));
    }
    team.value = selected;
    login.hidden = true;
    editor.hidden = false;
    logout.hidden = false;
    render();
    status.textContent = '';
}

async function save(player, checkbox) {
    const requested = checkbox.checked;
    player.saving = true;
    player.requested = requested;
    pending++;
    checkbox.disabled = true;
    logout.disabled = true;
    status.textContent = `Salvataggio di ${player.nome}…`;
    try {
        const saved = await api('players', { method: 'PATCH', body: JSON.stringify({ nome: player.nome, convocato: requested }) });
        player.convocato = saved.convocato;
        status.textContent = `Convocato salvato per ${player.nome}.`;
    } catch (error) {
        status.textContent = `${error.message} Il valore visualizzato è l’ultimo confermato. Trascina verso il basso dall’inizio della pagina per verificare.`;
    } finally {
        player.saving = false;
        delete player.requested;
        pending--;
        checkbox.checked = player.convocato;
        checkbox.disabled = !navigator.onLine;
        for (const control of list.querySelectorAll('input[data-player-name]')) {
            if (control.dataset.playerName === player.nome) {
                control.checked = player.convocato;
                control.disabled = !navigator.onLine;
            }
        }
        logout.disabled = pending > 0 || refreshing;
    }
}

login.addEventListener('submit', async event => {
    event.preventDefault();
    const button = login.querySelector('button');
    button.disabled = true;
    status.textContent = 'Accesso in corso…';
    try {
        await api('admin-session', { method: 'POST', body: JSON.stringify({ password: document.getElementById('password').value }) });
        document.getElementById('password').value = '';
        await loadPlayers();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
});

logout.addEventListener('click', async () => {
    if (pending || refreshing) return;
    logout.disabled = true;
    try {
        await api('admin-session', { method: 'DELETE' });
        showLogin();
        status.textContent = 'Accesso terminato.';
    } catch (error) { status.textContent = error.message; }
    finally { logout.disabled = pending > 0 || refreshing; }
});
async function refreshPlayers() {
    if (pending || refreshing || editor.hidden) return;
    refreshing = true;
    logout.disabled = true;
    refreshIndicator.hidden = false;
    refreshIndicator.classList.add('refreshing');
    refreshIndicator.style.setProperty('--pull-distance', '32px');
    render();
    try {
        const session = await api('admin-session');
        if (!session.authenticated) { showLogin(); status.textContent = 'Accedi come admin per continuare.'; }
        else await loadPlayers();
    } catch (error) { status.textContent = error.message; }
    finally {
        refreshing = false;
        logout.disabled = pending > 0;
        refreshIndicator.hidden = true;
        refreshIndicator.classList.remove('refreshing', 'ready');
        if (!editor.hidden) render();
    }
}

let pullStart = null;
let pullDistance = 0;
const pullThreshold = 80;

function resetPull() {
    pullStart = null;
    pullDistance = 0;
    if (!refreshing) {
        refreshIndicator.hidden = true;
        refreshIndicator.classList.remove('ready');
    }
}

document.addEventListener('touchstart', event => {
    resetPull();
    if (event.touches.length !== 1 || window.scrollY > 0 || pending || refreshing || editor.hidden ||
        event.target.closest('input, select, button, a, label')) return;
    const touch = event.touches[0];
    pullStart = { x: touch.clientX, y: touch.clientY };
}, { passive: true });

document.addEventListener('touchmove', event => {
    if (!pullStart) return;
    if (event.touches.length !== 1 || window.scrollY > 0 || pending || refreshing) { resetPull(); return; }
    const touch = event.touches[0];
    const deltaY = touch.clientY - pullStart.y;
    if (deltaY <= 0 || Math.abs(touch.clientX - pullStart.x) > Math.abs(deltaY)) { resetPull(); return; }
    if (event.cancelable) event.preventDefault();
    pullDistance = deltaY;
    refreshIndicator.hidden = false;
    refreshIndicator.classList.toggle('ready', pullDistance >= pullThreshold);
    refreshIndicator.style.setProperty('--pull-distance', `${Math.min(pullDistance * 0.4, 56)}px`);
    refreshIndicator.style.setProperty('--pull-rotation', `${pullDistance * 2}deg`);
}, { passive: false });

document.addEventListener('touchend', () => {
    const shouldRefresh = pullStart && pullDistance >= pullThreshold;
    resetPull();
    if (shouldRefresh) void refreshPlayers();
}, { passive: true });
document.addEventListener('touchcancel', resetPull, { passive: true });
search.addEventListener('input', render);
team.addEventListener('change', render);
window.addEventListener('offline', () => { status.textContent = 'Sei offline. Le modifiche richiedono una connessione Internet.'; render(); });
window.addEventListener('online', () => { status.textContent = 'Connessione ripristinata. Trascina verso il basso dall’inizio della pagina per verificare i valori.'; render(); });
window.addEventListener('beforeunload', event => { if (pending) event.preventDefault(); });

(async () => {
    try {
        const session = await api('admin-session');
        if (session.authenticated) await loadPlayers();
        else { showLogin(); status.textContent = 'Accedi come admin per modificare Convocato.'; }
    } catch (error) { showLogin(); status.textContent = error.message; }
})();
