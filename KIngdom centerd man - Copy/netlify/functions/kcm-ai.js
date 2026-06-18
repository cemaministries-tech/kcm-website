// netlify/functions/kcm-ai.js
// Drop this file into your site's netlify/functions/ folder
// Set GEMINI_API_KEY in Netlify → Site Settings → Environment Variables
// Get your FREE key at: https://aistudio.google.com/app/apikey

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

    // Convert chat history to Gemini format
    // Gemini uses "user" and "model" roles (not "assistant")
    const geminiContents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: system }],
        },
        contents: geminiContents,
        generationConfig: {
          maxOutputTokens: 1000,
          temperature: 0.85,
        },
      }),
    });

    const data = await response.json();

    // Normalize Gemini response to match the shape the frontend expects
    if (data.candidates && data.candidates[0]) {
      const text = data.candidates[0].content.parts[0].text;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          content: [{ type: 'text', text }],
        }),
      };
    }

    // Surface Gemini errors clearly
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        error: { message: data.error?.message || 'Gemini returned no response.' },
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
