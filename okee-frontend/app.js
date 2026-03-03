const API_BASE_URL = 'https://zbv3895yj1.execute-api.us-east-1.amazonaws.com/Prod';

// 1. Initialize map and lock it to the Festival
const okeeBounds = L.latLngBounds([27.3526, -80.7499], [27.3684, -80.7238]);

const map = L.map('map', {
    center: [27.3598, -80.7335], 
    zoom: 15.5,
    minZoom: 15,
    maxBounds: okeeBounds.pad(0.2),
    maxBoundsViscosity: 0.9
});

let clickedCoords = null;

// Open the modal when clicking the map
map.on('contextmenu', (e) => {
    clickedCoords = e.latlng;
    const modal = document.getElementById('map-action-modal');
    modal.classList.add('open');
});

// Close modal when clicking elsewhere
map.on('click', () => {
    document.getElementById('map-action-modal').classList.remove('open');
});

// Bring the terrain back, but restrict downloads to the immediate festival area
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    bounds: okeeBounds.pad(0.1) 
}).addTo(map);

const mainBounds = [[27.35359, -80.74947], [27.36807, -80.72441]];
L.imageOverlay('okee-map.jpg', mainBounds, { opacity: 1.0 }).addTo(map);

// --- LOCATION TRACKER ---
let trackingId = null;
let userMarker = null;
let friendMarkers = {}; 

function startLocationTracking(userId) {
    if (!navigator.geolocation) return;

    trackingId = navigator.geolocation.watchPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            console.log(`GPS Ping: ${lat}, ${lon}`); 
            
            // Pass the physical ping to the universal handler
            handleLocationUpdate(lat, lon);

            try {
                // 1. Send your location to AWS
                const response = await fetch(`${API_BASE_URL}/location`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ user_id: userId, lat: lat, lon: lon })
                });
                
                const data = await response.json();
                console.log("AWS Location Response:", data);
                
                // 2. Fetch the updated map data (including friends) AFTER your location syncs
                fetchAndDrawMapData(userId);
                
            } catch (error) {
                console.error("Network error syncing location:", error);
            }
        },
        (error) => console.error("GPS Error:", error.message),
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
    );
}

// --- BACKGROUND POLLING ---
// Fixes SOS notifications and map updates when stationary
setInterval(() => {
    const savedUserId = localStorage.getItem('okee_user_id');
    if (savedUserId) fetchAndDrawMapData(savedUserId);
}, 30000);


// --- UI & NAV LOGIC ---
const panels = ['fest-panel', 'friends-panel', 'settings-panel'];
const navBtns = ['nav-fest', 'nav-friends', 'nav-settings'];

function togglePanel(panelId, btnId) {
    const panel = document.getElementById(panelId);
    const isOpen = panel.classList.contains('open');

    panels.forEach(p => document.getElementById(p).classList.remove('open'));
    navBtns.forEach(b => document.getElementById(b).classList.remove('active'));

    if (!isOpen) {
        panel.classList.add('open');
        document.getElementById(btnId).classList.add('active');
    }
}

document.getElementById('nav-fest').addEventListener('click', () => togglePanel('fest-panel', 'nav-fest'));
document.getElementById('nav-friends').addEventListener('click', () => togglePanel('friends-panel', 'nav-friends'));
document.getElementById('nav-settings').addEventListener('click', () => togglePanel('settings-panel', 'nav-settings'));


// --- SOS SYSTEM ---
let isSosActive = false;

document.getElementById('sos-btn').addEventListener('click', async () => {
    const userId = localStorage.getItem('okee_user_id');
    if (!userId) {
        alert('Please open settings and register your user ID first.');
        return;
    }

    isSosActive = !isSosActive;
    const btn = document.getElementById('sos-btn');
    const target = document.getElementById('sos-target').value;

    if (isSosActive) {
        btn.classList.add('active');
        btn.innerText = 'ON';
    } else {
        btn.classList.remove('active');
        btn.innerText = 'SOS';
    }

    try {
        const response = await fetch(`${API_BASE_URL}/sos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, active: isSosActive, target: target })
        });
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        console.log(`SOS status synced: ${isSosActive ? 'ACTIVE (' + target + ')' : 'OFF'}`);
    } catch (error) {
        console.error("SOS Fetch failed:", error);
    }
});


// --- AUTH FLOW ---
document.getElementById('auth-btn').addEventListener('click', () => {
    const userId = document.getElementById('user-id-input').value.trim();
    if (!userId) {
        alert('Please enter a username first!');
        return;
    }
    
    // Save locally
    localStorage.setItem('okee_user_id', userId);
    console.log(`User set to ${userId}. Bypassing Spotify for frontend sprint.`);
    
    // Refresh the page immediately to apply the new user ID
    window.location.reload(); 
});

window.addEventListener('DOMContentLoaded', () => {
    // 1. Existing Logic
    const savedUserId = localStorage.getItem('okee_user_id');
    if (savedUserId) {
        const idInput = document.getElementById('user-id-input');
        if (idInput) idInput.value = savedUserId;
        
        fetchAndDrawMapData(savedUserId);
        startLocationTracking(savedUserId); 
        loadFriendsUI(savedUserId);
    }

    // 2. Initialize new features safely
    initCognitoButtons();
    checkAuthHash();
});

// Helper to pull friends and trigger the renderer
async function loadFriendsUI(userId) {
    try {
        const response = await fetch(`${API_BASE_URL}/friends?user_id=${encodeURIComponent(userId)}`);
        const data = await response.json();
        if (data.friends) {
            renderFriendsList(data.friends);
        }
    } catch (e) {
        console.error("Could not load friends list:", e);
    }
}


// --- FRIENDS SYSTEM ---
document.getElementById('add-friend-btn').addEventListener('click', async () => {
    const userId = localStorage.getItem('okee_user_id');
    const friendId = document.getElementById('friend-input').value.trim();
    
    if (!userId) return alert("Register your user ID in settings first.");
    if (!friendId) return alert("Enter a friend's username.");
    if (userId.toLowerCase() === friendId.toLowerCase()) return alert("You can't add yourself.");

    try {
        const response = await fetch(`${API_BASE_URL}/friends`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId, friend_id: friendId, action: 'add' })
        });
        
        const data = await response.json();
        if (response.ok) {
            alert(`Added ${friendId} to your friends list!`);
            document.getElementById('friend-input').value = ''; // clear input
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (error) {
        console.error("Failed to add friend:", error);
    }
});


// --- DEV TRACE TOOL ---
let currentFence = [];
let fencePolygon = L.polygon([], {color: 'red', weight: 2}).addTo(map);

map.on('click', (e) => {
    currentFence.push([e.latlng.lat, e.latlng.lng]);
    fencePolygon.setLatLngs(currentFence);
    console.log("Trace Points: " + JSON.stringify(currentFence));
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'c') {
        currentFence = [];
        fencePolygon.setLatLngs([]);
        console.clear();
        console.log("Trace cleared.");
    }
});


// --- MAP DATA RENDERER ---
let hasDrawnZones = false; 

async function fetchAndDrawMapData(userId) {
    try {
        const response = await fetch(`${API_BASE_URL}/map?user_id=${encodeURIComponent(userId)}`);
        const data = await response.json();
        renderVenueFriends(data.friends || []); // Update venue friend dots if on venue map
        if (data.error) {
            console.error("Backend returned an error:", data.error);
            return;
        }

        // 1. Draw Zones 
        if (data.zones && data.zones.length > 0 && !hasDrawnZones) {
            data.zones.forEach(zone => {
                let polyColor = 'white';
                let polyWeight = 2;
                
                if (zone.ZoneType === 'VENUE') polyColor = '#00bfff';
                else if (zone.ZoneType === 'CAMPGROUND') polyColor = '#32cd32';
                else if (zone.ZoneType === 'PERIMETER') { polyColor = '#ff0000'; polyWeight = 4; }

                L.polygon(zone.Coordinates, {
                    color: polyColor, weight: polyWeight, fillOpacity: 0.15
                }).addTo(map).bindPopup(`<b>${zone.ZoneName}</b><br>Type: ${zone.ZoneType}`);
            });
            hasDrawnZones = true;
        }

        // 2. Draw Friends & Check SOS
        let activeSosFound = false;
        let sosUserName = "";

        if (data.friends && data.friends.length > 0) {
            data.friends.forEach(friend => {
                let fLat = parseFloat(friend.location.lat);
                let fLon = parseFloat(friend.location.lon);

                // JITTER: Add a tiny random offset (~2 to 5 meters) to prevent exact overlapping
                fLat += (Math.random() - 0.5) * 0.0001;
                fLon += (Math.random() - 0.5) * 0.0001;

                if (friendMarkers[friend.user_id]) {
                    friendMarkers[friend.user_id].setLatLng([fLat, fLon]);
                } else {
                    const friendIcon = L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div style='background-color:#1DB954; width:15px; height:15px; border-radius:50%; border:2px solid white;'></div>`,
                        iconSize: [15, 15],
                        iconAnchor: [7, 7]
                    });

                    const fMarker = L.marker([fLat, fLon], {icon: friendIcon}).addTo(map)
                        .bindPopup(`<b>${friend.name || friend.user_id}</b><br>Zone: ${friend.zone}`);
                    
                    friendMarkers[friend.user_id] = fMarker;
                }

                // Check for SOS
                if (friend.sos_active) {
                    activeSosFound = true;
                    sosUserName = friend.name || friend.user_id;
                    friendMarkers[friend.user_id].setIcon(L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div style='background-color:#ff0000; width:15px; height:15px; border-radius:50%; border:2px solid white; box-shadow: 0 0 10px red;'></div>`,
                        iconSize: [15, 15]
                    }));
                } else {
                     friendMarkers[friend.user_id].setIcon(L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div style='background-color:#1DB954; width:15px; height:15px; border-radius:50%; border:2px solid white;'></div>`,
                        iconSize: [15, 15],
                        iconAnchor: [7, 7]
                    }));
                }
            });
        }

        // 3. Display or hide the global banner
        const banner = document.getElementById('sos-alert-banner');
        if (activeSosFound) {
            document.getElementById('sos-user-name').innerText = sosUserName;
            banner.style.display = 'block';
        } else {
            banner.style.display = 'none';
        }

        // 4. Lineup (Seeded Data)
        if (data.lineup) renderLineupUI(data.lineup);

        // 5. Map Correction Reports (Yellow markers)
        if (data.reports) {
            data.reports.forEach(r => { 
                L.marker([r.Coordinates.lat, r.Coordinates.lon], { 
                    icon: L.divIcon({ html: `<div style='background-color:#ffaa00; width:10px; height:10px; border-radius:50%; border:1px solid white;'></div>` }) 
                }).addTo(map).bindPopup(`<b>Reported:</b> ${r.Description}`); 
            });
        }

    } catch (error) {
        console.error("Fetch failed entirely:", error);
    }
}

// --- LINEUP AND SPOTIFY LOGIC ---
function renderLineupUI(lineup) {
    const list = document.getElementById('artist-list'); 
    if (!list) return;
    list.innerHTML = '';
    
    lineup.forEach(a => {
        const div = document.createElement('div'); 
        div.style = "padding: 10px; background: #222; border-radius: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;";
        div.innerHTML = `
            <div><strong>${a.Name}</strong><br><small>${a.Time} - ${a.Stage}</small></div>
            <button class="sm-btn" style="background:#1DB954; border-radius:50%; width:35px; height:35px; display:flex; justify-content:center; align-items:center;" onclick="playPreview('${a.SpotifyURI}')">
                <i class="fa-solid fa-play"></i>
            </button>`;
        list.appendChild(div);
    });
}

function playPreview(artistId) {
    if (!artistId) return;
    // We use the /artist/ endpoint to get the multi-song playbox
    const embedUrl = `https://open.spotify.com/embed/artist/${artistId.split(':').pop()}?utm_source=generator&theme=0`;
    
    document.getElementById('spotify-player').innerHTML = `
        <iframe style="border-radius:12px" 
        src="${embedUrl}" 
        width="100%" height="352" frameborder="0" 
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
}


// --- UI INTERACTIVITY (FRONTEND SPRINT) ---

// Pending Request Actions
document.querySelectorAll('.sm-btn').forEach(btn => {
    // Only target the text buttons, not the circular play buttons
    if(btn.innerText.includes('Accept') || btn.innerText.includes('Deny')) {
        btn.addEventListener('click', function() {
            const action = this.innerText;
            const requestRow = this.closest('.toggle-row');
            const friendName = requestRow.querySelector('strong').innerText;
            
            console.log(`UI Action: ${action} request from ${friendName}`);
            
            // Remove the request from the UI temporarily to simulate success
            requestRow.style.opacity = '0.5';
            setTimeout(() => requestRow.remove(), 300);
            
            // Wire to AWS /friends ACCEPT endpoint here
        });
    }
});

// --- FRIENDS LIST UI GENERATOR ---
function renderFriendsList(friendsMap) {
    const container = document.getElementById('friends-list-container');
    container.innerHTML = ''; // Clear placeholders

    Object.keys(friendsMap).forEach(fid => {
        const perms = friendsMap[fid];
        const friendDiv = document.createElement('div');
        friendDiv.style.borderBottom = '1px solid #444';
        friendDiv.style.paddingBottom = '10px';
        friendDiv.style.marginBottom = '10px';

        friendDiv.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>${fid}</strong>
                <button class="sm-btn" style="background:#444; font-size:0.7rem;">Remove</button>
            </div>
            <div class="toggle-row">
                <small>Location (Venue)</small>
                <div class="toggle-switch ${perms.shareLocation ? 'on' : ''}" 
                     onclick="updateFriendPerm('${fid}', 'shareLocation', this)"></div>
            </div>
            <div class="toggle-row">
                <small>Campsite Access</small>
                <div class="toggle-switch ${perms.shareCamp ? 'on' : ''}" 
                     onclick="updateFriendPerm('${fid}', 'shareCamp', this)"></div>
            </div>
        `;
        container.appendChild(friendDiv);
    });
}

// Handler for the toggles
async function updateFriendPerm(friendId, key, element) {
    const userId = localStorage.getItem('okee_user_id');
    const isNowOn = !element.classList.contains('on');
    
    // UI Feedback immediately
    element.classList.toggle('on');
    console.log(`Updating ${friendId}: ${key} -> ${isNowOn}`);

    try {
        await fetch(`${API_BASE_URL}/friends`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'UPDATE',
                user_id: userId,
                friend_id: friendId,
                permission_key: key,
                permission_value: isNowOn
            })
        });
    } catch (e) {
        console.error("Failed to sync permission:", e);
    }
}

// --- COGNITO ---
const COGNITO_DOMAIN = 'your-app-domain.auth.us-east-1.amazoncognito.com';
const CLIENT_ID = 'your_client_id_from_aws';
const REDIRECT_URI = 'http://localhost:5500/index.html';

// Robust Cognito Init
function initCognitoButtons() {
    const googleBtn = document.getElementById('google-login-btn');
    const emailBtn = document.getElementById('email-login-btn');
    
    // Only attempt to wire up if the buttons actually exist on the page
    if (googleBtn && emailBtn) {
        const loginUrl = `https://${COGNITO_DOMAIN}/login?client_id=${CLIENT_ID}&response_type=token&scope=email+openid+profile&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
        
        googleBtn.onclick = () => window.location.href = loginUrl;
        emailBtn.onclick = () => window.location.href = loginUrl;
        console.log("Cognito buttons initialized.");
    }
}

// Check for the Cognito token in the URL after redirect
function checkAuthHash() {
    const hash = window.location.hash;
    if (hash.includes('access_token')) {
        const params = new URLSearchParams(hash.substring(1));
        const token = params.get('access_token');
        // We will exchange this token for the user's ID next
        console.log("Cognito Auth Successful. Token received.");
        window.location.hash = ''; // Clear the URL
    }
}

// --- MAP MODAL ACTIONS ---
// Listener for "Mark My Campsite"
document.querySelector('button[style*="background: #32cd32"]').onclick = async () => {
    if (!clickedCoords) return;
    const userId = localStorage.getItem('okee_user_id');
    
    // UI Feedback
    L.marker([clickedCoords.lat, clickedCoords.lng], {
        icon: L.divIcon({html: '🏕️', className: 'camp-icon', iconSize: [25, 25]})
    }).addTo(map).bindPopup("My Campsite").openPopup();

    try {
        await fetch(`${API_BASE_URL}/campsite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userId,
                lat: clickedCoords.lat,
                lon: clickedCoords.lng
            })
        });
        console.log("Campsite saved to AWS.");
    } catch (e) {
        console.error("Failed to save campsite:", e);
    }

    document.getElementById('map-action-modal').classList.remove('open');
};

// Listener for "Map Correction (Wrong Info)"
document.querySelector('button[style*="background: #ffaa00"]').onclick = async () => {
    if (!clickedCoords) return;

    const description = prompt("What's wrong here? (e.g., 'Bathrooms are actually 20ft North')");
    if (!description) return;

    const userId = localStorage.getItem('okee_user_id') || 'Anonymous';

    try {
        const response = await fetch(`${API_BASE_URL}/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userId,
                lat: clickedCoords.lat,
                lon: clickedCoords.lng,
                description: description
            })
        });

        if (response.ok) {
            alert("Report submitted! We'll look into it.");
        }
    } catch (e) {
        console.error("Failed to submit report:", e);
    }

    document.getElementById('map-action-modal').classList.remove('open');
};

// --- SCENE TOGGLE & DEV MODE ---
const btnCamping = document.getElementById('btn-camping');
const btnVenue = document.getElementById('btn-venue');
const mapDiv = document.getElementById('map');
const venueMapContainer = document.getElementById('venue-map-container');
const devPanel = document.getElementById('dev-calibration-panel');

let currentScene = 'camping';

btnCamping.addEventListener('click', () => {
    currentScene = 'camping';
    btnCamping.style.background = '#1DB954'; btnCamping.style.color = 'black';
    btnVenue.style.background = 'transparent'; btnVenue.style.color = 'white';
    mapDiv.style.display = 'block';
    venueMapContainer.style.display = 'none';
    
    // Only fly to location on scene switch if inside the bounds
    if (userMarker && currentSimLat && okeeBounds.contains([currentSimLat, currentSimLon])) {
        map.flyTo([currentSimLat, currentSimLon], 16);
    }
});

btnVenue.addEventListener('click', () => {
    currentScene = 'venue';
    btnVenue.style.background = '#1DB954'; btnVenue.style.color = 'black';
    btnCamping.style.background = 'transparent'; btnCamping.style.color = 'white';
    mapDiv.style.display = 'none';
    venueMapContainer.style.display = 'block';
    updateVenueUserDot(); 
});

// Triple-click SOS to show/hide the Dev panel
let devTapCount = 0;
document.getElementById('sos-btn').addEventListener('click', () => {
    devTapCount++;
    setTimeout(() => { devTapCount = 0; }, 1000);
    if (devTapCount >= 3) {
        devPanel.style.display = devPanel.style.display === 'none' ? 'block' : 'none';
        devTapCount = 0;
    }
});

// --- VENUE MAP PAN ENGINE ---
const venueImgWrapper = document.getElementById('venue-img-wrapper');
let isDraggingVenue = false;
let startX, startY, initialLeft = 0, initialTop = 0;
let currentLeft = 0, currentTop = 0;
let venueScale = 0.8; // Default zoom out

// Centralized function to handle both panning and zooming
function applyVenueTransform() {
    venueImgWrapper.style.transform = `translate(${currentLeft}px, ${currentTop}px) scale(${venueScale})`;
}

function startDrag(clientX, clientY) {
    if (activeAnchor) return; // Don't drag if we are trying to set a pin
    isDraggingVenue = true;
    startX = clientX; 
    startY = clientY;
    currentLeft = initialLeft;
    currentTop = initialTop;
}

function moveDrag(clientX, clientY) {
    if (!isDraggingVenue) return;
    
    // Calculate new position based on drag delta
    currentLeft = initialLeft + (clientX - startX);
    currentTop = initialTop + (clientY - startY);
    
    applyVenueTransform();
}

function endDrag(clientX, clientY) {
    if (isDraggingVenue) {
        initialLeft += clientX - startX;
        initialTop += clientY - startY;
        currentLeft = initialLeft;
        currentTop = initialTop;
        isDraggingVenue = false;
    }
}

// Mouse wheel zoom
venueMapContainer.addEventListener('wheel', (e) => {
    e.preventDefault(); // Stop page scrolling
    const zoomSpeed = 0.05;
    
    if (e.deltaY < 0) {
        venueScale += zoomSpeed; // Scroll up = zoom in
    } else {
        venueScale = Math.max(0.3, venueScale - zoomSpeed); // Scroll down = zoom out (cap at 0.3)
    }
    
    applyVenueTransform();
}, { passive: false });

// Mouse support
venueMapContainer.addEventListener('mousedown', (e) => {
    e.preventDefault(); // Kills native image dragging and text highlighting
    startDrag(e.clientX, e.clientY);
});
window.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
window.addEventListener('mouseup', (e) => endDrag(e.clientX, e.clientY));

// Touch support
venueMapContainer.addEventListener('touchstart', (e) => startDrag(e.touches[0].clientX, e.touches[0].clientY));
window.addEventListener('touchmove', (e) => moveDrag(e.touches[0].clientX, e.touches[0].clientY));
window.addEventListener('touchend', (e) => endDrag(e.changedTouches[0].clientX, e.changedTouches[0].clientY));


// --- CALIBRATION LOGIC (Affine Transform) ---
let anchors = JSON.parse(localStorage.getItem('okee_anchors')) || [];
let activeAnchor = null; 
let currentSimLat = null;
let currentSimLon = null;

// Handle both real GPS and simulated GPS inputs
function handleLocationUpdate(lat, lon) {
    currentSimLat = lat; currentSimLon = lon;
    
    // 1. Update Leaflet
    if (!userMarker) {
        userMarker = L.marker([lat, lon]).addTo(map).bindPopup("<b>You are here</b>");
        // Only center the map if the user is actually at the festival
        if (okeeBounds.contains([lat, lon])) {
            map.flyTo([lat, lon], 16);
        }
    } else {
        userMarker.setLatLng([lat, lon]);
    }
    // 2. Update Custom Venue Image
    if (currentScene === 'venue') updateVenueUserDot();
}

// Simulated GPS ping for living room testing
document.getElementById('dev-set-gps').addEventListener('click', () => {
    const simLat = parseFloat(document.getElementById('dev-lat').value);
    const simLon = parseFloat(document.getElementById('dev-lon').value);
    handleLocationUpdate(simLat, simLon);
});

function setupAnchor(num) {
    if (!currentSimLat) return alert("Simulate a GPS ping first!");
    activeAnchor = num;
    document.getElementById('cal-status').innerText = `Tap image to place Anchor ${num}`;
}
document.getElementById('set-anchor-1').addEventListener('click', () => setupAnchor(1));
document.getElementById('set-anchor-2').addEventListener('click', () => setupAnchor(2));
document.getElementById('set-anchor-3').addEventListener('click', () => setupAnchor(3));

venueImgWrapper.addEventListener('click', (e) => {
    if (!activeAnchor) return;
    
    const rect = venueImgWrapper.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    anchors[activeAnchor - 1] = { lat: currentSimLat, lon: currentSimLon, x: x, y: y };
    localStorage.setItem('okee_anchors', JSON.stringify(anchors));
    
    document.getElementById(`set-anchor-${activeAnchor}`).style.background = '#1DB954';
    document.getElementById('cal-status').innerText = `Anchor ${activeAnchor} saved!`;
    activeAnchor = null;
    updateVenueUserDot();
});

document.getElementById('clear-anchors').addEventListener('click', () => {
    anchors = [];
    localStorage.removeItem('okee_anchors');
    document.getElementById('cal-status').innerText = 'Anchors cleared.';
    [1, 2, 3].forEach(i => document.getElementById(`set-anchor-${i}`).style.background = '#444');
    document.getElementById('user-dot-venue').style.display = 'none';
});

// Exact Math Engine: Converts Lat/Lon to Image Pixels using Barycentric Coordinates
function gpsToPixels(lat, lon) {
    if (anchors.length < 3 || !anchors[0] || !anchors[1] || !anchors[2]) return null;
    
    const [A, B, C] = anchors;
    const detT = (B.lat - C.lat)*(A.lon - C.lon) - (B.lon - C.lon)*(A.lat - C.lat);
    if (detT === 0) return null; 
    
    const wA = ((B.lat - C.lat)*(lon - C.lon) - (B.lon - C.lon)*(lat - C.lat)) / detT;
    const wB = ((C.lat - A.lat)*(lon - C.lon) - (A.lon - C.lon)*(lat - C.lat)) / detT;
    const wC = 1 - wA - wB;
    
    return {
        x: wA * A.x + wB * B.x + wC * C.x,
        y: wA * A.y + wB * B.y + wC * C.y
    };
}

function updateVenueUserDot() {
    if (!currentSimLat || !currentSimLon) return;
    const pxCoords = gpsToPixels(currentSimLat, currentSimLon);
    const dot = document.getElementById('user-dot-venue');
    
    if (pxCoords) {
        dot.style.display = 'block';
        dot.style.left = pxCoords.x + 'px';
        dot.style.top = pxCoords.y + 'px';
    }
}

const venueFriendDots = {};

function renderVenueFriends(friendsList) {
    // If the map isn't calibrated yet, we can't place them on the distorted image
    if (anchors.length < 3 || !anchors[0] || !anchors[1] || !anchors[2]) return;

    const container = document.getElementById('venue-friends-container');

    friendsList.forEach(friend => {
        // Run friend GPS through the affine transformation matrix
        const pxCoords = gpsToPixels(friend.lat, friend.lon);
        if (!pxCoords) return;

        let dot = venueFriendDots[friend.user_id]; // Use whatever ID key your DB returns
        
        // If the dot doesn't exist yet, create it
        if (!dot) {
            dot = document.createElement('div');
            dot.style.position = 'absolute';
            dot.style.width = '14px';
            dot.style.height = '14px';
            dot.style.background = '#ff00ff'; // Change to match your friend marker logic
            dot.style.border = '2px solid #fff';
            dot.style.borderRadius = '50%';
            dot.style.transform = 'translate(-50%, -50%)';
            dot.style.zIndex = '9';
            dot.style.boxShadow = '0 0 8px #ff00ff';
            
            // Add a label for their name/ID
            const label = document.createElement('span');
            label.innerText = friend.name || friend.user_id.substring(0, 3);
            label.style.position = 'absolute';
            label.style.top = '-16px';
            label.style.left = '50%';
            label.style.transform = 'translateX(-50%)';
            label.style.color = '#fff';
            label.style.fontSize = '10px';
            label.style.fontWeight = 'bold';
            label.style.textShadow = '1px 1px 2px #000';
            dot.appendChild(label);

            container.appendChild(dot);
            venueFriendDots[friend.user_id] = dot;
        }
        
        // Update their position on the map
        dot.style.left = pxCoords.x + 'px';
        dot.style.top = pxCoords.y + 'px';
    });
}

// Check initial UI state on load
anchors.forEach((a, i) => { if (a) document.getElementById(`set-anchor-${i+1}`).style.background = '#1DB954'; });