// netlify/functions/kcm-ai.js
// Drop this file into your site's netlify/functions/ folder
// Set GROQ_API_KEY in Netlify → Site Settings → Environment Variables
// Get your FREE key at: https://console.groq.com

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
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
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const { messages, system } = JSON.parse(event.body);

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

    // Normalize to the shape the frontend already expects
    if (data.choices && data.choices[0]) {
      const text = data.choices[0].message.content;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          content: [{ type: 'text', text }],
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        error: { message: data.error?.message || 'Groq returned no response.' },
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
