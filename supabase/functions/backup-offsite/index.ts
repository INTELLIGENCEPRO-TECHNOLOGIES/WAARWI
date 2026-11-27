const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

Deno.serve((request: Request) => request.method === "OPTIONS"
  ? new Response(null, { headers })
  : new Response(JSON.stringify({ error: "Les sauvegardes utilisent désormais le moteur V3." }), { status: 410, headers }));
