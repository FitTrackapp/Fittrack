js

const CACHE_NAME = 'fittrack-cache-v2'; // Incremented version for new cache
const urlsToCache = [
  '/Fittrack/',
  '/Fittrack/index.html',
  '/Fittrack/manifest.json',
 
  '/Fittrack/styles/main.css',    
  '/Fittrack/scripts/app.js',     
  '/Fittrack/icons/icon-192x192.png',
  '/Fittrack/icons/icon-512x512.png'
  // Add other essential assets here using the '/Fittrack/' prefix
];

self.addEventListener('install', event => {
  console.log('Service Worker V2: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker V2: Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting())
      .catch(error => {
        console.error('Service Worker V2: Failed to cache during install:', error);
        // Log which URLs might have failed
        urlsToCache.forEach(url => {
            fetch(url).catch(() => console.error('Failed to fetch for caching:', url));
        });
      })
  );
});

self.addEventListener('activate', event => {
  console.log('Service Worker V2: Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker V2: Clearing old cache', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker V2: Clients claimed.');
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', event => {
  // Cache First, then Network strategy
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          // console.log('SW V2: Serving from cache:', event.request.url);
          return response; 
        }
        // console.log('SW V2: Fetching from network:', event.request.url);
        return fetch(event.request).then(
            networkResponse => {
                // Optional: Cache new successful GET requests dynamically
                // Be careful with what you cache dynamically, especially third-party scripts if not intended
                if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
                    // Example: Only cache if it's from your own origin and not a CDN like tailwind
                    if (event.request.url.startsWith(self.location.origin)) { 
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                // console.log('SW V2: Caching new resource:', event.request.url);
                                cache.put(event.request, responseToCache);
                            });
                    }
                }
                return networkResponse;
            }
        ).catch(error => {
            console.error('SW V2: Fetch failed for:', event.request.url, error);
            // Optional: Fallback for offline if not in cache and network fails
            // You would need to create and cache an offline.html page
            // if (event.request.mode === 'navigate') { // Only for page navigations
            //   return caches.match('/Fittrack/offline.html');
            // }
          }); 
      })
  );
});

// Listener for messages from the client (main app script)
self.addEventListener('message', event => {
    console.log('SW V2: Message received from client:', event.data);
    if (event.data && event.data.type === 'SCHEDULE_REST_END') {
        const endTime = event.data.endTime;
        const now = Date.now();
        const delay = Math.max(0, endTime - now);

        // Clear any existing timeout for 'restTimerNotification'
        if (self.restTimerTimeoutId) {
            clearTimeout(self.restTimerTimeoutId);
        }
        
        console.log(`SW V2: Scheduling notification in ${delay / 1000} seconds.`);
        self.restTimerTimeoutId = setTimeout(() => {
            console.log('SW V2: Showing rest timer notification.');
            self.registration.showNotification('FitTrack Rest Timer', {
                body: "Your rest period is over! Time to get back to it.",
                icon: '/Fittrack/icons/icon-192x192.png', // Ensure this path is correct
                vibrate: [200, 100, 200],
                tag: 'rest-timer-notification' // Use a tag to replace previous notifications
            });
            delete self.restTimerTimeoutId; // Clear the timeout ID after firing
        }, delay);
    } else if (event.data && event.data.type === 'CANCEL_REST_TIMER') {
        console.log('SW V2: Cancel rest timer message received.');
        if (self.restTimerTimeoutId) {
            clearTimeout(self.restTimerTimeoutId);
            delete self.restTimerTimeoutId;
            console.log('SW V2: Rest timer notification cancelled.');
        }
        // Close any existing notification with the tag
        self.registration.getNotifications({tag: 'rest-timer-notification'}).then(notifications => {
            notifications.forEach(notification => notification.close());
        });
    }
});
