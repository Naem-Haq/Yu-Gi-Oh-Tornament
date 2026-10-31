// Public image endpoint; no private deck data is queried or returned.
// Supabase supplies these server-only credentials automatically.
const url = Deno.env.get('SUPABASE_URL')!;
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const headers = { apikey: secret, Authorization: `Bearer ${secret}` };
Deno.serve(async req => {
  if (req.method !== 'GET') return new Response('Method not allowed', {status:405});
  const id = new URL(req.url).searchParams.get('id');
  if (!id || !/^\d{1,9}$/.test(id)) return new Response('Invalid card', {status:400});
  const cached = `${url}/storage/v1/object/public/card-images/${id}.jpg`;
  try {
    const exists = await fetch(cached, {method:'HEAD'});
    if (exists.ok) return Response.redirect(cached,302);
    const check = await fetch(`${url}/rest/v1/cards?id=eq.${id}&select=id`,{headers});
    if (!check.ok) return new Response('Catalog unavailable', {status:503});
    if (!(await check.json()).length) return new Response('Card not in HAT catalog', {status:404});
    // Fixed host plus catalog-checked numeric ID prevents arbitrary URL proxying.
    const image = await fetch(`https://images.ygoprodeck.com/images/cards_small/${id}.jpg`, {signal:AbortSignal.timeout(10000)});
    if (!image.ok || !image.headers.get('content-type')?.startsWith('image/')) return new Response('Image unavailable',{status:502});
    const bytes = await image.arrayBuffer();
    if (bytes.byteLength > 1000000) return new Response('Image too large', {status:502});
    const saved = await fetch(`${url}/storage/v1/object/card-images/${id}.jpg`,{method:'POST',headers:{...headers,'Content-Type':'image/jpeg','Cache-Control':'31536000','x-upsert':'true'},body:bytes});
    if (!saved.ok) return new Response('Image cache unavailable', {status:503});
    return Response.redirect(cached,302);
  } catch { return new Response('Image unavailable', {status:503}); }
});
