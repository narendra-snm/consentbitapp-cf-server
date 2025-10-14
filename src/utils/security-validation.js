import { z } from 'zod';

// Example SQL Injection check regex
const sqlInjectionCheck = z.string().refine(
  (val) => !/(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|EXEC|DECLARE)\b)/i.test(val),
  { message: "SQL injection attempt detected" }
);

// XSS Check
const xssCheck = z.string().refine(
  (val) => !/(<script|javascript:|on\w+\s*=)/i.test(val),
  { message: "XSS attempt detected" }
);

const pathTraversalCheck = z.string().refine(
  (val) => !/\.\.\//.test(val),
  { message: "Path traversal attempt detected" }
);

export async function validateJSONBody(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new Error('Invalid JSON');
  }

  if (body && typeof body === 'object') {
    for (const val of Object.values(body)) {
      if (typeof val === 'string') {
        await sqlInjectionCheck.parseAsync(val);
        await xssCheck.parseAsync(val);
        await pathTraversalCheck.parseAsync(val);
      }
    }
  }
  return body;
}
