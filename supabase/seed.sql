-- =============================================================================
-- Steps Intranet — development seed data
-- Date: 2026-04-15
--
-- Fake, non-PII data for local / staging development only. NEVER run in prod.
--
-- Populates:
--   - ~6 mock schools
--   - The 4 real Steps events (#1 Starting Point, #2 Oxbridge, #3 Degree
--     Apprenticeship, #4 The Great Lock-In) — names and dates are real but
--     attendee data is synthetic.
--   - 200 fake students (deterministic names, fake emails at @example.invalid)
--   - ~500 applications distributed across the four events
--
-- Safe to re-run: uses deterministic IDs where possible and on-conflict-do-nothing.
-- Idempotency caveat: running twice will skip students (email unique) and
-- applications (student_id+event_id unique), which is the intended behaviour
-- for dev seeding.
--
-- A guard at the top refuses to run in an environment that already has > 50
-- students (assumed to be something closer to prod). Comment out if needed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Safety guard — refuse to run against a populated database
-- -----------------------------------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.students;
  if v_count > 50 then
    raise exception 'seed.sql aborted: % existing student rows found — refusing to seed into what looks like a populated database. Comment out this guard if you really mean it.', v_count;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Mock schools
-- -----------------------------------------------------------------------------
insert into public.schools (urn, name, type, postcode, local_authority) values
  (100001, 'Bexleyheath Academy',         'academy',     'DA7 4HQ', 'Bexley'),
  (100002, 'Greenwich Park Sixth Form',   'sixth_form',  'SE10 8QY', 'Greenwich'),
  (100003, 'Lewisham Community College',  'fe_college',  'SE13 7BB', 'Lewisham'),
  (100004, 'Southwark Grammar School',    'grammar',     'SE1 1AA',  'Southwark'),
  (100005, 'Tower Hamlets State School',  'state',       'E1 6AN',   'Tower Hamlets'),
  (100006, 'Westminster Independent',     'independent', 'SW1P 3PB', 'Westminster')
on conflict (urn) do nothing;

-- -----------------------------------------------------------------------------
-- 2. The 4 real Steps events (synthetic IDs/dates; real names & slugs)
-- -----------------------------------------------------------------------------
-- Dates source: CLAUDE.md notes Starting Point Sep 2025 and The Great Lock-In
-- 21 Mar 2026 on the nose. Oxbridge and Degree Apprenticeship are online with
-- no fixed date in CLAUDE.md; using placeholder dates within the period.
insert into public.events (name, slug, event_date, location, format, description, capacity) values
  ('#1 Starting Point',             'starting-point-2025',    '2025-09-20', 'LSE, London',            'in_person', 'The original Steps event. 140–175 Y12 students spent a day at LSE exploring university pathways.', 175),
  ('#2 Oxbridge Interview Workshop','oxbridge-2025',          '2025-11-15', 'Online (Zoom)',          'online',    'Online Oxbridge interview prep with near-peer mentors. 53 students, 33 mentors.',                    60),
  ('#3 Degree Apprenticeship',      'degree-apprenticeship-2026', '2026-01-25', 'Online (Zoom)',      'online',    'Degree apprenticeship masterclass exploring non-traditional routes into industry.',                 80),
  ('#4 The Great Lock-In',          'great-lock-in-2026',     '2026-03-21', 'Imperial College London','in_person', 'Full-day academic lock-in at Imperial for Y13 applicants approaching finals and interviews.',       200)
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- 3. 200 fake students
--
-- Names are drawn from a small deterministic pool so repeat runs are stable.
-- Emails are all at @example.invalid (reserved TLD — cannot resolve, cannot
-- leak). Year groups spread across Y11–Y13 with a few Y10s and uni_y1.
-- -----------------------------------------------------------------------------
do $$
declare
  first_names text[] := array[
    'Amara','Aiden','Bolu','Chloe','Daniyaal','Ethan','Favour','Grace','Hassan','Isla',
    'Jin','Kemi','Lara','Maxwell','Nahom','Olivia','Priya','Quincy','Rebecca','Saevuk',
    'Tomi','Uche','Vivaan','Wren','Xavier','Yusuf','Zara','Adaeze','Benji','Clara',
    'Deji','Esther','Finn','Gbemi','Hiroshi','Imani','Jomo','Kwame','Leila','Mohammed'
  ];
  last_names text[] := array[
    'Ahmed','Bennett','Chen','Davies','Evans','Fashola','Gupta','Hassan','Ibrahim','Johnson',
    'Khan','Lewis','Mensah','Nguyen','Okafor','Patel','Qureshi','Rahman','Singh','Thompson',
    'Uzoma','Vance','Williams','Xu','Yilmaz','Zhao','Adeyemi','Brown','Choudhury','Dlamini'
  ];
  postcodes text[] := array[
    'DA7 4HQ','SE10 8QY','SE13 7BB','SE1 1AA','E1 6AN','SW1P 3PB','N1 9GU','E14 5AB',
    'SE8 3EY','SE15 2TF','SE22 9AS','SE5 7EG','E17 7BJ','N15 5AA','NW1 2DB','SW9 7AA'
  ];
  year_groups int[] := array[10, 11, 12, 12, 12, 13, 13, 13];
  income_codes text[] := array['under_20k','20_40k','40_60k','60_100k','prefer_na','20_40k','under_20k'];
  i int;
  v_first text;
  v_last text;
  v_school uuid;
  v_yg int;
  v_seed int;
begin
  for i in 1..200 loop
    v_seed  := i * 37 + 13;  -- deterministic pseudorandom
    v_first := first_names[1 + (v_seed % array_length(first_names, 1))];
    v_last  := last_names[1 + ((v_seed / 7) % array_length(last_names, 1))];
    v_yg    := year_groups[1 + (v_seed % array_length(year_groups, 1))];

    select id into v_school
      from public.schools
     order by urn
     offset (v_seed % 6) limit 1;

    insert into public.students (
      first_name, last_name, personal_email, phone,
      date_of_birth, school_id, year_group,
      postcode,
      free_school_meals, parental_income_band, first_generation_uni, care_experienced,
      subscribed_to_mailing, notes
    ) values (
      v_first,
      v_last,
      format('student%s@example.invalid', lpad(i::text, 3, '0'))::citext,
      format('07%s', lpad((1000000 + v_seed)::text, 9, '0')),
      date '2008-01-01' + ((v_seed * 11) % 1825),   -- spread of DOBs across ~5y
      v_school,
      v_yg,
      postcodes[1 + (v_seed % array_length(postcodes, 1))],
      (v_seed % 5) = 0,                             -- ~20% FSM
      income_codes[1 + (v_seed % array_length(income_codes, 1))],
      (v_seed % 3) = 0,                             -- ~33% first-gen
      (v_seed % 47) = 0,                            -- ~2% care-experienced
      (v_seed % 11) <> 0,                           -- ~91% subscribed
      case when (v_seed % 13) = 0 then 'Met at Starting Point — strong candidate for mentoring.'
           else null end
    )
    on conflict (personal_email) do nothing;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. ~500 applications distributed across the 4 events
--
-- Distribution (roughly matches real attendance / form submission patterns):
--   #1 Starting Point    → 175 applications (largest event)
--   #2 Oxbridge          → 100
--   #3 Degree App        → 75
--   #4 Great Lock-In     → 150
--   total                  500
--
-- Each student gets applications to a rotating subset of events so we see
-- realistic multi-event engagement.
-- -----------------------------------------------------------------------------
do $$
declare
  v_event_ids uuid[];
  v_targets   int[] := array[175, 100, 75, 150];    -- per-event targets
  v_statuses  text[] := array[
    'submitted','submitted','submitted','shortlisted','shortlisted',
    'accepted','accepted','accepted','waitlist','rejected','withdrew'
  ];
  v_channels  text[] := array[
    'instagram','word_of_mouth','school_newsletter','man_group_alumni',
    'westminster_school','bexley_grammar','linkedin',null
  ];
  v_students  uuid[];
  v_ev_id     uuid;
  v_st_id     uuid;
  v_per_event int;
  e int;
  s int;
  v_seed int;
begin
  select array_agg(id order by event_date) into v_event_ids from public.events;
  select array_agg(id order by personal_email) into v_students from public.students;

  if array_length(v_event_ids, 1) is null or array_length(v_event_ids, 1) < 4 then
    raise exception 'seed.sql: expected 4 events, found %.', coalesce(array_length(v_event_ids, 1), 0);
  end if;
  if array_length(v_students, 1) is null or array_length(v_students, 1) < 100 then
    raise exception 'seed.sql: expected >=100 students, found %.', coalesce(array_length(v_students, 1), 0);
  end if;

  for e in 1..4 loop
    v_ev_id     := v_event_ids[e];
    v_per_event := v_targets[e];

    for s in 1..v_per_event loop
      v_seed  := (e * 1000) + s * 17;
      v_st_id := v_students[1 + (v_seed % array_length(v_students, 1))];

      insert into public.applications (
        student_id, event_id, submitted_at, channel, raw_response,
        status, consent_text_version
      ) values (
        v_st_id,
        v_ev_id,
        now() - ((v_seed % 365) || ' days')::interval,
        v_channels[1 + (v_seed % array_length(v_channels, 1))],
        jsonb_build_object(
          'why_apply',       'I want to explore university and career options.',
          'source_tracking', v_channels[1 + (v_seed % array_length(v_channels, 1))]
        ),
        v_statuses[1 + (v_seed % array_length(v_statuses, 1))],
        'v1.0'
      )
      on conflict (student_id, event_id) do nothing;
    end loop;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Participation — synthesize attendance for accepted applications at
-- events that have already happened (event_date <= today).
-- -----------------------------------------------------------------------------
insert into public.participation (application_id, attended, no_show, feedback_score, photos_consent)
select
  a.id,
  (abs(hashtext(a.id::text)) % 10) < 8,  -- ~80% attended
  (abs(hashtext(a.id::text)) % 10) >= 8, -- ~20% no-show
  1 + (abs(hashtext(a.id::text)) % 10),
  (abs(hashtext(a.id::text)) % 3) <> 0   -- ~66% consented to photos
from public.applications a
join public.events e on e.id = a.event_id
where a.status = 'accepted'
  and e.event_date <= current_date
on conflict (application_id) do nothing;

-- -----------------------------------------------------------------------------
-- 6. Consent records — one per application (snapshot at submission)
-- -----------------------------------------------------------------------------
insert into public.consent_records (student_id, application_id, consent_text, consent_text_version, given_at)
select
  a.student_id,
  a.id,
  'I consent to Steps Foundation processing my data for the purpose of delivering this event and for aggregate impact reporting. I understand I can unsubscribe at any time.',
  'v1.0',
  a.submitted_at
from public.applications a
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 7. Summary notice
-- -----------------------------------------------------------------------------
do $$
declare
  v_students int;
  v_events int;
  v_applications int;
  v_participation int;
begin
  select count(*) into v_students      from public.students;
  select count(*) into v_events        from public.events;
  select count(*) into v_applications  from public.applications;
  select count(*) into v_participation from public.participation;

  raise notice '--- seed.sql complete ---';
  raise notice 'students:       %', v_students;
  raise notice 'events:         %', v_events;
  raise notice 'applications:   %', v_applications;
  raise notice 'participation:  %', v_participation;
end $$;
                             