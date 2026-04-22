import Stripe from 'stripe';
import { Buffer } from 'node:buffer';

function sanitizeAndValidateUrl(url) {
  try {
    let cleanUrl = url.trim();
    cleanUrl = cleanUrl.replace(/^@/, '');
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `https://${cleanUrl}`;
    }
    const urlObj = new URL(cleanUrl);
    return urlObj.origin;
  } catch (error) {
    console.log(error);
    throw new Error('Invalid URL format');
  }
}

async function safeKvOperation(operation, fallbackValue, errorMessage) {
  try {
    return await operation();
  } catch (error) {
    console.log(errorMessage, error);
    if (error instanceof Error && error.message.includes('limit exceeded')) {
      return fallbackValue;
    }
    throw error;
  }
}

// 🆕 Detect platform from domain
async function detectPlatform(domain) {
  try {
    const targetUrl = domain.startsWith('http') ? domain : `https://${domain}`;
    
    const res = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'platform-detector-bot'
      }
    });

    const html = await res.text();

    // Check for Framer
    const isFramer = html.includes('events.framer.com/script') || html.includes('data-fid=');
    if (isFramer) return 'framer';

    // Check for Webflow
    const isWebflow = html.includes('webflow.com') || html.includes('data-wf-page');
    if (isWebflow) return 'webflow';

    // Not published or unknown platform
    return 'not-published';
  } catch (error) {
    console.error('Platform detection error:', error);
    return 'not-published';
  }
}

// 🆕 Get KV namespaces based on platform
function getKvNamespaces(env, platform) {
  switch (platform) {
    case 'framer':
      return {
        mainSubscriptionKv: env.SUBSCRIPTION_CONSENTBIT_FRAMER,
        activeSitesKv: env.ACTIVE_SITES_CONSENTBIT_FRAMER
      };
    case 'webflow':
      return {
        mainSubscriptionKv: env.SUBSCRIPTION_CONSENTBIT,
        activeSitesKv: env.ACTIVE_SITES_CONSENTBIT
      };
    case 'not-published':
      return {
       mainSubscriptionKv: env.PENDING_SUBSCRIPTION_CONSENTBIT,
        activeSitesKv: env.Pending_Active_site
      };
    default:
      return {
        mainSubscriptionKv: null,
        activeSitesKv: null
      };
  }
}

// 🆕 Get dynamic email content based on platform
function getEmailContent(platform, customerName) {
  const platformName = platform === 'framer' ? 'Framer' : platform === 'webflow' ? 'Webflow' : 'your';
  
  const textContent = `
Thank you for Signing Up with ConsentBit!

Thank you for choosing the ConsentBit paid plan! We're excited to have you onboard and help you streamline consent and privacy management with ease, reliability, and compliance.

The next step is to install the ConsentBit app on your ${platformName} website. Once installed, you'll be able to publish seamlessly to your custom domain and use all the premium features included in your plan.

Need assistance? We've got you covered:
Email us anytime at web@consentbit.com
Book a support call: https://calendly.com/jibin-seattlenewmedia/30min
Contact form: https://www.consentbit.com/contact

If you have any questions, feature suggestions, or need help with installation, we're always here to assist you.

Thanks again,
The ConsentBit Team
  `;

  const htmlContent = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #333;">Thank You for Signing Up with ConsentBit!</h2>
  
  <p>Thank you for choosing the ConsentBit paid plan! We're excited to have you onboard and to help you streamline consent and privacy management with ease, reliability, and compliance.</p>
  
  <p>The next step is to install the ConsentBit app on your <strong>${platformName} website</strong>. Once installed, you'll be able to publish seamlessly to your custom domain and take advantage of all the premium features included in your plan.</p>
  
  <h3 style="color: #333;">Need assistance? We've got you covered:</h3>
  <ul>
    <li>Email us anytime at <a href="mailto:web@consentbit.com">web@consentbit.com</a></li>
    <li><a href="https://calendly.com/jibin-seattlenewmedia/30min">Book a quick support call directly</a>.</li>
    <li>Or fill out our <a href="https://www.consentbit.com/contact">contact form</a> and we'll get back to you shortly.</li>
  </ul>
  
  <p>If you have any questions, feature suggestions, or need a hand with installation, we're just a message away.</p>
  
  <p>Thanks again,<br/>
  <strong>The ConsentBit Team</strong></p>
</div>
  `;

  return { textContent, htmlContent };
}

export async function handleStripeWebhookWebsite(request, env, ctx) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  console.log(env.STRIPE_SECRET_KEY);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const rawArrayBuffer = await request.arrayBuffer();
    const rawBody = Buffer.from(rawArrayBuffer);
    const signature = request.headers.get('stripe-signature');

    if (!signature) throw new Error('Missing stripe-signature header');

    const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
      httpClient: Stripe.createFetchHttpClient(),
    });

    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, env.STRIPE_WEBHOOK_SECRET_TEST);
    } catch (err) {
      throw new Error('Webhook signature verification failed: ' + err.message);
    }

    const session = event.data.object;
    console.log('Received event:', session.metadata);

    // ✅ Metadata check (before switch)
    // if (!session.metadata || session.metadata.key !== 'website') {
    //   console.log('⏩ Ignored: Not a Website event');
    //   return new Response('Ignored (not website)', { status: 200 });
    // }

 if ( session.metadata.key == 'webflow' || session.metadata.key == 'framer') {
      console.log('⏩ Ignored: Not a Website event');
      return new Response('Ignored (not website)', { status: 200 });
    }


    const safeKvOp = async (op, fallback, errMsg) => {
      try {
        return await op();
      } catch (e) {
        if (e.message.includes('limit exceeded')) return fallback;
        throw e;
      }
    };

    console.log(event.type);

    switch (event.type) {
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        if (typeof customerId !== 'string') break;

        // First, try to get subscription from any KV to find the domain
        let subscriptionDetails = null;
        let foundDomain = null;
        
        // Try all three KV namespaces to find the subscription
        const kvNamespaces = [
          { mainKv: env.SUBSCRIPTION_CONSENTBIT_FRAMER, activeKv: env.ACTIVE_SITES_CONSENTBIT_FRAMER },
          { mainKv: env.SUBSCRIPTION_CONSENTBIT_WEBFLOW, activeKv: env.ACTIVE_SITES_CONSENTBIT_WEBFLOW },
          { mainKv: env.SUBSCRIPTION_CONSENTBIT_NOT_PUBLISHED, activeKv: env.ACTIVE_SITES_CONSENTBIT_NOT_PUBLISHED }
        ];

        for (const { mainKv } of kvNamespaces) {
          if (mainKv) {
            const subscriptionJson = await safeKvOp(() => mainKv.get(customerId), null, 'Failed to get subscription details');
            if (subscriptionJson) {
              subscriptionDetails = JSON.parse(subscriptionJson);
              foundDomain = subscriptionDetails.connectDomain;
              break;
            }
          }
        }

        if (subscriptionDetails && foundDomain) {
          const cleanDomain = sanitizeAndValidateUrl(foundDomain);
          
          // 🆕 Detect platform and get appropriate KV namespaces
          const platform = await detectPlatform(cleanDomain);
          const { mainSubscriptionKv, activeSitesKv } = getKvNamespaces(env, platform);

          if (mainSubscriptionKv && activeSitesKv) {
            const isActive = ['active', 'trialing'].includes(subscription.status) && !subscription.cancel_at_period_end;
            const isInactive = ['canceled', 'unpaid', 'past_due', 'incomplete_expired'].includes(subscription.status) || subscription.cancel_at_period_end;

            if (isActive || isInactive) {
              const activeSiteJson = await safeKvOp(() => activeSitesKv.get(cleanDomain), null, 'Failed to get active site data');
              let activeSiteData = activeSiteJson ? JSON.parse(activeSiteJson) : {};

              activeSiteData = {
                ...activeSiteData,
                active: isActive,
                subscriptionId: subscription.id,
                customerId,
                email: subscriptionDetails.email,
                status: subscription.status,
                lastUpdated: new Date().toISOString(),
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
              };

              await safeKvOp(() => activeSitesKv.put(cleanDomain, JSON.stringify(activeSiteData)), undefined, 'Failed to update active site data');

              // Update main subscription record
              subscriptionDetails.isSubscribed = isActive;
              subscriptionDetails.subscriptionStatus = isActive ? subscription.status : 'canceled';
              subscriptionDetails.lastUpdated = new Date().toISOString();
              subscriptionDetails.cancelAtPeriodEnd = subscription.cancel_at_period_end;

              await safeKvOp(() => mainSubscriptionKv.put(customerId, JSON.stringify(subscriptionDetails)), undefined, 'Failed to update subscription details');
            }
          }
        }

        if (subscription.status === "canceled") {
          try {
            const payload = {
              recipientEmail: email || "",
              recipientName: subscription?.name || "",
              subject: "Welcome to ConsentBit 🎉",
              html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #333;">Your ConsentBit Subscription Has Been Canceled</h2>
  <p>Hi ${subscription?.name || 'there'},</p>
  <p>We're sorry to see you go! Your ConsentBit subscription has been successfully canceled, and your premium features will remain active until the end of your current billing period.</p>
  <p>We'd truly appreciate it if you could take a moment to share why you decided to cancel; your feedback helps us improve and make ConsentBit even better for users like you.</p>
  <p>Thank you for giving ConsentBit a try, and we hope to serve you again in the future.</p>
  <p>Warm regards,<br/><strong>The ConsentBit Team</strong></p>
</div>
              `,
              domain: connectDomain,
              
            };

            const makeWebhookUrl = "https://hook.us1.make.com/e6qg4kchtoeicjoo3dy0vdrcxg1het6p";
            const response = await fetch(makeWebhookUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-make-apikey": "6efc13e343adca715c2a0a6d403a9291"
              },
              body: JSON.stringify(payload)
            });

            const result = await response.text();
            console.log("Email sent:", result);
          } catch (err) {
            console.error("Failed to send email:", err);
          }
        }
        break;
      }

      case 'checkout.session.completed': {
        console.log('Processing checkout.session.completed event');
        const session = event.data.object;
        const customerId = session.customer;
        const email = session.customer_details?.email;

        if (!customerId || !email) throw new Error('Missing customer ID or email');

        // Find domain from custom fields
        let connectDomain = null;
        if (Array.isArray(session.custom_fields)) {
          const domainField = session.custom_fields.find(f => f.key === 'yourwebsiteurllivedomain');
          const customDomainField = session.custom_fields.find(f => f.key === 'customdomain');

          if (domainField?.text?.value) connectDomain = sanitizeAndValidateUrl(domainField.text.value);
          else if (customDomainField?.text?.value) connectDomain = sanitizeAndValidateUrl(customDomainField.text.value);
        }

        if (!connectDomain) throw new Error('Missing domain');

        // 🆕 Detect platform and get appropriate KV namespaces
        const platform = await detectPlatform(connectDomain);
        console.log("✅ Detected platform:", platform);
        const { mainSubscriptionKv, activeSitesKv } = getKvNamespaces(env, platform);

        if (!mainSubscriptionKv || !activeSitesKv) throw new Error('KV namespaces not configured');

        const subscriptionData = {
          email,
          connectDomain,
          isSubscribed: true,
          stripeCustomerId: customerId,
          stripeSubscriptionId: session.subscription,
          subscriptionStatus: session.status,
          paymentStatus: session.payment_status,
          created: new Date(session.created * 1000).toISOString(),
          lastUpdated: new Date().toISOString(),
        };

        await mainSubscriptionKv.put(customerId, JSON.stringify(subscriptionData));

        if (session.subscription) {
          const activeSiteData = {
            active: true,
            subscriptionId: session.subscription,
            customerId,
            email,
            status: session.status,
            lastUpdated: new Date().toISOString(),
            cancelAtPeriodEnd: session.cancel_at_period_end || false,
          };

          try {
            // 🆕 Get dynamic email content based on platform
            const { textContent, htmlContent } = getEmailContent(platform, session.customer_details?.name || '');

            const payload = {
              sender: {
                name: "ConsentBit Team",
                email: "web@email.consentbit.com"
              },
              to: [
                {
                  email: email || "",
                  name: session.customer_details?.name || ""
                }
              ],
              subject: "Welcome to ConsentBit 🎉",
              textContent,
              htmlContent,
            };

            const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "api-key": env.BREVO_API_KEY
              },
              body: JSON.stringify(payload)
            });

            const result = await brevoResponse.json();
            console.log("Brevo email sent:", result);
          } catch (err) {
            console.error("Failed to send email:", err);
          }

          try {
            const payload = {
              recipientEmail: email || "",
              recipientName: session.customer || "",
              domain: connectDomain,
              clickup: "paid",
              platform: platform
              
            };

            const makeWebhookUrl = "https://hook.us1.make.com/e6qg4kchtoeicjoo3dy0vdrcxg1het6p";
            const response = await fetch(makeWebhookUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-make-apikey": "6efc13e343adca715c2a0a6d403a9291"
              },
              body: JSON.stringify(payload)
            });

            const result = await response.text();
            console.log("Email sent:", result);
          } catch (err) {
            console.error("Failed to send email:", err);
          }

          await activeSitesKv.put(connectDomain, JSON.stringify(activeSiteData));
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        if (typeof customerId !== 'string') break;

        const mainSubscriptionKv = env.SUBSCRIPTION_CONSENTBIT_FRAMER;
        const activeSitesKv = env.ACTIVE_SITES_CONSENTBIT_FRAMER;

        if (mainSubscriptionKv && activeSitesKv) {
          const subscriptionDetailsJson = await mainSubscriptionKv.get(customerId);
          if (subscriptionDetailsJson) {
            const subscriptionDetails = JSON.parse(subscriptionDetailsJson);
            const domain = subscriptionDetails.connectDomain;
            if (domain) {
              const cleanDomain = sanitizeAndValidateUrl(domain);
              
              // 🆕 Detect platform and get appropriate KV namespaces
              const platform = await detectPlatform(cleanDomain);
              const { mainSubscriptionKv: platformMainKv, activeSitesKv: platformActiveSitesKv } = getKvNamespaces(env, platform);

              if (platformMainKv && platformActiveSitesKv) {
                const activeSiteDataToStore = {
                  active: false,
                  subscriptionId: subscription.id,
                  customerId,
                  email: subscriptionDetails.email,
                  status: subscription.status,
                  lastUpdated: new Date().toISOString(),
                  reason: 'deleted',
                };

                await platformActiveSitesKv.put(cleanDomain, JSON.stringify(activeSiteDataToStore));

                subscriptionDetails.isSubscribed = false;
                subscriptionDetails.subscriptionStatus = subscription.status;
                subscriptionDetails.lastUpdated = new Date().toISOString();

                await platformMainKv.put(customerId, JSON.stringify(subscriptionDetails));
              }
            }
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : null;
        if (!subscriptionId) break;

        // Retrieve subscription details
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const customerId = subscription.customer;
        if (typeof customerId !== 'string') break;

        const mainSubscriptionKv = env.SUBSCRIPTION_CONSENTBIT_FRAMER;
        const activeSitesKv = env.ACTIVE_SITES_CONSENTBIT_FRAMER;

        if (!mainSubscriptionKv || !activeSitesKv) break;

        const subscriptionDetailsJson = await mainSubscriptionKv.get(customerId);
        if (!subscriptionDetailsJson) break;

        const subscriptionDetails = JSON.parse(subscriptionDetailsJson);
        const domain = subscriptionDetails.connectDomain;
        if (!domain) break;

        const cleanDomain = sanitizeAndValidateUrl(domain);

        // 🆕 Detect platform and get appropriate KV namespaces
        const platform = await detectPlatform(cleanDomain);
        const { mainSubscriptionKv: platformMainKv, activeSitesKv: platformActiveSitesKv } = getKvNamespaces(env, platform);

        if (!platformMainKv || !platformActiveSitesKv) break;

        // Update active sites KV
        const activeSiteData = {
          active: false,
          subscriptionId,
          customerId,
          email: subscriptionDetails.email,
          status: 'past_due',
          lastUpdated: new Date().toISOString(),
          reason: 'payment_failed',
        };

        await platformActiveSitesKv.put(cleanDomain, JSON.stringify(activeSiteData));

        // Update main subscription record
        subscriptionDetails.isSubscribed = false;
        subscriptionDetails.subscriptionStatus = 'past_due';
        subscriptionDetails.lastUpdated = new Date().toISOString();

        await platformMainKv.put(customerId, JSON.stringify(subscriptionDetails));
        break;
      }

      case 'customer.subscription.created': {
        const subscriptionCreated = event.data.object;
        const customerIdCreated = subscriptionCreated.customer;
        console.log('customer.subscription.created event received:', subscriptionCreated);

        if (typeof customerIdCreated === 'string') {
          const mainSubscriptionKv = env.SUBSCRIPTION_CONSENTBIT_FRAMER;
          const activeSitesKv = env.ACTIVE_SITES_CONSENTBIT_FRAMER;

          if (mainSubscriptionKv && activeSitesKv) {
            console.log('Processing customer.subscription.created for customerId:', customerIdCreated);
            try {
              const subscriptionDetailsJson = await mainSubscriptionKv.get(customerIdCreated);
              if (subscriptionDetailsJson) {
                const subscriptionDetails = JSON.parse(subscriptionDetailsJson);
                const connectDomain = subscriptionDetails.connectDomain;
                if (connectDomain) {
                  const sanitizedDomain = sanitizeAndValidateUrl(connectDomain);
                  
                  // 🆕 Detect platform and get appropriate KV namespaces
                  const platform = await detectPlatform(sanitizedDomain);
                  const { mainSubscriptionKv: platformMainKv, activeSitesKv: platformActiveSitesKv } = getKvNamespaces(env, platform);

                  if (platformMainKv && platformActiveSitesKv) {
                    const isActive = subscriptionCreated.status === 'active' || subscriptionCreated.status === 'trialing';

                    // Update active sites KV
                    const activeSiteData = {
                      active: isActive,
                      subscriptionId: subscriptionCreated.id,
                      customerId: customerIdCreated,
                      email: subscriptionDetails.email,
                      status: subscriptionCreated.status,
                      lastUpdated: new Date().toISOString(),
                      cancelAtPeriodEnd: subscriptionCreated.cancel_at_period_end,
                    };

                    await platformActiveSitesKv.put(sanitizedDomain, JSON.stringify(activeSiteData));

                    // Update main subscription record
                    subscriptionDetails.isSubscribed = isActive;
                    subscriptionDetails.subscriptionStatus = subscriptionCreated.status;
                    subscriptionDetails.lastUpdated = new Date().toISOString();
                    subscriptionDetails.cancelAtPeriodEnd = subscriptionCreated.cancel_at_period_end;

                    await platformMainKv.put(customerIdCreated, JSON.stringify(subscriptionDetails));
                  }
                }
              }
            } catch (kvError) {
              console.log('Error updating KV during customer.subscription.created:', kvError);
            }
          }
        }
        break;
      }

      case 'checkout.session.async_payment_succeeded':
      case 'payment_intent.created':
        console.log(`Received ${event.type} event`);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true, eventId: event.id, eventType: event.type }), { status: 200 });
  } catch (error) {
    console.error('Webhook handler error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}