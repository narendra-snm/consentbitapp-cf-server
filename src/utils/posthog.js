// ─────────────────────────────────────────────────────────────────────────────
// posthog.js — server-side PostHog capture.
//
// Analytics are emitted from the Worker, never from the Framer plugin. That way
// the plugin ships no third-party analytics code and sends no user data to a
// third party — it only ever talks to our own API.
//
// Plain fetch against PostHog's capture endpoint (no SDK), so nothing
// Node-specific is pulled into the Workers runtime.
//
// Requires the POSTHOG_API_KEY secret (`wrangler secret put POSTHOG_API_KEY`).
// ─────────────────────────────────────────────────────────────────────────────

// PostHog US cloud — matches the project the plugin previously reported to.
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

/**
 * Send a single event to PostHog.
 *
 * Never throws: analytics must never break the request it rides along with, so
 * every failure is logged and swallowed.
 *
 * Passing `set` writes person properties ($set), which is what makes the person
 * profile appear in PostHog — no separate $identify event is needed.
 *
 * @param {object} env                 Worker env (POSTHOG_API_KEY, optional POSTHOG_HOST)
 * @param {object} opts
 * @param {string} opts.event          Event name, e.g. "app_opened"
 * @param {string} opts.distinctId     Person identifier — we use the user's email
 * @param {object} [opts.properties]   Event properties
 * @param {object} [opts.set]          Person properties to $set (acts as identify)
 */
export async function captureEvent(env, { event, distinctId, properties = {}, set }) {
	if (!env?.POSTHOG_API_KEY) {
		console.warn('[posthog] POSTHOG_API_KEY not configured — skipping event:', event);
		return;
	}
	if (!distinctId) {
		console.warn('[posthog] no distinctId — skipping event:', event);
		return;
	}

	const host = env.POSTHOG_HOST || DEFAULT_POSTHOG_HOST;
	const props = { ...properties };
	if (set) props.$set = set;

	try {
		const res = await fetch(`${host}/capture/`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				api_key: env.POSTHOG_API_KEY,
				event,
				distinct_id: distinctId,
				properties: props,
				timestamp: new Date().toISOString(),
			}),
		});

		if (!res.ok) {
			console.error('[posthog] capture failed:', event, res.status, await res.text());
		}
	} catch (err) {
		console.error('[posthog] capture error:', event, err);
	}
}

/**
 * Per-user login counter, replacing the localStorage counter the plugin used to
 * keep. Stored in the given KV namespace under `sessions:<email>` (no TTL).
 * Returns the new count; falls back to 1 if KV is unavailable.
 */
export async function bumpSessionCount(kv, email) {
	if (!kv || !email) return 1;
	try {
		const prev = parseInt((await kv.get(`sessions:${email}`)) || '0', 10) || 0;
		const next = prev + 1;
		await kv.put(`sessions:${email}`, String(next));
		return next;
	} catch (err) {
		console.error('[posthog] session count failed:', err);
		return 1;
	}
}
