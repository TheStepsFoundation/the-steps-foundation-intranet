-- ---------------------------------------------------------------------------
-- 0063_lock_grades.sql
--
-- Extend the set-once lock (0062) to achieved GCSE results and the
-- subjects/predicted-grades list. Per Favour: these shouldn't flip per
-- application either; the team opens them up once a year at academic-year
-- rollover (a service-role / admin batch, which the trigger already exempts)
-- so students can refresh on their next application. qualifications is jsonb
-- — `is distinct from` compares it correctly. Applied via MCP with this commit.
-- ---------------------------------------------------------------------------

create or replace function public.students_enforce_set_once()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(public.is_admin(), false) then
    return new;
  end if;
  if (old.school_id            is not null and new.school_id            is distinct from old.school_id)
  or (old.school_name_raw      is not null and new.school_name_raw      is distinct from old.school_name_raw)
  or (old.school_type          is not null and new.school_type          is distinct from old.school_type)
  or (old.bursary_90plus       is not null and new.bursary_90plus       is distinct from old.bursary_90plus)
  or (old.year_group           is not null and new.year_group           is distinct from old.year_group)
  or (old.free_school_meals    is not null and new.free_school_meals    is distinct from old.free_school_meals)
  or (old.parental_income_band is not null and new.parental_income_band is distinct from old.parental_income_band)
  or (old.first_generation_uni is not null and new.first_generation_uni is distinct from old.first_generation_uni)
  or (old.gcse_results         is not null and new.gcse_results         is distinct from old.gcse_results)
  or (old.qualifications       is not null and new.qualifications       is distinct from old.qualifications)
  then
    raise exception 'These details are locked once set — email hello@thestepsfoundation.com and we will update them for you.';
  end if;
  return new;
end;
$$;
