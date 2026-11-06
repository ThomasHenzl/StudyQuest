create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Abenteurer',
  avatar_url text,
  total_xp integer not null default 0 check (total_xp >= 0),
  streak_days integer not null default 0 check (streak_days >= 0),
  last_study_date date,
  created_at timestamptz not null default now()
);

create table public.homework (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  subject text not null check (length(trim(subject)) between 1 and 60),
  description text not null default '',
  difficulty text not null default 'Mittel' check (difficulty in ('Leicht', 'Mittel', 'Schwer')),
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.grades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  subject text not null check (length(trim(subject)) between 1 and 60),
  grade integer not null check (grade between 1 and 5),
  assessment_type text not null check (assessment_type in ('test', 'exam')),
  xp_earned integer not null,
  created_at timestamptz not null default now()
);

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  minutes integer not null check (minutes between 1 and 600),
  subject text not null default 'Allgemein',
  created_at timestamptz not null default now()
);

create table public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  description text not null,
  xp integer not null check (xp > 0),
  created_at timestamptz not null default now(),
  unique (user_id, source_type, source_id)
);

create table public.quest_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quest_key text not null,
  period_start date not null,
  xp_earned integer not null,
  created_at timestamptz not null default now(),
  unique (user_id, quest_key, period_start)
);

create table public.achievement_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_key text not null,
  xp_earned integer not null,
  unlocked_at timestamptz not null default now(),
  unique (user_id, achievement_key)
);

create index homework_user_due_idx on public.homework (user_id, due_date);
create index grades_user_created_idx on public.grades (user_id, created_at desc);
create index study_sessions_user_created_idx on public.study_sessions (user_id, created_at desc);
create index xp_events_user_created_idx on public.xp_events (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.homework enable row level security;
alter table public.grades enable row level security;
alter table public.study_sessions enable row level security;
alter table public.xp_events enable row level security;
alter table public.quest_claims enable row level security;
alter table public.achievement_unlocks enable row level security;

create policy "Profiles are private to their owner" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can update their own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "Users manage their own homework" on public.homework
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage their own grades" on public.grades
  for select using (auth.uid() = user_id);
create policy "Users view their own study sessions" on public.study_sessions
  for select using (auth.uid() = user_id);
create policy "Users view their own XP events" on public.xp_events
  for select using (auth.uid() = user_id);
create policy "Users view their own quest claims" on public.quest_claims
  for select using (auth.uid() = user_id);
create policy "Users view their own achievements" on public.achievement_unlocks
  for select using (auth.uid() = user_id);

revoke all on public.profiles, public.homework, public.grades, public.study_sessions,
  public.xp_events, public.quest_claims, public.achievement_unlocks from public, anon, authenticated;
grant select on public.profiles, public.homework, public.grades, public.study_sessions,
  public.xp_events, public.quest_claims, public.achievement_unlocks to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
grant insert (user_id, title, subject, description, difficulty, due_date) on public.homework to authenticated;
grant update (title, subject, description, difficulty, due_date) on public.homework to authenticated;
grant delete on public.homework to authenticated;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Abenteurer'));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create function public.award_xp(
  p_user_id uuid,
  p_source_type text,
  p_source_id text,
  p_description text,
  p_xp integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  insert into public.xp_events (user_id, source_type, source_id, description, xp)
  values (p_user_id, p_source_type, p_source_id, p_description, p_xp)
  on conflict (user_id, source_type, source_id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 1 then
    update public.profiles set total_xp = total_xp + p_xp where id = p_user_id;
    return p_xp;
  end if;
  return 0;
end;
$$;

revoke all on function public.award_xp(uuid, text, text, text, integer) from public, anon, authenticated;

create function public.complete_homework(p_homework_id uuid)
returns table (xp_earned integer, total_xp integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row public.homework%rowtype;
  earned integer := 0;
begin
  select * into task_row from public.homework
  where id = p_homework_id and user_id = auth.uid()
  for update;
  if not found then raise exception 'Hausaufgabe nicht gefunden'; end if;
  if task_row.completed_at is null then
    update public.homework set completed_at = now() where id = p_homework_id;
    earned := public.award_xp(auth.uid(), 'homework', p_homework_id::text, 'Hausaufgabe abgeschlossen', 50);
  end if;
  return query select earned, p.total_xp from public.profiles p where p.id = auth.uid();
end;
$$;

create function public.record_study_session(p_minutes integer, p_subject text default 'Allgemein')
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
  update public.profiles
  set streak_days = case
      when last_study_date = today then streak_days
      when last_study_date = today - 1 then streak_days + 1
      else 1
    end,
    last_study_date = today
  where id = auth.uid();
  return query select new_id, earned, p.total_xp, p.streak_days
  from public.profiles p where p.id = auth.uid();
end;
$$;

create function public.submit_grade(
  p_title text,
  p_subject text,
  p_grade integer,
  p_assessment_type text
)
returns table (grade_id uuid, xp_earned integer, total_xp integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid := gen_random_uuid();
  base_reward integer;
  earned integer;
begin
  if p_grade not between 1 and 5 then raise exception 'Note muss zwischen 1 und 5 liegen'; end if;
  if p_assessment_type not in ('test', 'exam') then raise exception 'Ungültige Prüfungsart'; end if;
  if length(trim(p_title)) not between 1 and 120 or length(trim(p_subject)) not between 1 and 60 then
    raise exception 'Titel oder Fach ist ungültig';
  end if;
  base_reward := case p_grade
    when 1 then case p_assessment_type when 'test' then 200 else 400 end
    when 2 then case p_assessment_type when 'test' then 150 else 300 end
    when 3 then case p_assessment_type when 'test' then 100 else 200 end
    when 4 then case p_assessment_type when 'test' then 50 else 100 end
    else 0
  end;
  insert into public.grades (id, user_id, title, subject, grade, assessment_type, xp_earned)
  values (new_id, auth.uid(), trim(p_title), trim(p_subject), p_grade, p_assessment_type, base_reward);
  if base_reward > 0 then
    earned := public.award_xp(auth.uid(), 'grade', new_id::text, 'Note ' || p_grade || ' eingetragen', base_reward);
  else
    earned := 0;
  end if;
  return query select new_id, earned, p.total_xp from public.profiles p where p.id = auth.uid();
end;
$$;

create function public.claim_quest(p_quest_key text, p_period_start date)
returns table (xp_earned integer, total_xp integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
  start_date date;
  period_start_at timestamptz;
  period_end_at timestamptz;
  required_count integer;
  actual_count numeric;
  reward integer;
  period_type text;
  inserted_count integer;
begin
  case p_quest_key
    when 'daily-homework' then period_type := 'daily'; required_count := 1; reward := 40;
    when 'daily-study' then period_type := 'daily'; required_count := 30; reward := 30;
    when 'weekly-homework' then period_type := 'weekly'; required_count := 5; reward := 120;
    when 'weekly-study' then period_type := 'weekly'; required_count := 120; reward := 100;
    when 'weekly-grades' then period_type := 'weekly'; required_count := 3; reward := 80;
    else raise exception 'Quest nicht gefunden';
  end case;
  start_date := case when period_type = 'daily' then today else date_trunc('week', today::timestamp)::date end;
  if p_period_start <> start_date then raise exception 'Quest-Zeitraum ist abgelaufen'; end if;
  period_start_at := start_date::timestamp at time zone 'UTC';
  period_end_at := (start_date + case when period_type = 'daily' then 1 else 7 end)::timestamp at time zone 'UTC';

  if p_quest_key like '%homework' then
    select count(*) into actual_count from public.homework
    where user_id = auth.uid() and completed_at >= period_start_at and completed_at < period_end_at;
  elsif p_quest_key like '%study' then
    select coalesce(sum(minutes), 0) into actual_count from public.study_sessions
    where user_id = auth.uid() and created_at >= period_start_at and created_at < period_end_at;
  else
    select count(*) into actual_count from public.grades
    where user_id = auth.uid() and created_at >= period_start_at and created_at < period_end_at;
  end if;
  if actual_count < required_count then raise exception 'Quest-Anforderung noch nicht erfüllt'; end if;

  insert into public.quest_claims (user_id, quest_key, period_start, xp_earned)
  values (auth.uid(), p_quest_key, start_date, reward)
  on conflict (user_id, quest_key, period_start) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 1 then
    perform public.award_xp(auth.uid(), 'quest', p_quest_key || ':' || start_date::text, 'Quest abgeschlossen', reward);
  else
    reward := 0;
  end if;
  return query select reward, p.total_xp from public.profiles p where p.id = auth.uid();
end;
$$;

create function public.unlock_achievement(p_achievement_key text)
returns table (xp_earned integer, total_xp integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reward integer;
  eligible boolean := false;
  inserted_count integer;
  today date := (now() at time zone 'UTC')::date;
begin
  case p_achievement_key
    when 'first-homework' then
      reward := 50;
      select exists(select 1 from public.homework where user_id = auth.uid() and completed_at is not null) into eligible;
    when 'study-five-hours' then
      reward := 100;
      select coalesce(sum(minutes), 0) >= 300 into eligible from public.study_sessions where user_id = auth.uid();
    when 'five-grades' then
      reward := 75;
      select count(*) >= 5 into eligible from public.grades where user_id = auth.uid();
    when 'week-streak' then
      reward := 150;
      select streak_days >= 7 and last_study_date >= today - 1
      into eligible from public.profiles where id = auth.uid();
    else raise exception 'Achievement nicht gefunden';
  end case;
  if not eligible then raise exception 'Achievement noch nicht freigeschaltet'; end if;
  insert into public.achievement_unlocks (user_id, achievement_key, xp_earned)
  values (auth.uid(), p_achievement_key, reward)
  on conflict (user_id, achievement_key) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 1 then
    perform public.award_xp(auth.uid(), 'achievement', p_achievement_key, 'Achievement freigeschaltet', reward);
  else
    reward := 0;
  end if;
  return query select reward, p.total_xp from public.profiles p where p.id = auth.uid();
end;
$$;

revoke all on function public.complete_homework(uuid) from public, anon;
revoke all on function public.record_study_session(integer, text) from public, anon;
revoke all on function public.submit_grade(text, text, integer, text) from public, anon;
revoke all on function public.claim_quest(text, date) from public, anon;
revoke all on function public.unlock_achievement(text) from public, anon;
grant execute on function public.complete_homework(uuid) to authenticated;
grant execute on function public.record_study_session(integer, text) to authenticated;
grant execute on function public.submit_grade(text, text, integer, text) to authenticated;
grant execute on function public.claim_quest(text, date) to authenticated;
grant execute on function public.unlock_achievement(text) to authenticated;
