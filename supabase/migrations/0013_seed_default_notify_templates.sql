-- Seed default email templates for Accept/Reject/Waitlist & Notify flows.
-- Modelled on the "Invite to apply" vibe: plain-text body with {{merge_tags}};
-- the signature is auto-appended by the sender UI, so it isn't in body_html.
-- event_id = NULL → globally available (picks up automatically for any event).

INSERT INTO public.email_templates (name, type, subject, body_html, event_id)
SELECT 'Default acceptance', 'acceptance',
  E'Great news — you''re in for {{event_name}}!',
  E'Hi {{first_name}},\n\nGreat news — you''ve been accepted to {{event_name}}!\n\nDate: {{event_date}}\nTime: {{event_time}}\nLocation: {{event_location}}\nDress code: {{dress_code}}\n\nPlease confirm your place here: {{rsvp_link}}\n\nWe''re looking forward to seeing you there.\n\nVirtus non origo,\nThe Steps Foundation Team',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates
  WHERE name = 'Default acceptance' AND type = 'acceptance' AND event_id IS NULL AND deleted_at IS NULL
);

INSERT INTO public.email_templates (name, type, subject, body_html, event_id)
SELECT 'Default rejection', 'rejection',
  E'An update on your {{event_name}} application',
  E'Hi {{first_name}},\n\nThank you for applying to {{event_name}}. After a careful review, we weren''t able to offer you a place this time.\n\nWe received far more strong applications than spaces available, and unfortunately many deserving students won''t hear the news they were hoping for. Please don''t take this as a reflection of your ability.\n\nWe''d love to stay in touch — keep an eye on {{portal_link}} for upcoming events and opportunities.\n\nThank you again, and wishing you every success.\n\nVirtus non origo,\nThe Steps Foundation Team',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates
  WHERE name = 'Default rejection' AND type = 'rejection' AND event_id IS NULL AND deleted_at IS NULL
);

INSERT INTO public.email_templates (name, type, subject, body_html, event_id)
SELECT 'Default waitlist', 'waitlist',
  E'You''re on the waitlist for {{event_name}}',
  E'Hi {{first_name}},\n\nThank you for applying to {{event_name}}. You''re currently on our waitlist.\n\nWe received more strong applications than we could accept, but spaces often open up closer to the date. If one does, we''ll be in touch straight away.\n\nMeanwhile, keep {{rsvp_link}} to hand — we may ask you to confirm availability at short notice.\n\nThank you for your patience, and we hope to see you at {{event_name}}.\n\nVirtus non origo,\nThe Steps Foundation Team',
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates
  WHERE name = 'Default waitlist' AND type = 'waitlist' AND event_id IS NULL AND deleted_at IS NULL
);
