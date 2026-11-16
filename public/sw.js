/* CafePass service worker — PWA packaging (v1)
 *
 * Strategy:
 *  - Navigations (HTML):        network-first → cache → /offline.html
 *  - Same-origin static assets: stale-while-revalidate (immutable _next/static,
 *    /fonts, /brand, /icons)
 *  - Never touch: /api/*, non-GET, cross-origin, browser range requests
 */
const VERSION = 'cafepass-v1'
const STATIC_CACHE = `${VERSION}-static`
const PAGE_CACHE = `${VERSION}-pages`
const OFFLINE_URL = '/offline.html'

const PRECACHE = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PAGE_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

const isStaticAsset = (url) =>
  url.pathname.startsWith('/_next/static/') ||
  url.pathname.startsWith('/fonts/') ||
  url.pathname.startsWith('/brand/') ||
  url.pathname.startsWith('/icons/') ||
  url.pathname === '/manifest.webmanifest'

// Pages that only make sense when signed in. Their HTML is never put in the
// shared page cache: on a shared device the offline fallback could otherwise
// show the previous user's app shell.
const AUTHED_PAGE = /^\/(pass|staff|business|admin)(\/|$)/

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  // Navigations → network-first with offline fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only cache successful, generic pages: no error/redirect responses,
          // no signed-in shells, and never URLs carrying tokens in the query
          // string (e.g. ?resetToken=…) — those must not persist in storage.
          if (res && res.status === 200 && !url.search && !AUTHED_PAGE.test(url.pathname)) {
            const copy = res.clone()
            caches.open(PAGE_CACHE).then((c) => c.put(req, copy)).catch(() => {})
          }
          return res
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match(OFFLINE_URL))
        )
    )
    return
  }

  // Static assets → stale-while-revalidate
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req)
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone())
            return res
          })
          .catch(() => hit)
        return hit || network
      })
    )
  }
})
