alter table public.study_sessions
  drop constraint if exists study_sessions_minutes_check;

alter table public.study_sessions
  add constraint study_sessions_minutes_check check (minutes between 1 and 600);

create or replace function public.record_study_session(p_minutes integer, p_subject text default 'Allgemein')
returns table (session_id uuid, xp_earned integer, total_xp integer, streak_days integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid := gen_random_uuid();
  earned integer;
  today date := (now() at time zone 'utc')::date;
  previous_date date;
begin
  if p_minutes not between 1 and 600 then raise exception 'Lernzeit muss zwischen 1 und 600 Minuten liegen'; end if;
  if length(trim(coalesce(p_subject, ''))) > 60 then raise exception 'Fach darf höchstens 60 Zeichen haben'; end if;
  insert into public.study_sessions (id, user_id, minutes, subject)
  values (new_id, auth.uid(), p_minutes, coalesce(nullif(trim(p_subject), ''), 'Allgemein'));
  earned := public.award_xp(auth.uid(), 'study', new_id::text, p_minutes || ' Minuten gelernt', p_minutes);

  select last_study_date into previous_date from public.profiles where id = auth.uid() for update;
  update public.profiles as profile
  set streak_days = case
      when profile.last_study_date = today then profile.streak_days
      when profile.last_study_date = today - 1 then profile.streak_days + 1
      else 1
    end,
    last_study_date = today
  where profile.id = auth.uid();
  return query select new_id, earned, p.total_xp, p.streak_days
  from public.profiles p where p.id = auth.uid();
end;
$$;
