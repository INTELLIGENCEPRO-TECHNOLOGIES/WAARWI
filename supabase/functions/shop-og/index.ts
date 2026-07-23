import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const FALLBACK_IMAGE = 'https://bomiqqqfjpeyvvnwphgi.supabase.co/storage/v1/object/public/brand-logos/waarwi-og-default.png';
const PLATFORM_NAME = 'WAARWI';
const PLATFORM_DESC = 'WAARWI — Plateforme Business 2.0 made in Sénégal';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml(opts: {
  title: string;
  description: string;
  image: string;
  url: string;
}): string {
  const title = escapeHtml(opts.title);
  const desc = escapeHtml(opts.description);
  const img = escapeHtml(opts.image);
  const url = escapeHtml(opts.url);
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<meta property="og:type" content="website" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:image" content="${img}" />
<meta property="og:url" content="${url}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
<meta name="twitter:image" content="${img}" />
</head>
<body>
<p>${desc}</p>
<p><a href="${url}">Ouvrir la boutique</a></p>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get('slug') || '';
    const origin = url.searchParams.get('origin') || `https://${url.host}`;
    const shopUrl = slug ? `${origin}/shop/${slug}` : origin;

    if (!slug) {
      return new Response(
        buildHtml({ title: PLATFORM_NAME, description: PLATFORM_DESC, image: FALLBACK_IMAGE, url: origin }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id,name,logo_url,is_active,approval_status,enabled_modules,business_type')
      .eq('public_slug', slug)
      .maybeSingle();

    const modules: string[] = Array.isArray((tenant as any)?.enabled_modules) ? (tenant as any).enabled_modules : [];
    const moduleEnabled = modules.length === 0 || modules.includes('online_orders');
    const tenantOk = (tenant as any)?.is_active !== false && ((tenant as any)?.approval_status || 'approved') === 'approved';

    if (!tenant || !moduleEnabled || !tenantOk) {
      return new Response(
        buildHtml({ title: PLATFORM_NAME, description: PLATFORM_DESC, image: FALLBACK_IMAGE, url: shopUrl }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }

    const { data: settings } = await supabase
      .from('shop_settings')
      .select('shop_name,tagline,logo_url')
      .eq('tenant_id', (tenant as any).id)
      .maybeSingle();

    const shopName = (settings as any)?.shop_name || (tenant as any).name || PLATFORM_NAME;
    const tagline = (settings as any)?.tagline || `${shopName} sur WAARWI`;
    const logo = (settings as any)?.logo_url || (tenant as any).logo_url || FALLBACK_IMAGE;

    return new Response(
      buildHtml({ title: shopName, description: tagline, image: logo, url: shopUrl }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } },
    );
  } catch (err) {
    const url = new URL(req.url);
    const shopUrl = `https://${url.host}`;
    return new Response(
      buildHtml({ title: PLATFORM_NAME, description: PLATFORM_DESC, image: FALLBACK_IMAGE, url: shopUrl }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
});
