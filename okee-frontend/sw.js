const CACHE_NAME = 'okee-tracker-v3'; 
const STATIC_ASSETS = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './manifest.json',
    './okee-map.jpg',
    './venue-2026.jpg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            );
        })
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 1. DO NOT INTERCEPT API CALLS - Let them go straight to network
    if (url.hostname.includes('amazonaws.com')) {
        return; 
    }

    // 2. Map Tiles: Cache-First
    if (url.hostname === 'server.arcgisonline.com') {
        event.respondWith(
            caches.open('map-tiles').then((cache) => {
                return cache.match(event.request).then((response) => {
                    return response || fetch(event.request).then((networkResponse) => {
                        if (networkResponse.ok) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    });
                });
            })
        );
        return;
    }

    // 3. App Shell: Network-First
    event.respondWith(
        fetch(event.request).catch(() => caches.match(event.request))
    );
});