const API_BASE_URL = 'https://zbv3895yj1.execute-api.us-east-1.amazonaws.com/Prod';

// 1. Initialize map and lock it to the Festival
const okeeBounds = L.latLngBounds([27.3526, -80.7499], [27.3684, -80.7238]);

const map = L.map('map', {
    center: [27.3598, -80.7335], 
    zoom: 15,
    minZoom: 14,
    // maxBounds: okeeBounds.pad(0.2),
    // maxBoundsViscosity: 1.0
});

L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}').addTo(map);

const mainBounds = [[27.35359, -80.74947], [27.36807, -80.72441]];
L.imageOverlay('okee-map.jpg', mainBounds, { opacity: 0.4 }).addTo(map);

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
            
            if (!userMarker) {
                userMarker = L.marker([lat, lon]).addTo(map).bindPopup("<b>You are here</b>");
                map.flyTo([lat, lon], 16); 
            } else {
                userMarker.setLatLng([lat, lon]);
            }

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
    localStorage.setItem('okee_user_id', userId);
    window.location.href = `${API_BASE_URL}/auth/spotify?user_id=${encodeURIComponent(userId)}`;
});

window.addEventListener('DOMContentLoaded', () => {
    const savedUserId = localStorage.getItem('okee_user_id');
    if (savedUserId) {
        document.getElementById('user-id-input').value = savedUserId;
        console.log("User found in storage:", savedUserId);
    }

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('auth') === 'success') {
        const authBtn = document.getElementById('auth-btn');
        authBtn.innerText = 'Spotify Connected \u2714';
        authBtn.style.backgroundColor = '#1DB954';
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    if (savedUserId) {
        fetchAndDrawMapData(savedUserId);
        startLocationTracking(savedUserId); 
    }
});

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
let hasDrawnZones = false; // Prevents re-drawing polygons on every GPS ping

async function fetchAndDrawMapData(userId) {
    try {
        const response = await fetch(`${API_BASE_URL}/map?user_id=${encodeURIComponent(userId)}`);
        const data = await response.json();
        
        if (data.error) {
            console.error("Backend returned an error:", data.error);
            return;
        }

        // 1. Draw Zones (only once)
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

        // 2. Draw Friends with Coordinate Jitter
        if (data.friends && data.friends.length > 0) {
            data.friends.forEach(friend => {
                let fLat = parseFloat(friend.location.lat);
                let fLon = parseFloat(friend.location.lon);

                // JITTER: Add a tiny random offset (~2 to 5 meters) to prevent exact overlapping
                fLat += (Math.random() - 0.5) * 0.0001;
                fLon += (Math.random() - 0.5) * 0.0001;

                if (friendMarkers[friend.user_id]) {
                    // Update existing marker position
                    friendMarkers[friend.user_id].setLatLng([fLat, fLon]);
                } else {
                    // Create a custom colored icon for friends so they stand out
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
            });
        }
    } catch (error) {
        console.error("Fetch failed entirely:", error);
    }
}