// /api/stripe-webhook.js
// Receives Stripe's payment confirmation, marks the order paid in Supabase,
// and sends the prepared order email via Resend.
//
// Requires env vars:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET   (from Stripe dashboard -> Webhooks -> this endpoint)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (NOT the anon key — this one must stay server-side only)
//   RESEND_API_KEY
//   ORDERS_EMAIL_TO   (e.g. orders@prestigeirrigation.co.nz)
//   ORDERS_EMAIL_FROM (e.g. orders@prestigeirrigation.co.nz, must be a verified Resend domain)

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Disable Vercel's automatic body parsing — Stripe needs the raw body to verify the signature
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata && session.metadata.order_id;

    if (!orderId) {
      console.error('No order_id in session metadata');
      return res.status(200).json({ received: true });
    }

    try {
      // Mark the order paid
      const { data: order, error: fetchError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

      if (fetchError || !order) {
        console.error('Could not find order', orderId, fetchError);
        return res.status(200).json({ received: true });
      }

      await supabase
        .from('orders')
        .update({ status: 'paid' })
        .eq('id', orderId);

      // Send the prepared order email
      if (order.email_body) {
        await resend.emails.send({
          from: process.env.ORDERS_EMAIL_FROM,
          to: process.env.ORDERS_EMAIL_TO,
          subject: order.email_subject || `Irrigation Order — ${order.job_reference || orderId}`,
          text: order.email_body,
        });

        await supabase
          .from('orders')
          .update({ status: 'sent_to_suppliers' })
          .eq('id', orderId);
      }
    } catch (err) {
      console.error('Error processing paid order:', err.message);
      // Still acknowledge receipt to Stripe — we don't want Stripe retrying forever
      // on our internal errors. Failures here should be checked manually in Supabase.
    }
  }

  return res.status(200).json({ received: true });
};
