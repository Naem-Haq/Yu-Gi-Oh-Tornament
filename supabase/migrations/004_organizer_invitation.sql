create table public.organizer_invitations(email text primary key);
alter table public.organizer_invitations enable row level security;
revoke all on public.organizer_invitations from public,anon,authenticated;
create function public.accept_organizer_invitation() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.email_confirmed_at is not null and exists(select 1 from public.organizer_invitations where email=lower(new.email)) then
 insert into public.organizers(user_id) values(new.id) on conflict do nothing;
 delete from public.organizer_invitations where email=lower(new.email);
 end if;
 return new;
end $$;
revoke all on function public.accept_organizer_invitation() from public,anon,authenticated;
create trigger accept_tournament_organizer after insert or update of email_confirmed_at,email on auth.users for each row execute function public.accept_organizer_invitation();
