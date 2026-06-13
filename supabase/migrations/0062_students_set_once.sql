-- ---------------------------------------------------------------------------
-- 0062_students_set_once.sql
--
-- Set-once lock on sensitive student profile fields (Favour, 2026-06-13,
-- prompted by an applicant's email reporting peers faking FSM status on
-- other programmes' applications). Students may fill a blank field, but
-- once school / year group / school type / FSM / income band / first-gen
-- (and the derived bursary flag) hold a value, only the team can change
-- them — flip-flopping eligibility per event is exactly the abuse vector.
--
-- Enforced at the DB so it covers every path (hub profile editor, apply
-- form, raw API calls with a student token). Admins (is_admin()) and
-- service-role jobs are exempt. Names, GCSEs, qualifications and context
-- stay freely editable. Applied via MCP alongside this commit.
-- ---------------------------------------------------------------------------

create or replace function public.students_enforce_set_once()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service-role (no auth uid) and team members may change anything.
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
  then
    raise exception 'These details are locked once set — email hello@thestepsfoundation.com and we will update them for you.';
  end if;
  return new;
end;
$$;

drop trigger if exists students_set_once on public.students;
create trigger students_set_once
  before update on public.students
  for each row execute function public.students_enforce_set_once();
