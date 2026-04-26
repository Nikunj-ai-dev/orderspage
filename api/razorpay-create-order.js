const axios = require('axios');

/**
 * Netlify Serverless Function: Create Razorpay Order
 * POST /api/razorpay-create-order
 * Body: { amount (INR rupees), currency }
 * Returns: { id, amount (paise), currency }
 */

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body = {};
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { amount, currency = 'INR' } = body;

  if (!amount) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing amount' }) };

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid amount' }) };
  }
  if (numAmount < 1) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Amount must be at least ₹1' }) };
  }

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Razorpay not configured' }) };
  }

  try {
    const response = await axios.post(
      'https://api.razorpay.com/v1/orders',
      {
        amount: Math.round(numAmount * 100), // INR → paise
        currency: currency.toUpperCase(),
        receipt: `order_${Date.now()}`,
        notes: { app: 'breakfastclub-orders', created_at: new Date().toISOString() },
      },
      {
        auth: { username: process.env.RAZORPAY_KEY_ID, password: process.env.RAZORPAY_KEY_SECRET },
        timeout: 8000,
      }
    );

    if (!response.data?.id) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Invalid payment service response' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ id: response.data.id, amount: response.data.amount, currency: response.data.currency }),
    };
  } catch (err) {
    const status = err.response?.status;
    let code = 500, msg = 'Failed to create payment order';
    if (status === 400) { code = 400; msg = err.response.data?.error?.description || 'Invalid payment details'; }
    else if (status === 401) { code = 503; msg = 'Payment authentication failed'; }
    else if (status === 429) { code = 429; msg = 'Too many requests. Please try again later.'; }
    else if (err.code === 'ECONNABORTED') { code = 504; msg = 'Payment service timeout. Please try again.'; }
    return { statusCode: code, headers, body: JSON.stringify({ error: msg }) };
  }
};
