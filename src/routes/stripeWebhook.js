import Stripe from 'stripe'; // Use Nodecompat or similar env setup for this in Workers
 // Your EmailService wrapper
// You need to provide sanitizeAndValidateUrl() and safeKvOperation() as you had in your code
import { Buffer } from 'node:buffer';
import { console } from 'node:inspector';

function sanitizeAndValidateUrl(url) {
  try {
    // Remove whitespace
    let cleanUrl = url.trim();

    // Remove '@' symbol if at start
    cleanUrl = cleanUrl.replace(/^@/, '');

    // Add https:// if no protocol
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `https://${cleanUrl}`;
    }

    // Validate URL
    const urlObj = new URL(cleanUrl);
    return urlObj.origin; // Return the origin (protocol + domain + port)
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



export async function handleStripeWebhook(request, env, ctx) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

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
  apiVersion: '2024-06-20', // ✅ Use a valid date version
  httpClient: Stripe.createFetchHttpClient(), // ✅ Required for Workers
});





    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      throw new Error('Webhook signature verification failed: ' + err.message);
    }

    const safeKvOp = async (op, fallback, errMsg) => {
      try {
        return await op();
      } catch (e) {
        if (e.message.includes('limit exceeded')) return fallback;
        throw e;
      }
    };
console.log(event)
    switch (event.type) {
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        if (typeof customerId !== 'string') break;

        const mainSubscriptionKv = env.SUBSCRIPTION_CONSENTBIT_FRAMER;
        const activeSitesKv = env.ACTIVE_SITES_CONSENTBIT_FRAMER;

        if (mainSubscriptionKv && activeSitesKv) {
          const subscriptionJson = await safeKvOp(() => mainSubscriptionKv.get(customerId), null, 'Failed to get subscription details');
          if (subscriptionJson) {
            let subscriptionDetails = JSON.parse(subscriptionJson);
            const domain = subscriptionDetails.connectDomain;
            if (domain) {
              const cleanDomain = sanitizeAndValidateUrl(domain);
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
        }
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerId = session.customer;
        const email = session.customer_details?.email;
        
        if (!customerId || !email)
          throw new Error('Missing customer ID or email');

        // Find domain from custom fields
        let connectDomain = null;
        if (Array.isArray(session.custom_fields)) {
          const domainField = session.custom_fields.find(f => f.key === 'adddomain');
          const customDomainField = session.custom_fields.find(f => f.key === 'customdomain');
          if (domainField?.text?.value) connectDomain = sanitizeAndValidateUrl(domainField.text.value);
          else if (customDomainField?.text?.value) connectDomain = sanitizeAndValidateUrl(customDomainField.text.value);
        }
        if (!connectDomain) throw new Error('Missing domain');

        if (!env.SUBSCRIPTION_CONSENTBIT_FRAMER || !env.ACTIVE_SITES_CONSENTBIT_FRAMER)
          throw new Error('KV namespaces not configured');

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
        await env.SUBSCRIPTION_CONSENTBIT_FRAMER.put(customerId, JSON.stringify(subscriptionData));

        if (session.subscription) {
          const activeSiteData = {
            active: true,
            subscriptionId: session.subscription,
            customerId,
            email,
            status: session.status,
            lastUpdated: new Date().toISOString(),
            cancelAtPeriodEnd: false,
          };
          await env.ACTIVE_SITES_CONSENTBIT_FRAMER.put(connectDomain, JSON.stringify(activeSiteData));
        }

       try {
    const payload = {
      recipientEmail: body.userData.email || "",
      recipientName: body.userData.name || "",
      subject: "Welcome to ConsentBit 🎉",
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Welcome to ConsentBit</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">

  <h1>Thank You for Signing Up with ConsentBit!</h1>
  <p>
    Thank you for choosing the <b>ConsentBit paid plan!</b>  We're excited to have you onboard and to help you streamline consent and privacy management with ease, reliability, and compliance.
  </p>
  <p>
  The next step is to <b>install the ConsentBit app</b> on your Webflow website. Once installed, you'll be able to publish seamlessly to your custom domain and take advantage of all the premium features included in your plan.
  </p>
  <p>  To get started smoothly, we've prepared a few resources for you: </p>
  <ul>
    <li><a href="https://www.consentbit.com/help-document" target="_blank">Quick Start Guide</a> - step-by-step instructions for setup and deployment.</li>
   <li><a href="https://vimeo.com/1090979483/99f46cddbf" target="_blank">Video Walkthrough </a> - learn how to configure the app from basics to advanced settings. </li>
    <li> <a href="https://www.consentbit.com/blog" target="_blank">Blogs & Newsletter </a> - explore best practices and advanced tips for ongoing optimization.</li>
  </ul>
  <p>Need assistance? We've got you covered:</p>
  <ul>
    <li>Email us anytime at <a href="mailto:web@consentbit.com">web@consentbit.com</a></li>
    <li>Book a <a href="https://calendly.com/jibin-seattlenewmedia/30min">quick support call</a> directly.</li>
    <li>Or fill out our <a href="https://www.consentbit.com/contact" target="_blank">contact form</a> and we'll get back to you shortly.</li>
  </ul>  

  <p>
   If you have any questions, feature suggestions, or need a hand with installation, we're just a message away.
  </p>
  <p>
    Thanks again,<br>
    <strong>The ConsentBit Team</strong><br>    
  </p>

</body>
</html>
    `,
   
    };

    // Call Make webhook
    const makeWebhookUrl = "https://hook.us1.make.com/e6qg4kchtoeicjoo3dy0vdrcxg1het6p"; // <-- add your webhook URL here

    const response = await fetch(makeWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-make-apikey": "6efc13e343adca715c2a0a6d403a9291" 
      },
      body: JSON.stringify(payload)
    });

    const result = await response.text();
    // optional: log result for debugging
    console.log("Email sent:", result);
  } catch (err) {
    // silently handle error
    console.error("Failed to send email:", err);
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
              const activeSiteDataToStore = {
                active: false,
                subscriptionId: subscription.id,
                customerId,
                email: subscriptionDetails.email,
                status: subscription.status,
                lastUpdated: new Date().toISOString(),
                reason: 'deleted',
              };
              await activeSitesKv.put(cleanDomain, JSON.stringify(activeSiteDataToStore));

              subscriptionDetails.isSubscribed = false;
              subscriptionDetails.subscriptionStatus = subscription.status;
              subscriptionDetails.lastUpdated = new Date().toISOString();
              await mainSubscriptionKv.put(customerId, JSON.stringify(subscriptionDetails));
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

        await activeSitesKv.put(cleanDomain, JSON.stringify(activeSiteData));

        // Update main subscription record
        subscriptionDetails.isSubscribed = false;
        subscriptionDetails.subscriptionStatus = 'past_due';
        subscriptionDetails.lastUpdated = new Date().toISOString();
        await mainSubscriptionKv.put(customerId, JSON.stringify(subscriptionDetails));

        break;
      }
case 'customer.subscription.created': {
  const subscriptionCreated = event.data.object ;
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
            await activeSitesKv.put(sanitizedDomain, JSON.stringify(activeSiteData));

            // Update main subscription record
            subscriptionDetails.isSubscribed = isActive;
            subscriptionDetails.subscriptionStatus = subscriptionCreated.status;
            subscriptionDetails.lastUpdated = new Date().toISOString();
            subscriptionDetails.cancelAtPeriodEnd = subscriptionCreated.cancel_at_period_end;

            await mainSubscriptionKv.put(customerIdCreated, JSON.stringify(subscriptionDetails));
          }
        }
      } catch (kvError) {
        console.log('Error updating KV during customer.subscription.created:', kvError);
        // Handle error gracefully as needed
      }
    }
  }
  break;
}

      case 'checkout.session.async_payment_succeeded':
      case 'payment_intent.created':
        // For these event types, log or update KV in a similar detailed manner as above if needed
        // Implement as per your business logic
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
