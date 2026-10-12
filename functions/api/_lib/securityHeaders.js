// The same security headers as public/_headers, for pages built by Functions
// (admin pages, /m/ share links, server-rendered pages).
export const SECURITY_HEADERS = {
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "frame-ancestors 'self'",
  'Strict-Transport-Security': 'max-age=15552000',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), usb=(), interest-cohort=()',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
/** Adds the headers to a Headers object (keeps any already set). */
export function withSecurityHeaders(headers) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!headers.has(k)) headers.set(k, v);
  return headers;
}
