// service-worker.js

const CACHE_NAME = 'fittrack-v1.5'; // <<<< INCREMENT THIS if you change cached files later
const urlsToCache = [
    './',
    'index.html',
    'manifest.json',
    'service-worker.js',
    'icons/icon-192x192.png',
    'icons/badge-72x72.png'
];

let activeTimerTimeoutId = null;

self.addEventListener('install', event => {
    console.log('SW Install Event: Caching app shell');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('SW Opened cache:', CACHE_NAME);
                console.log('SW Caching:', urlsToCache);
                return cache.addAll(urlsToCache);
            })
            .then(() => {
                console.log('SW Shell cached successfully. Skipping waiting.');
                return self.skipWaiting();
             })
            .catch(error => {
                console.error('SW Caching failed during install:', error);
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
                    return null;
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
    if (event.request.method !== 'GET' || event.request.url.startsWith('chrome-extension://')) {
       return;
    }
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                return response || fetch(event.request).catch(fetchError => {
                    console.warn('SW Network fetch failed for:', event.request.url, fetchError);
                    throw fetchError;
                });
            })
            .catch(error => {
                 console.error('SW Fetch handling error for:', event.request.url, error);
            })
    );
});

self.addEventListener('message', event => {
    console.log('SW Received message:', event.data);

    if (event.data && event.data.type === 'SCHEDULE_REST_END') {
        const endTime = event.data.endTime;
        const now = Date.now();
        const delay = Math.max(0, endTime - now);
        console.log(`SW Scheduling notification for: ${new Date(endTime).toLocaleTimeString()} (Delay: ${delay}ms)`);

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

         if (typeof self.Notification !== 'undefined' && self.Notification.permission !== 'granted') {
             console.warn("SW: Notification permission state checked in SW is NOT 'granted'. Notification may fail or depend on setTimeout.");
         }

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
                    console.error("SW: ERROR scheduling with TimestampTrigger (Promise Rejection):", err);
                    console.warn("SW: Falling back to setTimeout due to TimestampTrigger error.");
                    scheduleWithTimeout(delay);
                });
            } catch (syncError) {
                 console.error("SW: SYNCHRONOUS ERROR with TimestampTrigger:", syncError);
                 console.warn("SW: Falling back to setTimeout due to sync TimestampTrigger error.");
                 scheduleWithTimeout(delay);
            }
        } else {
            console.warn('SW: TimestampTrigger API *not* supported. Using setTimeout fallback.');
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
    if (delay > 2147483647) {
        console.warn(`SW: Requested setTimeout delay (${delay}ms) exceeds maximum, capping.`);
        delay = 2147483647;
    }
    console.log(`SW: Scheduling setTimeout with delay: ${delay}ms`);
    activeTimerTimeoutId = setTimeout(() => {
        console.log('SW: setTimeout timer fired!');
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
            console.warn("SW: setTimeout fired, but cannot show notification (Permission issue or API unavailable).")
        }
        activeTimerTimeoutId = null;
    }, delay);
    console.log(`SW: setTimeout scheduled with ID: ${activeTimerTimeoutId}`);
}

self.addEventListener('notificationclick', event => {
    console.log('SW: Notification clicked.');
    const clickedNotification = event.notification;
    clickedNotification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.startsWith(self.location.origin) && 'focus' in client) {
                    console.log('SW: Focusing existing client window.');
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                console.log('SW: Opening new client window.');
                return clients.openWindow('.');
            }
            return null;
        })
        .catch(error => {
            console.error('SW: Error handling notification click:', error);
        })
    );
});
