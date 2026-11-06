create or replace function public.apply_daily_xp_decay()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'UTC')::date;
  last_decay_date date;
  current_xp integer;
  xp_removed integer := 0;
begin
  select xp_decay_date, total_xp
  into last_decay_date, current_xp
  from public.profiles
  where id = auth.uid()
  for update;

  if not found then raise exception 'Profil nicht gefunden'; end if;

  if last_decay_date < today then
    xp_removed := least(current_xp, (today - last_decay_date) * 4);
    update public.profiles
    set total_xp = total_xp - xp_removed,
        xp_decay_date = today
    where id = auth.uid();
  end if;

  return xp_removed;
end;
$$;
