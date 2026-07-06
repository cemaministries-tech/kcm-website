// netlify/functions/kcm-ai.js
// Drop this file into your site's netlify/functions/ folder
// Requires: GROQ_API_KEY set in Netlify → Site Settings → Environment Variables
// Requires: Netlify Identity enabled (Site Configuration → Identity → Enable Identity)
// Uses Netlify Blobs (built-in, free) to track daily credits per user.

const { getStore } = require('@netlify/blobs');

const CREDITS_LOGGED_IN = 30;   // credits per day for signed-in users
const CREDITS_ANONYMOUS = 5;    // credits per day for guests (tracked by IP — not bulletproof, but a reasonable free-tier limit)

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function getCreditBucket(store, key, dailyAllotment) {
  let bucket;
  try {
    const raw = await store.get(key, { type: 'json' });
    bucket = raw || null;
  } catch (e) {
    bucket = null;
  }
  const today = todayKey();
  if (!bucket || bucket.date !== today) {
    bucket = { date: today, remaining: dailyAllotment };
    await store.setJSON(key, bucket);
  }
  return bucket;
}

async function spendCredit(store, key, bucket) {
  bucket.remaining = Math.max(0, bucket.remaining - 1);
  await store.setJSON(key, bucket);
  return bucket;
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  try {
    const body = JSON.parse(event.body || '{}');
    const { messages, system, action } = body;

    // Identify the user — Netlify Identity populates this automatically
    // when the client sends the JWT as "Authorization: Bearer <token>"
    const identityUser = context.clientContext && context.clientContext.user;
    const isLoggedIn = !!identityUser;

    const clientIp =
      event.headers['x-nf-client-connection-ip'] ||
      event.headers['client-ip'] ||
      'unknown-ip';

    const creditKey = isLoggedIn ? `user:${identityUser.sub}` : `anon:${clientIp}`;
    const dailyAllotment = isLoggedIn ? CREDITS_LOGGED_IN : CREDITS_ANONYMOUS;

    const store = getStore('kcm-credits');
    let bucket = await getCreditBucket(store, creditKey, dailyAllotment);

    // Just checking credits — no message sent, no Groq call
    if (action === 'check_credits') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          creditsRemaining: bucket.remaining,
          isAuthenticated: isLoggedIn,
        }),
      };
    }

    // Out of credits
    if (bucket.remaining <= 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          error: {
            message: isLoggedIn
              ? "You're out of credits for today. They refresh tomorrow — come back then."
              : "You're out of free guest credits for today. Sign in for more daily credits.",
          },
          creditsRemaining: 0,
          isAuthenticated: isLoggedIn,
        }),
      };
    }

    // Spend a credit for this message
    bucket = await spendCredit(store, creditKey, bucket);

    // Groq uses OpenAI-compatible format
    const groqMessages = [
      { role: 'system', content: system },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: groqMessages,
        max_tokens: 1000,
        temperature: 0.85,
      }),
    });

    const data = await response.json();

    if (data.choices && data.choices[0]) {
      const text = data.choices[0].message.content;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          content: [{ type: 'text', text }],
          creditsRemaining: bucket.remaining,
          isAuthenticated: isLoggedIn,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        error: { message: data.error?.message || 'Groq returned no response.' },
        creditsRemaining: bucket.remaining,
        isAuthenticated: isLoggedIn,
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: { message: err.message } }),
    };
  }
};
