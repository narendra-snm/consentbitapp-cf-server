import { generateToken, verifyToken } from "../utils/jwt.js";
import { getCorsHeaders } from "../utils/cors.js";
import { validateJSONBody } from "../utils/security-validation.js";
import { EmailService, getEmailService } from './email.js';
export async function stripeWebhook(request, env, origin) {
   try {
      // 1. Get raw request body
      console.log(request)
      const rawBody = await request.arrayBuffer();
      console.log(rawBody )
      // 2. Get Stripe signature
      const signature = request.headers.get('stripe-signature');
      if (!signature) throw new Error('Missing stripe-signature header');
      // 3. Verify Stripe event
      // Stripe's official SDK does not run directly in Workers, so use stripe-node only if you use NodeJS-compat mode or fetch API.
      // For this example, we're going to **assume** signature verification happens elsewhere, or you use a trusted third-party lib.

      // --------- Replace this with actual Stripe verification logic ----------
      // For now, we fake event decoding for demo:
      let event;
      try {
        event = JSON.parse(new TextDecoder().decode(rawBody));
      
      } catch (err) {
        throw new Error('Invalid event payload');
      }
      // ----------------------------------------------------------------------

      // 4. Handle Each Stripe Event Type
      switch (event.type) {
        case 'checkout.session.completed': {
          // Get customer info and custom domain from the event
          const customerId = event.data.object.customer;
          const email = event.data.object.customer_details?.email;
          let connectDomain = null;
          if (event.data.object.custom_fields) {
            for (const field of event.data.object.custom_fields) {
              if (field.key === 'yourwebsiteurllivedomain' && field.text?.value)
                connectDomain = field.text.value;
            }
          }
          if (!customerId || !email || !connectDomain) {
            return new Response('Missing customer info', { status: 400 });
          }

          // Save to KV
          const subscriptionData = {
            email,
            connectDomain,
            isSubscribed: true,
            stripeCustomerId: customerId,
            stripeSubscriptionId: event.data.object.subscription,
            subscriptionStatus: event.data.object.status,
            paymentStatus: event.data.object.payment_status,
            created: new Date(event.data.object.created * 1000).toISOString(),
            lastUpdated: new Date().toISOString()
          };
          await env.SUBSCRIPTION_CONSENTBIT_FRAMER.put(customerId, JSON.stringify(subscriptionData));
          await env.ACTIVE_SITES_CONSENTBIT_FRAMER.put(connectDomain, JSON.stringify({
            active: true,
            subscriptionId: event.data.object.subscription,
            customerId,
            email,
            status: event.data.object.status,
            lastUpdated: new Date().toISOString(),
            cancelAtPeriodEnd: false
          }));

          // Send Payment Success Email
          const emailService = await getEmailService(env);
          await emailService.sendPaymentSuccessEmail({
            recipientEmail: email,
            recipientName: email.split('@')[0],
            siteName: connectDomain.replace('https://', '').replace('http://', ''),
            siteId: customerId,
            activeDomain: connectDomain,
            paymentDetails: {
              subscriptionId: event.data.object.subscription,
              amount: event.data.object.amount_total,
              currency: event.data.object.currency,
              status: event.data.object.status,
              paymentStatus: event.data.object.payment_status
            }
          });

          // Fire-and-forget Make.com and ClickUp integrations
          // You'd use fetch() to call your API endpoints here as async (no await needed)
          // Example:
        //   ctx.waitUntil(
        //     fetch('https://make-webhook.example.com/payment-success', {
        //       method: 'POST',
        //       body: JSON.stringify({ email, siteName: connectDomain, activeDomain: connectDomain, siteId: customerId })
        //     })
        //   );
          // ClickUp: similar fetch call (build request as needed)

          return new Response(JSON.stringify({ received: true, eventId: event.id, eventType: event.type }), { status: 200 });
        }

        // ... Handle other event types ('customer.subscription.updated', 'customer.subscription.deleted', etc.) in similar fashion
        // See previous switch statement in your code for ideas

        default:
          return new Response(JSON.stringify({ received: true, eventId: event.id, eventType: event.type }), { status: 200 });
      }

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 400 });
    }
  }

