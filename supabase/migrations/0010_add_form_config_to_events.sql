-- Steps Intranet — Per-event custom form fields
-- Adds form_config JSONB column to events table.
-- The apply page renders these dynamically after fixed fields (details, contextual, GCSE, qualifications).
-- See events-api.ts FormFieldConfig type for full schema documentation.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS form_config jsonb DEFAULT '{"fields":[]}'::jsonb;

COMMENT ON COLUMN public.events.form_config IS
  'Per-event custom form field definitions. The apply page renders these dynamically after fixed fields. Schema: { fields: FormFieldConfig[] }.';
