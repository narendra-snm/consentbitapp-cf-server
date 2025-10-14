export const API_SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none';",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
  'Surrogate-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow, nosnippet, noarchive',
  'X-API-Version': '1.0',
};

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-CSRF-Token, X-API-Key, X-Client-Version, X-Request-ID',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Expose-Headers': 'X-Request-ID, X-API-Version, X-Rate-Limit-Remaining, X-Rate-Limit-Reset',
  'Vary': 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
};

export function applySecurityHeaders(response, extraHeaders = {}) {
  const headers = new Headers(response.headers);

  for (const [key, value] of Object.entries(API_SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  for (const [key, value] of Object.entries(extraHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    ...response,
    headers,
  });
}

// Creates a JSON response with security & CORS headers applied
export function createSecureApiResponse(data, status = 200, extraHeaders = {}) {
  const json = JSON.stringify(data);
  const response = new Response(json, {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
  return applySecurityHeaders(response, extraHeaders);
}

// Creates an empty 204 OPTIONS response with security & CORS headers applied
export function createOptionsResponse() {
  const response = new Response(null, {
    status: 204,
    headers: {},
  });
  return applySecurityHeaders(response);
}

// Creates a 429 rate-limit exceeded response with appropriate headers
export function createRateLimitResponse(resetTime) {
  const body = {
    error: 'Rate limit exceeded',
    message: 'Too many requests. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  };
  if (resetTime) {
    body.resetAt = new Date(resetTime).toISOString();
  }

  const response = new Response(JSON.stringify(body), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
    },
  });
  const extraHeaders = {
    'X-Rate-Limit-Remaining': '0',
    'X-Rate-Limit-Reset': resetTime ? resetTime.toString() : '',
  };
  return applySecurityHeaders(response, extraHeaders);
}
