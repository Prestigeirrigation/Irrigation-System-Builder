// /api/create-checkout-session.js
// Creates a Stripe Checkout Session for a given order, returns the URL to redirect to.
// Requires env vars: STRIPE_SECRET_KEY, PUBLIC_APP_URL

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { orderId, amountCents, jobReference } = req.body || {};

  if (!orderId || !amountCents || amountCents <= 0) {
    return res.status(400).json({ error: 'Missing or invalid orderId/amountCents' });
  }

  try {
    const appUrl = process.env.PUBLIC_APP_URL || 'https://irrigation-system-builder-9vn9.vercel.app';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'nzd',
            product_data: {
              name: `Irrigation Parts Order${jobReference ? ' — ' + jobReference : ''}`,
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      metadata: {
        order_id: orderId,
      },
      success_url: `${appUrl}/?payment=success`,
      cancel_url: `${appUrl}/?payment=cancelled`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe session creation failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
