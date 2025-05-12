// service-worker.js

const CACHE_NAME = 'fittrack-v1.4'; // If you changed it before, keep your latest version number
// Use relative paths from the root where SW is located
const urlsToCache = [
    './', // Cache the root directory (often resolves to index.html)
    'index.html',
    'manifest.json',
    'service-worker.js', // Cache the worker itself
    'icons/icon-192x192.png', // Your main icon
    'icons/badge-72x72.png'    // Your badge icon
];

let activeTimerTimeoutId = null;

// --- Lifecycle Events ---

self.addEventListener('install', event => {
    console.log('SW Install Event: Caching app shell');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('SW Opened cache:', CACHE_NAME);
                console.log('SW Caching:', urlsToCache);
                return cache.addAll(urlsToCache); // Make sure all paths in urlsToCache are correct!
            })
            .then(() => {
                console.log('SW Shell cached successfully. Skipping waiting.');
                return self.skipWaiting();
             })
            .catch(error => {
                console.error('SW Caching failed during install:', error); // Check console if SW fails to install
            })
    );
});

self.addEventListener('activate', event => {
    console.log('SW Activate Event: Cleaning old caches...');
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (!cacheWhitelist.includes(cacheName)) {
                        console.log('SW Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                    return null; // Explicitly return null for items not being deleted
                })
            );
        }).then(() => {
             console.log('SW Claiming clients.');
             return self.clients.claim();
        })
        .catch(error => {
            console.error('SW Activation failed:', error);
        })
    );
});

self.addEventListener('fetch', event => {
    // Basic check to ignore non-GET or chrome extension requests
    if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension://')) {
       return;
    }

    // Cache-first strategy for app shell assets
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Return cache hit, or fetch from network
                return response || fetch(event.request).catch(fetchError => {
                    // Handle network fetch errors (e.g., offline)
                    console.warn('SW Network fetch failed for:', event.request.url, fetchError);
                    // Optionally return a specific offline response here if needed
                    // For example, if it's a navigation request, you might return a fallback HTML page
                    // if (event.request.mode === 'navigate') {
                    //    return caches.match('offline.html'); // Assuming you have an offline.html cached
                    // }
                    throw fetchError; // Re-throw error if not handling offline page specifically
                });
            })
            .catch(error => {
                 // This catch might be redundant if the inner fetch().catch() handles it,
                 // but good for overall robustness.
                 console.error('SW Fetch handling error for:', event.request.url, error);
            })
    );
});


// --- Message Handling for Timer ---

self.addEventListener('message', event => {
    console.log('SW Received message:', event.data);

    if (event.data && event.data.type === 'SCHEDULE_REST_END') {
        const endTime = event.data.endTime;
        const now = Date.now();
        const delay = Math.max(0, endTime - now);

        console.log(`SW Scheduling notification for: ${new Date(endTime).toLocaleTimeString()} (Delay: ${delay}ms)`);

        // Clear any previous timer attempts
        if (activeTimerTimeoutId) {
            clearTimeout(activeTimerTimeoutId);
            activeTimerTimeoutId = null;
        }
        self.registration.getNotifications({ tag: 'rest-timer-notification' })
            .then(notifications => {
                 if(notifications && notifications.length > 0) {
                    console.log(`SW Closing ${notifications.length} previous notifications.`);
                    notifications.forEach(notification => notification.close());
                 }
            }).catch(err => console.error("SW Error closing old notifications:", err));

         // Check Notification permission state (best effort check in SW)
         if (typeof self.Notification !== 'undefined' && self.Notification.permission !== 'granted') {
             console.warn("SW: Notification permission state checked in SW is NOT 'granted'. Notification may fail or depend on setTimeout.");
         }

        // **Attempt TimestampTrigger**
        if ('showTrigger' in Notification.prototype && 'TimestampTrigger' in self) {
            console.log('SW: TimestampTrigger API is supported. Attempting to use it.');
            try {
                self.registration.showNotification("FitTrack: Rest Over!", {
                    body: "Time's up! Let's get back to the workout.",
                    icon: 'icons/icon-192x192.png',
                    badge: 'icons/badge-72x72.png',
                    tag: 'rest-timer-notification',
                    renotify: true,
                    vibrate: [200, 100, 200],
                    showTrigger: new TimestampTrigger(endTime)
                }).then(() => {
                    console.log('SW: TimestampTrigger notification scheduled successfully.');
                }).catch(err => {
                    console.error("SW: ERROR scheduling notification with TimestampTrigger (Promise Rejection):", err);
                    console.warn("SW: Falling back to setTimeout due to TimestampTrigger error.");
                    scheduleWithTimeout(delay);
                });
            } catch (syncError) {
                 console.error("SW: SYNCHRONOUS ERROR scheduling notification with TimestampTrigger:", syncError);
                 console.warn("SW: Falling back to setTimeout due to synchronous TimestampTrigger error.");
                 scheduleWithTimeout(delay);
            }
        } else {
            // **Fallback using setTimeout**
            console.warn('SW: TimestampTrigger API *not* supported or available. Using setTimeout fallback.');
            scheduleWithTimeout(delay);
        }
    }
    else if (event.data && event.data.type === 'CANCEL_REST_TIMER') {
        console.log('SW: Received CANCEL_REST_TIMER message.');
        if (activeTimerTimeoutId) {
            console.log('SW: Clearing active setTimeout ID:', activeTimerTimeoutId);
            clearTimeout(activeTimerTimeoutId);
            activeTimerTimeoutId = null;
        }
        self.registration.getNotifications({ tag: 'rest-timer-notification' })
            .then(notifications => {
                if (notifications && notifications.length > 0) {
                    console.log('SW: Closing existing notifications with tag on cancel.');
                    notifications.forEach(notification => notification.close());
                }
            }).catch(err => console.error("SW Error closing notifications on cancel:", err));
    }
});

function scheduleWithTimeout(delay) {
    // Ensure delay is reasonable, setTimeout has limits
    if (delay > 2147483647) { // Max signed 32-bit integer (approx 24.8 days)
        console.warn(`SW: Requested setTimeout delay (${delay}ms) exceeds maximum, capping.`);
        delay = 2147483647;
    }
    console.log(`SW: Scheduling setTimeout with delay: ${delay}ms`);
    activeTimerTimeoutId = setTimeout(() => {
        console.log('SW: setTimeout timer fired!');
        // Ensure notifications are available before showing
        if ('Notification' in self && self.Notification.permission === 'granted') {
            self.registration.showNotification("FitTrack: Rest Over!", {
                body: "Time's up! Let's get back to the workout.",
                icon: 'icons/icon-192x192.png',
                badge: 'icons/badge-72x72.png',
                tag: 'rest-timer-notification',
                renotify: true,
                vibrate: [200, 100, 200]
            }).catch(err => console.error("SW: Error showing notification from setTimeout:", err));
        } else {
            console.warn("SW: setTimeout fired, but cannot show notification (Permission not granted or Notification API unavailable).")
        }
        activeTimerTimeoutId = null; // Clear the ID after firing
    }, delay);
    console.log(`SW: setTimeout scheduled with ID: ${activeTimerTimeoutId}`);
}


// --- Notification Click Handling ---
self.addEventListener('notificationclick', event => {
    console.log('SW: Notification clicked.');
    const clickedNotification = event.notification;
    clickedNotification.close(); // Close the notification

    // Action: Focus existing window or open a new one
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Check if there's already a window open for this origin+scope
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                // Matching just the origin is usually safe for simple PWAs
                if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                    console.log('SW: Focusing existing client window.');
                    return client.focus();
                }
            }
            // If no window is open, open a new one to the root/start_url
            if (clients.openWindow) {
                console.log('SW: Opening new client window.');
                // Use '.' which refers to the SW's scope (usually the root)
                return clients.openWindow('.');
            }
            return null; // Explicitly return null if no action taken
        })
        .catch(error => {
            console.error('SW: Error handling notification click:', error);
        })
    );
});
