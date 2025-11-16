// A simple, no-op service worker that takes immediate control.
// This is the simplest way to get a "PWA" installable app.

const CACHE_NAME = 'recallreader-v9';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',

  // App source files
  '/index.tsx',
  '/App.tsx',
  '/types.ts',
  '/utils/audio.ts',
  '/utils/audioContext.ts',
  '/utils/db.ts',
  '/services/geminiService.ts',
  '/components/AiCoachPanel.tsx',
  '/components/AnnotationPanel.tsx',
  '/components/AudioVisualizer.tsx',
  '/components/Dashboard.tsx',
  '/components/DocumentInput.tsx',
  '/components/ErrorBoundary.tsx',
  '/components/FlashcardViewer.tsx',
  '/components/Icons.tsx',
  '/components/KeyboardShortcutsModal.tsx',
  '/components/Loader.tsx',
  '/components/PageChat.tsx',
  '/components/PdfViewer.tsx',
  '/components/ScanDocument.tsx',
  '/components/StudyPanel.tsx',
  '/components/SummaryModal.tsx',
  '/components/Thumbnail.tsx',

  // Core App Libraries
  'https://aistudiocdn.com/react@^19.2.0',
  'https://aistudiocdn.com/react@^19.2.0/jsx-runtime',
  'https://aistudiocdn.com/react-dom@^19.2.0/client',
  'https://aistudiocdn.com/@google/genai@^1.28.0',
  // PDF.js libraries - for viewer and worker (switched to jsdelivr for better reliability)
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/web/pdf_viewer.min.mjs',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs',
  // Core styling and fonts
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        // All assets in this list are critical for the app to function.
        // If any of them fail to cache, the service worker installation will fail,
        // and the browser will try again later. This is more robust than a partial cache.
        return cache.addAll(URLS_TO_CACHE);
      })
  );
  self.skipWaiting();
});


self.addEventListener('fetch', (event) => {
  // We only want to handle GET requests.
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    // First, try to find a match in the cache.
    caches.match(event.request).then((cachedResponse) => {
      // If a cached response is found, return it.
      if (cachedResponse) {
        return cachedResponse;
      }

      // If no match is found in the cache, fetch the resource from the network.
      return fetch(event.request).then((networkResponse) => {
        // After fetching, open the cache to store the new response.
        return caches.open(CACHE_NAME).then((cache) => {
          // Check for a valid response to cache. We don't want to cache errors.
          // We also need to clone the response because it's a stream that can only be read once.
          if (networkResponse.ok) {
            cache.put(event.request, networkResponse.clone());
          }
          // Return the network response to the browser.
          return networkResponse;
        });
      });
      // If fetch() fails (e.g., user is offline), the promise will reject,
      // and the browser will show its default network error page, which is the correct behavior
      // for a resource that is not in the cache.
    })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});