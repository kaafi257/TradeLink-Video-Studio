-- Run ONCE in the Studio project's SQL editor after 0001, replacing the placeholder email with
-- the email of the owner login you created under Authentication > Users.
-- (The owner user existed before 0001, so no profile row was created automatically.)
insert into public.profiles (id, role, active)
select id, 'owner', true from auth.users where email = '<OWNER_EMAIL_HERE>'
on conflict (id) do update set role = 'owner', active = true;

-- Check (expect one row: role owner, active true):
select id, role, active from public.profiles;
