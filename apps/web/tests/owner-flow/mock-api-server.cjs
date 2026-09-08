const http = require("node:http");

// SSR does not possess the browser's bearer token. Returning 404 exercises the
// authenticated client fallback used for archived/private listings in production.
http.createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:3105");
  response.statusCode = request.url === "/healthz" ? 200 : 404;
  response.end(JSON.stringify(request.url === "/healthz"
    ? { status: "ok", fixture: true }
    : { error: { code: "not_found", message: "SSR fixture: authenticate in the browser." } }));
}).listen(4318, "127.0.0.1");
