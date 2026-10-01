-- Shared five-presenter schedule for the Wellness Class app.
-- Safe to run again: adds the student-visible teacher message and updates schedule saving.

create table if not exists public.presentation_schedules (
  schedule_date date primary key,
  rolls integer[] not null check (cardinality(rolls) = 5),
  created_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.presentation_schedules add column if not exists custom_message text not null default '';
alter table public.presentation_schedules enable row level security;
drop policy if exists presentation_schedules_public_read on public.presentation_schedules;
create policy presentation_schedules_public_read on public.presentation_schedules for select to anon, authenticated using (true);
revoke all on public.presentation_schedules from anon, authenticated;
grant select on public.presentation_schedules to anon, authenticated;

drop function if exists public.save_presentation_schedule(date, integer[]);
create or replace function public.save_presentation_schedule(p_schedule_date date, p_rolls integer[], p_custom_message text default '')
returns void language plpgsql security definer set search_path = public as $$
declare unique_rolls integer;
begin
  if not public.is_class_teacher() then raise exception 'Teacher permission required'; end if;
  if p_schedule_date is null or p_schedule_date < current_date then raise exception 'Choose today or a future presentation date'; end if;
  if p_rolls is null or cardinality(p_rolls) <> 5 then raise exception 'A presentation schedule must contain exactly five students'; end if;
  select count(distinct roll) into unique_rolls from unnest(p_rolls) as picked(roll);
  if unique_rolls <> 5 then raise exception 'Choose five different students'; end if;
  if exists (select 1 from unnest(p_rolls) as picked(roll) left join public.students s on s.roll=picked.roll where s.roll is null or s.completed) then raise exception 'All five students must exist and still need to present'; end if;
  if exists (select 1 from public.students s join public.students prerequisite on prerequisite.topic=s.topic and prerequisite.roll<s.roll and not prerequisite.completed where s.roll=any(p_rolls)) then raise exception 'Complete prerequisite presentations before scheduling follow-up topics'; end if;
  if length(coalesce(p_custom_message,'')) > 500 then raise exception 'Student message must be 500 characters or fewer'; end if;
  insert into public.presentation_schedules(schedule_date, rolls, custom_message, created_by, updated_at)
  values (p_schedule_date, p_rolls, coalesce(p_custom_message,''), auth.uid(), now())
  on conflict (schedule_date) do update set rolls=excluded.rolls, custom_message=excluded.custom_message, created_by=auth.uid(), updated_at=now();
end; $$;
revoke all on function public.save_presentation_schedule(date, integer[], text) from public, anon;
grant execute on function public.save_presentation_schedule(date, integer[], text) to authenticated;
