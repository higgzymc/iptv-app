const fetch = require('node-fetch');

exports.handler = async (event) => {
  const targetUrl = event.queryStringParameters.url;

  if (!targetUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Target URL parameter is required.' }),
    };
  }

  try {
    const decodedUrl = decodeURIComponent(targetUrl);
    // This log will help us debug in Netlify's function logs
    console.log(`Proxying request to: ${decodedUrl}`);

    // Fetch the data from the IPTV server
    const response = await fetch(decodedUrl);
    const data = await response.text();

    // If the IPTV server itself sent an error (like 403 Forbidden or 500 Server Error)
    if (!response.ok) {
        console.error(`Upstream server error: ${response.status} ${response.statusText}`, data);
        return {
            statusCode: response.status,
            body: `Upstream server returned an error: ${response.statusText}`
        };
    }

    // If everything was successful, return the data
    return {
      statusCode: 200,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
      body: data,
    };
  } catch (error) {
    // This will catch timeouts or other function execution errors
    console.error('Proxy function execution error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'The proxy function failed to execute.',
        error: error.message,
      }),
    };
  }
};
