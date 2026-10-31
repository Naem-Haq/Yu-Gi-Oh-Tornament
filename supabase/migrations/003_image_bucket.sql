-- Public artwork only. Deck lists never enter Storage.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('card-images','card-images',true,1000000,array['image/jpeg'])
on conflict(id) do nothing;
-- No browser write policies: only the server-side image cache can populate it.
grant select on public.cards to service_role;
