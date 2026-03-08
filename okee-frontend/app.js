const API_BASE_URL = 'https://zbv3895yj1.execute-api.us-east-1.amazonaws.com/Prod';

// --- CONFIG ---
const COGNITO_DOMAIN = 'https://okee-app-873980777388.auth.us-east-1.amazoncognito.com';
const COGNITO_CLIENT_ID = '5dosmdqjujsk85bhlfh7vbcmri';
// Simple root redirect to avoid GET errors
const REDIRECT_URI = window.location.origin + window.location.pathname;

// --- 1. INITIALIZE MAPS & GLOBAL STATE ---
const okeeBounds = [[27.35359, -80.74947], [27.36807, -80.72441]];
const map = L.map('map', { 
    center: [27.3598, -80.7335], 
    zoom: 15.5,
    maxBounds: okeeBounds,
    maxBoundsViscosity: 1.0,
    minZoom: 14
});

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {}).addTo(map);
L.imageOverlay('okee-map.jpg', okeeBounds, { opacity: 1.0 }).addTo(map);

let clickedCoords = null;
map.on('contextmenu', (e) => {
    clickedCoords = e.latlng;
    document.getElementById('map-action-modal').classList.add('open');
});
map.on('click', () => {
    document.getElementById('map-action-modal').classList.remove('open');
});

let userMarker = null;
let friendMarkers = {}; 
let campsiteMarkers = {};
let allFriendsData = [];
let allArtists = []; 
let myPersonalSchedule = [];
let publicEvents = [];
let currentMyLat = null;
let currentMyLon = null;
let currentScene = 'camping';

const PIXELS_PER_HOUR = 150;
const TIMELINE_START_HOUR = 11;

// --- 2. UI NAVIGATION ---
const panels = ['fest-panel', 'friends-panel', 'settings-panel', 'compass-panel'];
function togglePanel(pId, bId) {
    const target = document.getElementById(pId);
    const isOpen = target.classList.contains('open');
    panels.forEach(p => document.getElementById(p).classList.remove('open'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if (!isOpen) { 
        target.classList.add('open'); 
        document.getElementById(bId).classList.add('active'); 
        if (pId === 'compass-panel') populateCompassTargets();
    }
}

document.getElementById('nav-fest').onclick = () => togglePanel('fest-panel', 'nav-fest');
document.getElementById('nav-friends').onclick = () => togglePanel('friends-panel', 'nav-friends');
document.getElementById('nav-settings').onclick = () => togglePanel('settings-panel', 'nav-settings');
document.getElementById('nav-compass').onclick = () => togglePanel('compass-panel', 'nav-compass');

function toggleScene(scene) {
    currentScene = scene;
    const mapWrapper = document.getElementById('map-wrapper');
    const venueEl = document.getElementById('venue-map-container');
    const btnCamping = document.getElementById('btn-camping');
    const btnGrove = document.getElementById('btn-venue');

    if (scene === 'venue') {
        mapWrapper.style.display = 'none';
        venueEl.style.display = 'block';
        btnGrove.style.background = '#1DB954';
        btnGrove.style.color = 'black';
        btnCamping.style.background = 'transparent';
        btnCamping.style.color = 'white';
    } else {
        mapWrapper.style.display = 'block';
        venueEl.style.display = 'none';
        btnCamping.style.background = '#1DB954';
        btnCamping.style.color = 'black';
        btnGrove.style.background = 'transparent';
        btnGrove.style.color = 'white';
        map.invalidateSize(); 
    }
}

document.getElementById('btn-camping').onclick = () => toggleScene('camping');
document.getElementById('btn-venue').onclick = () => toggleScene('venue');

// --- 3. DATA SYNC ---
function updateSyncStatus(isOnline) {
    const dot = document.getElementById('online-dot');
    const text = document.getElementById('sync-text');
    if (isOnline) { dot.style.background = '#1DB954'; text.innerText = 'Live Sync Active'; }
    else { dot.style.background = '#ff4444'; text.innerText = 'Offline'; }
}

async function fetchAndDrawMapData(userId) {
    try {
        const res = await fetch(`${API_BASE_URL}/map?user_id=${encodeURIComponent(userId)}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        localStorage.setItem('okee_last_map_data', JSON.stringify(data));
        updateSyncStatus(true);
        processIncomingData(data, userId);
    } catch (e) { 
        updateSyncStatus(false);
        const cached = localStorage.getItem('okee_last_map_data');
        if (cached) processIncomingData(JSON.parse(cached), userId);
    }
}

function processIncomingData(data, userId) {
    myPersonalSchedule = data.my_schedule || [];
    allFriendsData = data.friends || [];
    allArtists = data.lineup || [];
    publicEvents = data.public_events || [];

    const nameInput = document.getElementById('display-name-input');
    if (nameInput && !nameInput.dataset.touched) nameInput.value = data.display_name || userId;

    if (data.my_campsite) {
        if (campsiteMarkers['me']) campsiteMarkers['me'].setLatLng([data.my_campsite.lat, data.my_campsite.lon]);
        else campsiteMarkers['me'] = L.marker([data.my_campsite.lat, data.my_campsite.lon], { icon: L.divIcon({html:'🏕️', className:'camp-icon', iconSize:[25,25]}) }).addTo(map).bindPopup("My Campsite");
    }

    allFriendsData.forEach(f => {
        if (f.location && f.zone !== 'OUT_OF_BOUNDS') {
            if (friendMarkers[f.user_id]) friendMarkers[f.user_id].setLatLng([f.location.lat, f.location.lon]);
            else friendMarkers[f.user_id] = L.marker([f.location.lat, f.location.lon], {icon: L.divIcon({className:'custom-div-icon', html:`<div style='background-color:#1DB954; width:15px; height:15px; border-radius:50%; border:2px solid white;'></div>`})}).addTo(map).bindPopup(f.name || f.user_id);
        } else if (friendMarkers[f.user_id]) {
            map.removeLayer(friendMarkers[f.user_id]);
            delete friendMarkers[f.user_id];
        }
        if (f.campsite) {
            if (campsiteMarkers[f.user_id]) campsiteMarkers[f.user_id].setLatLng([f.campsite.lat, f.campsite.lon]);
            else campsiteMarkers[f.user_id] = L.marker([f.campsite.lat, f.campsite.lon], { icon: L.divIcon({html: '⛺', className: 'camp-icon', iconSize:[25,25]}) }).addTo(map).bindPopup(`${f.name || f.user_id}'s Campsite`);
        }
    });

    renderFestivalSchedule(allArtists);
    renderMySchedule(allArtists, myPersonalSchedule);
    renderPublicEventsUI();
    loadFriendsUI(userId);
    renderSpotifyConnectUI(data.spotify_connected);
    populateCompassTargets();
}

// --- 4. ENGINE: THE GROVE ---
const wrapper = document.getElementById('venue-img-wrapper');
let scale = 1, pointX = 0, pointY = 0, start = { x: 0, y: 0 };
function setTransform() { wrapper.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`; }
wrapper.onmousedown = (e) => {
    e.preventDefault(); start = { x: e.clientX - pointX, y: e.clientY - pointY };
    wrapper.onmousemove = (e) => { pointX = e.clientX - start.x; pointY = e.clientY - start.y; setTransform(); };
};
wrapper.onmouseup = () => wrapper.onmousemove = null;
wrapper.onwheel = (e) => {
    e.preventDefault(); const xs = (e.clientX - pointX) / scale, ys = (e.clientY - pointY) / scale, delta = (e.wheelDelta ? e.wheelDelta : -e.deltaY);
    (delta > 0) ? (scale *= 1.2) : (scale /= 1.2);
    pointX = e.clientX - xs * scale; pointY = e.clientY - ys * scale; setTransform();
};

let anchors = JSON.parse(localStorage.getItem('okee_anchors')) || [];
function gpsToPixels(lat, lon) {
    if (anchors.length < 3) return null;
    const [A, B, C] = anchors;
    const detT = (B.lat - C.lat)*(A.lon - C.lon) - (B.lon - C.lon)*(A.lat - C.lat);
    if (detT === 0) return null; 
    const wA = ((B.lat - C.lat)*(lon - C.lon) - (B.lon - C.lon)*(lat - C.lat)) / detT;
    const wB = ((C.lat - A.lat)*(lon - C.lon) - (A.lon - C.lon)*(lat - C.lat)) / detT;
    const wC = 1 - wA - wB;
    return { x: wA * A.x + wB * B.x + wC * C.x, y: wA * A.y + wB * B.y + wC * C.y };
}

function renderVenueFriends(list) {
    const container = document.getElementById('venue-friends-container');
    if (!container || anchors.length < 3) return;
    list.forEach(f => {
        if (!f.location || f.zone !== 'VENUE') return;
        const px = gpsToPixels(f.location.lat, f.location.lon);
        if (!px) return;
        let dot = document.getElementById(`v-dot-${f.user_id}`);
        if (!dot) {
            dot = document.createElement('div');
            dot.id = `v-dot-${f.user_id}`;
            dot.style = "position:absolute; width:14px; height:14px; background:#ff00ff; border:2px solid #fff; border-radius:50%; transform:translate(-50%,-50%); z-index:9;";
            container.appendChild(dot);
        }
        dot.style.left = px.x + 'px'; dot.style.top = px.y + 'px';
    });
}

// --- 5. LOGIC: CREW & SETTINGS ---
async function loadFriendsUI(uId) {
    try {
        const res = await fetch(`${API_BASE_URL}/friends?user_id=${encodeURIComponent(uId)}`);
        const data = await res.json();
        const container = document.getElementById('friends-list-container');
        if (!container) return;
        container.innerHTML = '';
        
        Object.keys(data.friends || {}).forEach(fid => {
            const perms = data.friends[fid];
            const div = document.createElement('div');
            div.style = "border-bottom: 1px solid #444; padding-bottom: 10px; margin-bottom: 10px;";
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>${fid}</strong>
                    <button class="sm-btn" style="background:#444; font-size:0.7rem; padding: 2px 8px; min-width:auto; min-height:auto;" onclick="removeFriend('${fid}')">Remove</button>
                </div>
                <div class="toggle-row"><small>In-Venue GPS</small><div class="toggle-switch ${perms.shareLocationVenue ? 'on' : ''}" onclick="updateFriendPerm('${fid}', 'shareLocationVenue', this)"></div></div>
                <div class="toggle-row"><small>Campground GPS</small><div class="toggle-switch ${perms.shareLocationCampground ? 'on' : ''}" onclick="updateFriendPerm('${fid}', 'shareLocationCampground', this)"></div></div>
                <div class="toggle-row"><small>Campsite Pin</small><div class="toggle-switch ${perms.shareCampsitePin ? 'on' : ''}" onclick="updateFriendPerm('${fid}', 'shareCampsitePin', this)"></div></div>
                <div class="toggle-row"><small>Schedule</small><div class="toggle-switch ${perms.shareSchedule ? 'on' : ''}" onclick="updateFriendPerm('${fid}', 'shareSchedule', this)"></div></div>`;
            container.appendChild(div);
        });

        const reqContainer = document.getElementById('pending-requests-list');
        reqContainer.innerHTML = Object.keys(data.requests || {}).length ? '' : '<p style="font-size:0.8rem; color:#555;">No requests.</p>';
        Object.keys(data.requests || {}).forEach(fid => {
            const div = document.createElement('div');
            div.className = 'toggle-row';
            div.innerHTML = `<span>${fid}</span><button class="sm-btn" style="background:#1DB954; padding:5px;" onclick="handleRequest('${fid}', 'ACCEPT')">Accept</button>`;
            reqContainer.appendChild(div);
        });
    } catch (e) { console.error(e); }
}

function renderSpotifyConnectUI(isConnected) {
    const container = document.getElementById('spotify-settings-container');
    if (!container) return;
    const uId = localStorage.getItem('okee_user_id');
    container.innerHTML = isConnected ? 
        '<p style="color:#1DB954; font-size:0.8rem; padding:10px; background:#111; border-radius:8px;"><i class="fa-brands fa-spotify"></i> Spotify Connected</p>' :
        `<button class="action-btn" style="background:#1DB954; margin-top:10px;" onclick="window.location.href='${API_BASE_URL}/auth/spotify?user_id=${uId}'"><i class="fa-brands fa-spotify"></i> Connect Spotify</button>`;
}

// Actions
document.getElementById('add-friend-btn').onclick = async () => {
    const uId = localStorage.getItem('okee_user_id'), fId = document.getElementById('friend-input').value;
    if (!fId) return;
    const res = await fetch(`${API_BASE_URL}/friends`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'REQUEST', user_id: uId, friend_id: fId }) });
    if (res.ok) { alert("Sent!"); document.getElementById('friend-input').value = ''; }
};

document.getElementById('save-profile-btn').onclick = async () => {
    const uId = localStorage.getItem('okee_user_id'), name = document.getElementById('display-name-input').value;
    await fetch(`${API_BASE_URL}/location`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: uId, display_name: name, lat: currentMyLat, lon: currentMyLon }) });
    alert("Saved!");
};

document.getElementById('auth-btn').onclick = () => {
    const userId = document.getElementById('user-id-input').value.trim();
    if (!userId) return alert('Enter ID!');
    localStorage.setItem('okee_user_id', userId);
    location.reload();
};

document.getElementById('modal-campsite-btn').onclick = async () => {
    if (!clickedCoords) return;
    const uId = localStorage.getItem('okee_user_id');
    await fetch(`${API_BASE_URL}/campsite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: uId, lat: clickedCoords.lat, lon: clickedCoords.lng }) });
    document.getElementById('map-action-modal').classList.remove('open');
    alert("Campsite Pinned!");
    fetchAndDrawMapData(uId);
};

document.getElementById('modal-report-btn').onclick = () => {
    if (!clickedCoords) return;
    const desc = prompt("What's wrong here?");
    if (!desc) return;
    fetch(`${API_BASE_URL}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: localStorage.getItem('okee_user_id'), lat: clickedCoords.lat, lon: clickedCoords.lng, description: desc }) });
    document.getElementById('map-action-modal').classList.remove('open');
    alert("Report sent!");
};

document.getElementById('manual-campsite-btn').onclick = async () => {
    const uId = localStorage.getItem('okee_user_id');
    if (!currentMyLat) return alert("Waiting for GPS...");
    await fetch(`${API_BASE_URL}/campsite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: uId, lat: currentMyLat, lon: currentMyLon }) });
    alert("Campsite Pinned!");
};

document.getElementById('report-bug-btn').onclick = () => {
    const desc = prompt("Describe the bug:");
    if (!desc) return;
    fetch(`${API_BASE_URL}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: localStorage.getItem('okee_user_id'), lat: currentMyLat, lon: currentMyLon, description: desc }) });
    alert("Report sent!");
};

document.getElementById('sign-out-btn').onclick = () => {
    localStorage.removeItem('okee_user_id');
    location.reload();
};

// --- 6. RENDERERS: SCHEDULE & EVENTS ---
function renderFestivalSchedule(lineup) {
    const container = document.getElementById('festival-schedule-container');
    if (!container) return;
    const day = document.getElementById('schedule-day-select').value;
    container.innerHTML = '';
    const stages = [...new Set(lineup.map(a => a.Stage))].sort();

    stages.forEach(stage => {
        const artists = lineup.filter(a => a.Day === day && a.Stage === stage);
        if (!artists.length) return;
        const row = document.createElement('div'); row.className = 'stage-row';
        row.innerHTML = `<div class="stage-name">${stage}</div>`;
        const timeline = document.createElement('div'); timeline.className = 'timeline-container';
        const inner = document.createElement('div'); inner.className = 'timeline-inner';
        
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const adjustedNow = (now.getHours() < 5) ? nowMinutes + (24*60) : nowMinutes;
        const nowLeft = ((adjustedNow - (TIMELINE_START_HOUR * 60)) / 60) * PIXELS_PER_HOUR;
        const line = document.createElement('div'); line.className = 'now-line'; line.style.left = nowLeft + 'px';
        inner.appendChild(line);

        artists.forEach(a => {
            const added = myPersonalSchedule.includes(a.ArtistId);
            const [startStr, endStr] = a.Time.split(' - ');
            const startMin = timeToMinutes(startStr), endMin = timeToMinutes(endStr);
            const left = ((startMin - (TIMELINE_START_HOUR * 60)) / 60) * PIXELS_PER_HOUR;
            const width = ((endMin - startMin) / 60) * PIXELS_PER_HOUR;

            const block = document.createElement('div'); block.className = 'artist-block'; block.style.left = left + 'px'; block.style.width = width + 'px';
            block.innerHTML = `<div class="name">${a.Name}</div><div class="time">${a.Time}</div>
                <div style="display:flex; gap:5px;"><button class="sm-btn" style="background:#1DB954; width:30px; height:30px; padding:0;" onclick="playPreview('${a.SpotifyURI}')">🎵</button>
                <button class="sm-btn" style="background:#444; width:30px; height:30px; padding:0;" onclick="togglePersonalSchedule('${a.ArtistId}', ${added})">${added?'✓':'+'}</button></div>`;
            inner.appendChild(block);
        });
        timeline.appendChild(inner); row.appendChild(timeline); container.appendChild(row);
    });
}

function renderMySchedule(lineup, ids) {
    const scroller = document.getElementById('my-schedule-scroller');
    if (!scroller) return; scroller.innerHTML = '';
    const myArtists = lineup.filter(a => ids.includes(a.ArtistId)).sort((a,b) => timeToMinutes(a.Time.split(' - ')[0]) - timeToMinutes(b.Time.split(' - ')[0]));
    myArtists.forEach(a => {
        const card = document.createElement('div'); card.style = "background:#222; padding:10px; border-radius:8px; border:1px solid #333; min-width:140px;";
        card.innerHTML = `<div style="font-weight:bold; font-size:0.8rem;">${a.Name}</div><div style="font-size:0.7rem; color:#888;">${a.Time}</div>`;
        scroller.appendChild(card);
    });
}

function renderPublicEventsUI() {
    const container = document.getElementById('public-events-list');
    if (!container) return; container.innerHTML = publicEvents.length ? '' : '<p style="font-size:0.8rem; color:#555;">No public events.</p>';
    publicEvents.forEach(e => {
        const div = document.createElement('div'); div.style = "background:#222; padding:10px; border-radius:8px; margin-bottom:5px;";
        div.innerHTML = `<div style="font-weight:bold;">${e.Title}</div><div style="font-size:0.7rem; color:#1DB954;">${e.Location}</div>`;
        container.appendChild(div);
    });
}

document.getElementById('submit-public-event').onclick = async () => {
    const uId = localStorage.getItem('okee_user_id'), title = document.getElementById('event-title').value, loc = document.getElementById('event-location').value, desc = document.getElementById('event-desc').value;
    const day = document.getElementById('schedule-day-select').value; // Use current day
    await fetch(`${API_BASE_URL}/public-events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: uId, title, location: loc, day: day, description: desc }) });
    document.getElementById('public-event-modal').classList.remove('open');
    fetchAndDrawMapData(uId);
};

// --- 7. LOCATION & STARTUP ---
function startLocationTracking(userId) {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(async (pos) => {
        const lat = pos.coords.latitude, lon = pos.coords.longitude;
        currentMyLat = lat; currentMyLon = lon;
        if (!userMarker) userMarker = L.marker([lat, lon]).addTo(map).bindPopup("<b>You</b>"); else userMarker.setLatLng([lat, lon]);
        const px = gpsToPixels(lat, lon);
        if (px) { document.getElementById('user-dot-venue').style.display = 'block'; document.getElementById('user-dot-venue').style.left = px.x + 'px'; document.getElementById('user-dot-venue').style.top = px.y + 'px'; }
        await fetch(`${API_BASE_URL}/location`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, lat, lon }) });
        fetchAndDrawMapData(userId);
    }, null, { enableHighAccuracy: true });
}

window.updateFriendPerm = async (fid, key, el) => {
    const uId = localStorage.getItem('okee_user_id'), val = !el.classList.contains('on');
    el.classList.toggle('on');
    await fetch(`${API_BASE_URL}/friends`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'UPDATE', user_id: uId, friend_id: fid, permission_key: key, permission_value: val }) });
};

window.handleRequest = async (fid, action) => { await fetch(`${API_BASE_URL}/friends`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: localStorage.getItem('okee_user_id'), friend_id: fid, action }) }); fetchAndDrawMapData(localStorage.getItem('okee_user_id')); };
window.removeFriend = async (fid) => { if (confirm(`Remove ${fid}?`)) await fetch(`${API_BASE_URL}/friends`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: localStorage.getItem('okee_user_id'), friend_id: fid, action: 'REMOVE' }) }); fetchAndDrawMapData(localStorage.getItem('okee_user_id')); };

function timeToMinutes(timeStr) {
    if (!timeStr) return 0; const [time, modifier] = timeStr.split(' '); let [hours, minutes] = time.split(':').map(Number);
    if (modifier === 'PM' && hours !== 12) hours += 12; if (modifier === 'AM' && hours === 12) hours = 0; if (hours < 5) hours += 24; return hours * 60 + minutes;
}

function playPreview(uri) {
    if (!uri || uri === 'TBD') return alert("Preview not available.");
    const id = uri.split(':').pop();
    document.getElementById('spotify-player-container').innerHTML = `<iframe src="https://open.spotify.com/embed/artist/${id}" width="100%" height="152" frameborder="0" allowtransparency="true" allow="encrypted-media"></iframe>`;
}

async function togglePersonalSchedule(aId, added) {
    const uId = localStorage.getItem('okee_user_id');
    await fetch(`${API_BASE_URL}/schedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: uId, artist_id: aId, action: added ? 'REMOVE' : 'ADD' }) });
    fetchAndDrawMapData(uId);
}

function populateCompassTargets() {
    const select = document.getElementById('compass-target-select');
    if(!select) return;
    select.innerHTML = '<option value="">-- Select Target --</option>';
    allFriendsData.forEach(f => { if (f.location) select.innerHTML += `<option value="${f.user_id}">${f.name || f.user_id}</option>`; });
}

function initAuthButtons() { 
    const uId = localStorage.getItem('okee_user_id');
    const loginBtn = document.getElementById('email-login-btn'); 
    const signOutBtn = document.getElementById('sign-out-btn');
    if (uId) { 
        loginBtn.innerText = `ID: ${uId}`; loginBtn.style.background = '#444'; loginBtn.onclick = null; 
        signOutBtn.style.display = 'block';
    } else { 
        loginBtn.onclick = () => window.location.href = `${COGNITO_DOMAIN}/login?client_id=${COGNITO_CLIENT_ID}&response_type=token&scope=email+openid+profile&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`; 
        signOutBtn.style.display = 'none';
    }
}

function checkCallbacks() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('user_id')) { localStorage.setItem('okee_user_id', urlParams.get('user_id')); window.history.replaceState({}, document.title, window.location.pathname); }
    if (window.location.hash.includes('id_token')) {
        const params = new URLSearchParams(window.location.hash.substring(1));
        const payload = JSON.parse(atob(params.get('id_token').split('.')[1]));
        localStorage.setItem('okee_user_id', payload['cognito:username'] || payload.sub);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(console.error);
    });
}

window.addEventListener('DOMContentLoaded', () => {
    checkCallbacks();
    const uId = localStorage.getItem('okee_user_id');
    if (uId) { fetchAndDrawMapData(uId); startLocationTracking(uId); }
    initAuthButtons();
    renderSpotifyConnectUI(false); // Initial state
    updateSyncStatus(navigator.onLine);
    document.getElementById('schedule-day-select').onchange = () => renderFestivalSchedule(allArtists);
});