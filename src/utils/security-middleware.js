import { createSecureApiResponse, createOptionsResponse, createRateLimitResponse } from './security-headers';

const RATE_LIMITS = {
  '/api/visitor-token': { requests: 10, window: 60 },
  '/api/auth': { requests: 30, window: 60 },
  '/api/cmp/consent': { requests: 20, window: 60 },
  '/api/analytics': { requests: 30, window: 60 },
  '/api/stripe/webhook': { requests: 100, window: 60 },
  '/api/cookie-preferences': { requests: 50, window: 60 },
  '/api/app-data': { requests: 30, window: 60 },
  '/api/payment': { requests: 10, window: 60 },
  default: { requests: 50, window: 60 },
};

const rateLimitStore = new Map();

function cleanupRateLimitStore() {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

function getRateLimitConfig(pathname) {
  for (const [path, limit] of Object.entries(RATE_LIMITS)) {
    if (path !== 'default' && pathname.startsWith(path)) {
      return limit;
    }
  }
  return RATE_LIMITS.default;
}

async function checkRateLimit(request, pathname) {
  if (Math.random() < 0.01) {
    cleanupRateLimitStore();
  }
  const ip = request.headers.get('CF-Connecting-IP') ||
             request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
             request.headers.get('X-Real-IP') ||
             'unknown';
  const key = `${pathname}:${ip}`;
  const now = Date.now();
  const rateLimit = getRateLimitConfig(pathname);
  const windowMs = rateLimit.window * 1000;
  const existing = rateLimitStore.get(key);

  if (!existing || now > existing.resetTime) {
    const resetTime = now + windowMs;
    rateLimitStore.set(key, { count: 1, resetTime });
    return { allowed: true, remaining: rateLimit.requests - 1, resetTime };
  }

  if (existing.count >= rateLimit.requests) {
    return { allowed: false, remaining: 0, resetTime: existing.resetTime };
  }

  existing.count++;
  return { allowed: true, remaining: rateLimit.requests - existing.count, resetTime: existing.resetTime };
}

function logSecurityEvent(type, request, details) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const userAgent = request.headers.get('User-Agent') || 'unknown';
  const timestamp = new Date().toISOString();
  const pathname = new URL(request.url).pathname;

  console.log(`[SECURITY-${type}] ${timestamp} - IP: ${ip} - ${request.method} ${pathname}`, {
    userAgent: userAgent.substring(0, 100),
    ...details,
  });
}

function checkSuspiciousActivity(request) {
  const userAgent = request.headers.get('User-Agent') || '';
  const suspiciousPatterns = [
    /bot|crawler|spider|scraper/i,
    /curl|wget|python-requests/i,
    // /postman|insomnia/i,
    /scan|probe|test/i,
  ];
  const isSuspicious = suspiciousPatterns.some(pat => pat.test(userAgent) && !userAgent.includes('GoogleBot'));
  if (isSuspicious) {
    logSecurityEvent('SUSPICIOUS_USER_AGENT', request, { userAgent });
    return true;
  }
  return false;
}

function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Helper function to add security headers to any response
function addSecurityHeaders(response, requestId, rateLimitInfo) {
  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers)
  });
  
  newResponse.headers.set('X-Request-ID', requestId);
  newResponse.headers.set('X-RateLimit-Remaining', rateLimitInfo.remaining.toString());
  newResponse.headers.set('X-RateLimit-Reset', rateLimitInfo.resetTime.toString());
  newResponse.headers.set('X-Content-Type-Options', 'nosniff');
  newResponse.headers.set('X-Frame-Options', 'DENY');
  newResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  return newResponse;
}

export function withApiSecurity(handler) {
  return async function securedHandler(request, env) {
    const startTime = Date.now();
    const requestId = generateRequestId();
    const pathname = new URL(request.url).pathname;

    try {
      logSecurityEvent('API_REQUEST', request, { requestId, method: request.method, pathname });

      if (request.method === 'OPTIONS') {
        logSecurityEvent('OPTIONS_REQUEST', request, { requestId });
        return createOptionsResponse();
      }

      if (checkSuspiciousActivity(request)) {
        logSecurityEvent('BLOCKED_SUSPICIOUS', request, { requestId });
        return createRateLimitResponse();
      }

      const rateLimitResult = await checkRateLimit(request, pathname);
      if (!rateLimitResult.allowed) {
        logSecurityEvent('RATE_LIMITED', request, {
          requestId,
          remaining: rateLimitResult.remaining,
          resetTime: rateLimitResult.resetTime,
        });
        return createRateLimitResponse(rateLimitResult.resetTime);
      }

      // Call the handler - it returns a Response object
      const response = await handler(request, env);

      // Add security headers to the response
      const securedResponse = addSecurityHeaders(response, requestId, rateLimitResult);

      const endTime = Date.now();
      logSecurityEvent('API_RESPONSE', request, { 
        requestId, 
        status: response.status, 
        duration: endTime - startTime 
      });

      return securedResponse;
    } catch (error) {
      logSecurityEvent('API_ERROR', request, { requestId, error: error.message || 'Unknown error' });
      return createSecureApiResponse(
        { error: 'Internal server error', requestId },
        500,
        { requestId }
      );
    }
  };
}

export function withSecureApi(handler) {
  return withApiSecurity(handler);
}

export const secureOPTIONS = () => createOptionsResponse();