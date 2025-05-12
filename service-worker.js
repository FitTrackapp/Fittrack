// service-worker.js

const CACHE_NAME = 'fittrack-v1.1'; // Increment version when you update assets
const urlsToCache = [
    '/', // Cache the root/index page
    '/index.html', // Explicitly cache the main HTML
    // Add other *essential* local assets if needed (e.g., a separate CSS or JS file)
    // '/style.css',
    // '/app.js',
    '/icons/icon-192x192.png', // Cache key icons
    '/icons/icon-512x512.png',
    '/icons/badge-72x72.png' // Cache badge icon if you created one
    // Note: Avoid caching external resources like Tailwind CDN or Google Fonts directly in 'install'
    // as failure to fetch one can break the entire install. Cache them via 'fetch' if needed.
];

let activeTimerTimeoutId = null; // To store setTimeout ID for timer fallback

// --- Lifecycle Events ---

// Install event: Cache essential app assets
self.addEventListener('install', event => {
    console.log('Service Worker: Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Service Worker: Caching app shell');
                return cache.addAll(urlsToCache);
            })
            .then(() => self.skipWaiting()) // Activate new SW immediately
            .catch(error => {
                console.error('Service Worker: Caching failed during install:', error);
            })
    );
});

// Activate event: Clean up old caches
self.addEventListener('activate', event => {
    console.log('Service Worker: Activating...');
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (!cacheWhitelist.includes(cacheName)) {
                        console.log('Service Worker: Deleting old cache', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim()) // Take control of clients immediately
    );
});

// Fetch event: Serve cached assets first, fallback to network (Cache-First Strategy)
self.addEventListener('fetch', event => {
    // Let browser handle non-GET requests or chrome-extension:// requests
    if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension://')) {
       return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Cache hit - return response
                if (response) {
                    // console.log('Service Worker: Serving from cache:', event.request.url);
                    return response;
                }

                // Not in cache - fetch from network
                // console.log('Service Worker: Fetching from network:', event.request.url);
                return fetch(event.request).then(
                    networkResponse => {
                        // Optional: Cache dynamically fetched resources if needed (e.g., CDNs)
                        // Be careful what you cache here.
                        /* if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') { // Only cache valid, same-origin responses by default
                            const responseToCache = networkResponse.clone();
                            caches.open(CACHE_NAME).then(cache => {
                                cache.put(event.request, responseToCache);
                            });
                        } */
                        return networkResponse;
                    }
                ).catch(error => {
                    console.error('Service Worker: Fetch failed; returning offline page or error response.', error);
                    // Optional: Return a custom offline page if fetch fails and it's a navigation request
                    // if (event.request.mode === 'navigate') {
                    //     return caches.match('/offline.html');
                    // }
                });
            })
    );
});


// --- Message Handling for Timer ---

self.addEventListener('message', event => {
    console.log('Service Worker: Received message', event.data);

    if (event.data && event.data.type === 'SCHEDULE_REST_END') {
        const endTime = event.data.endTime;
        const now = Date.now();
        const delay = Math.max(0, endTime - now); // Ensure delay isn't negative

        console.log(`Service Worker: Scheduling notification for endTime: ${new Date(endTime).toLocaleTimeString()}, delay: ${delay}ms`);

        // Clear any previous timer notification attempts (important!)
        clearTimeout(activeTimerTimeoutId);
        self.registration.getNotifications({ tag: 'rest-timer-notification' })
            .then(notifications => {
                notifications.forEach(notification => notification.close());
            });


        // **Method 1: Using showTrigger (Preferred, check compatibility)**
        if ('showTrigger' in Notification.prototype && 'TimestampTrigger' in self) {
            console.log('Service Worker: Using TimestampTrigger');
             self.registration.showNotification("FitTrack: Rest Over!", {
                body: "Time's up! Let's get back to the workout.",
                icon: '/icons/icon-192x192.png',
                badge: '/icons/badge-72x72.png', // Optional: Shows on Android
                tag: 'rest-timer-notification',    // Groups notifications
                vibrate: [200, 100, 200],          // Optional vibration pattern
                showTrigger: new TimestampTrigger(endTime) // Schedule it!
            }).catch(err => {
                console.error("Service Worker: Error scheduling notification with trigger:", err);
                // Maybe try setTimeout fallback here if trigger fails?
                scheduleWithTimeout(delay);
            });
        } else {
            // **Method 2: Fallback using setTimeout (Less reliable if SW is terminated)**
             console.warn('Service Worker: showTrigger not supported or available, using setTimeout fallback.');
             scheduleWithTimeout(delay);
        }
    }
     else if (event.data && event.data.type === 'CANCEL_REST_TIMER') {
        console.log('Service Worker: Received cancel request.');
        // Clear the setTimeout if it was used
         if (activeTimerTimeoutId) {
            console.log('Service Worker: Clearing active setTimeout.');
            clearTimeout(activeTimerTimeoutId);
            activeTimerTimeoutId = null;
         }
        // Close any potentially scheduled or showing notification with the tag
         self.registration.getNotifications({ tag: 'rest-timer-notification' })
            .then(notifications => {
                notifications.forEach(notification => notification.close());
                console.log('Service Worker: Closed existing notifications with tag.');
            });
        // Note: Reliably cancelling a future TimestampTrigger notification isn't straightforward.
        // Closing existing ones and clearing setTimeout is the best effort.
    }
});

function scheduleWithTimeout(delay) {
    activeTimerTimeoutId = setTimeout(() => {
        console.log('Service Worker: setTimeout triggered notification');
        self.registration.showNotification("FitTrack: Rest Over!", {
            body: "Time's up! Let's get back to the workout.",
            icon: '/icons/icon-192x192.png',
            badge: '/icons/badge-72x72.png',
            tag: 'rest-timer-notification',
            vibrate: [200, 100, 200]
        });
        activeTimerTimeoutId = null; // Clear the ID after firing
     }, delay);
     console.log(`Service Worker: setTimeout scheduled with ID: ${activeTimerTimeoutId}`);
}


// --- Notification Click Handling ---

self.addEventListener('notificationclick', event => {
    console.log('Service Worker: Notification clicked.');
    const clickedNotification = event.notification;
    clickedNotification.close(); // Close the notification

    // Action to take: Focus existing window or open a new one
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Check if there's already a window open for this origin
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                // Adjust the URL check if your start_url is different
                if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                    console.log('Service Worker: Focusing existing client window.');
                    return client.focus();
                }
            }
            // If no window is open, open a new one
            if (clients.openWindow) {
                console.log('Service Worker: Opening new client window.');
                return clients.openWindow('/'); // Open the root page
            }
        })
    );
});
