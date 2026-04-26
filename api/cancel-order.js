const { createClient } = require('@supabase/supabase-js');

/**
 * Netlify Serverless Function: Cancel Order
 * POST /api/cancel-order
 * Body: { orderId, orderName, reason, sessionToken }
 */

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

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

  const { orderId, orderName, reason } = body;

  if (!orderId && !orderName) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing orderId or orderName' }) };
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Service temporarily unavailable' }) };
  }

  try {
    const { error: updateError } = await Promise.race([
      supabase
        .from('orders_cache')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
          cancel_reason: reason || 'Customer requested',
          cancel_requested_at: new Date().toISOString(),
        })
        .or(`shopify_order_id.eq.${orderId},order_name.eq.${orderName}`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Update timeout')), 10000)),
    ]);

    if (updateError) {
      console.error('Cancel order error:', updateError.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to cancel order' }) };
    }

    // Log cancellation (best-effort)
    try {
      await supabase.from('order_cancellations').insert({
        order_id: orderId,
        order_name: orderName,
        reason,
        cancelled_at: new Date().toISOString(),
      });
    } catch {}

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Order cancelled successfully' }),
    };
  } catch (err) {
    console.error('Cancel order error:', err);
    return {
      statusCode: err.message?.includes('timeout') ? 504 : 500,
      headers,
      body: JSON.stringify({ error: err.message || 'Failed to cancel order' }),
    };
  }
};
