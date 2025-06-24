// This file acts as a serverless function on Netlify.
// It takes a URL, fetches it on the server-side, and returns the data.
// This avoids browser CORS errors.
const fetch = require('node-fetch');

exports.handler = async (event) => {
  // Get the target URL from the `url` query parameter passed by the frontend.
  const targetUrl = event.queryStringParameters.url;

  if (!targetUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Target URL parameter is required.' }),
    };
  }

  try {
    // Decode the URL and fetch it.
    const response = await fetch(decodeURIComponent(targetUrl));
    // Get the data as plain text to handle both JSON and XML responses.
    const data = await response.text();

    // Return the data and status code from the original source.
    return {
      statusCode: response.status,
      // Pass through the original content type.
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
      body: data,
    };
  } catch (error) {
    console.error('Proxy function error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'The proxy function failed to fetch the URL.' }),
    };
  }
};
