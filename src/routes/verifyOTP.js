import { getCorsHeaders } from '../utils/cors.js';
import { validateJSONBody } from '../utils/security-validation.js';
import { generateToken } from '../utils/jwt.js';
import { captureEvent, bumpSessionCount } from '../utils/posthog.js';

const OTP_TTL_SECONDS = 10 * 60;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateOTP() {
	const buf = new Uint32Array(1);
	crypto.getRandomValues(buf);
	return String(buf[0] % 1000000).padStart(6, '0');
}

function otpEmailPayload(email, otp, name) {
	const greetingName = (name && name.trim()) || 'there';
	return {
		sender: { name: 'ConsentBit', email: 'web@email.consentbit.com' },
		to: [{ email }],
		subject: 'Your ConsentBit verification code',
		textContent: `
Hello ${greetingName},

Your verification code is: ${otp}

This code will expire in 10 minutes, so please use it as soon as possible.

If you did not request this verification code, you can safely ignore this email.

Best regards,
ConsentBit Team
		`,
		htmlContent: `
<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8"><title>Your ConsentBit verification code</title></head>
  <body style="font-family: Arial, sans-serif; background:#f5f7fb; margin:0; padding:32px; color:#1f2937;">
    <table align="center" cellpadding="0" cellspacing="0" width="480" style="background:#ffffff; border-radius:12px; box-shadow:0 2px 8px rgba(15,23,42,0.06); padding:32px;">
      <tr>
        <td>
          <h2 style="margin:0 0 16px 0; color:#111827;">Your ConsentBit verification code</h2>
          <p style="margin:0 0 16px 0; color:#374151; line-height:1.6;">
            Hello <strong>${greetingName}</strong>,
          </p>
          <p style="margin:0 0 20px 0; color:#374151; line-height:1.6;">
            Your verification code is:
          </p>
          <div style="text-align:center; margin:24px 0;">
            <div style="
              display:inline-block;
              font-family: 'Courier New', monospace;
              font-size:32px;
              letter-spacing:8px;
              font-weight:700;
              padding:16px 24px;
              background:#262e84;
              color:#ffffff;
              border-radius:10px;
              -webkit-user-select: all;
              -moz-user-select: all;
              -ms-user-select: all;
              user-select: all;
              cursor: pointer;
            ">${otp}</div>
          </div>
          <p style="margin:16px 0 0 0; color:#374151; line-height:1.6;">
            This code will expire in <strong>10 minutes</strong>, so please use it as soon as possible.
          </p>
          <p style="margin:16px 0 0 0; color:#6b7280; font-size:13px; line-height:1.6;">
            If you did not request this verification code, you can safely ignore this email.
          </p>
          <hr style="border:none; border-top:1px solid #e5e7eb; margin:24px 0;">
          <p style="margin:0; color:#374151; font-size:13px; line-height:1.6;">
            Best regards,<br>
            <strong>ConsentBit Team</strong>
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
		`,
	};
}

export async function handleVerifyOTP(url, request, env, origin, ctx) {
	try {
		const kv = env['verify-email'];

		if (request.method === 'POST' && url.pathname === '/email/request-otp') {
			if (!kv) {
				return new Response(JSON.stringify({ error: 'verify-email KV binding missing' }), {
					status: 500,
					headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
				});
			}

			const body = await validateJSONBody(request);
			const email = (body?.email || '').trim().toLowerCase();
			const name = (body?.name || '').trim();

			if (!email || !EMAIL_REGEX.test(email)) {
				return new Response(JSON.stringify({ error: 'Valid email is required' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
				});
			}

			const otp = generateOTP();
			const record = {
				otp,
				email,
				name,
				attempts: 0,
				createdAt: new Date().toISOString(),
			};

			await kv.put(`otp:${email}`, JSON.stringify(record), { expirationTtl: OTP_TTL_SECONDS });

			const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'api-key': env.BREVO_API_KEY,
				},
				body: JSON.stringify(otpEmailPayload(email, otp, name)),
			});

			if (!brevoResponse.ok) {
				const details = await brevoResponse.text();
				console.error('Brevo OTP send failed:', brevoResponse.status, details);
				await kv.delete(`otp:${email}`);
				return new Response(JSON.stringify({ error: 'Failed to send OTP email' }), {
					status: 502,
					headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
				});
			}

			return new Response(
				JSON.stringify({ success: true, message: 'OTP sent', expiresInSeconds: OTP_TTL_SECONDS }),
				{ status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) } }
			);
		}

		if (request.method === 'POST' && url.pathname === '/email/verify-otp') {
			if (!kv) {
				return new Response(JSON.stringify({ error: 'verify-email KV binding missing' }), {
					status: 500,
					headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
				});
			}

			const body = await validateJSONBody(request);
			const email = (body?.email || '').trim().toLowerCase();
			const otp = (body?.otp || '').toString().trim();
			const siteId = body?.siteId || null;

			if (!email || !otp) {
				return new Response(JSON.stringify({ error: 'email and otp are required' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
				});
			}

			if (!env.JWT_SECRET) {
				return new Response(JSON.stringify({ error: 'JWT_SECRET not set' }), {
					status: 500,
					headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
				});
			}

			const raw = await kv.get(`otp:${email}`);
			if (!raw) {
				return new Response(JSON.stringify({ verified: false, error: 'OTP expired or not found' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
				});
			}

			const record = JSON.parse(raw);

			if (record.attempts >= 5) {
				await kv.delete(`otp:${email}`);
				return new Response(JSON.stringify({ verified: false, error: 'Too many attempts. Request a new OTP.' }), {
					status: 429,
					headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
				});
			}

			if (record.otp !== otp) {
				record.attempts += 1;
				await kv.put(`otp:${email}`, JSON.stringify(record), { expirationTtl: OTP_TTL_SECONDS });
				return new Response(
					JSON.stringify({ verified: false, error: 'Invalid OTP', attemptsLeft: 5 - record.attempts }),
					{ status: 400, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) } }
				);
			}

			await kv.delete(`otp:${email}`);

			const AUTH_JWT_SECRET = new TextEncoder().encode(env.JWT_SECRET);
			const user = { email, siteId, verifiedAt: new Date().toISOString() };
			const token = await generateToken(user, AUTH_JWT_SECRET);

			// Analytics — emitted here, server-side, because the Framer plugin no
			// longer talks to PostHog directly (Marketplace forbids loading
			// third-party scripts and sending user data to third-party analytics).
			// This is the moment authorization completes, which is exactly where the
			// plugin used to fire `app_opened`. The `$set` block doubles as the
			// identify call, keyed on the user's email.
			//
			// waitUntil keeps this off the response path, so verify-otp stays fast.
			const analytics = (async () => {
				const sessionCount = await bumpSessionCount(kv, email);
				// Step 1 — framer_app_opened. project_id is the Framer project/site id.
				// The $set block doubles as the identify call, keyed on the email.
				await captureEvent(env, {
					event: 'framer_app_opened',
					distinctId: email,
					properties: { platform: 'framer', session_count: sessionCount, project_id: siteId },
					set: { email, platform: 'framer', signup_source: 'organic' },
				});
				// Step 2 — auth_completed. This branch is only reached after the OTP
				// is validated, so authorization always succeeded here.
				await captureEvent(env, {
					event: 'auth_completed',
					distinctId: email,
					properties: { platform: 'framer', status: 'success', project_id: siteId },
				});
			})();

			if (ctx?.waitUntil) {
				ctx.waitUntil(analytics);
			} else {
				await analytics;
			}

			return new Response(JSON.stringify({ success: true, verified: true, token, user }), {
				status: 200,
				headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
			});
		}

		return null;
	} catch (err) {
		console.error('verifyOTP error:', err);
		return new Response(JSON.stringify({ error: err.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
		});
	}
}
