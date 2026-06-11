-- 0057: logic option fixes - no second defensible answer (applied via MCP)
--
-- Favour caught #71: "Priya has no red pens" is ALSO entailed by "all of
-- Priya's pens are blue" on any everyday reading (the only escape is reading
-- "has" as holding-not-owning, which is too tricky to hang an answer on).
-- Audit of all 11 logic questions found one more of the same class, #29:
-- "Some Blips are Zorks" follows from "All Zorks are Blips" whenever Zorks
-- exist - colloquially presupposed - so it was a second defensible answer.
-- Both option sets rebuilt with tempting but CLEANLY wrong distractors;
-- correct answers unchanged. The use/own distinction that almost rescued the
-- old #71 option A is now an explicit, fair trap ("Priya never uses red
-- pens" - she could use someone else's).

update public.test_questions
set options = '["Priya never uses red pens", "The pen on the desk is not Priya''s", "Priya owns the desk", "Priya''s favourite colour is blue"]'::jsonb,
    explanation = 'All of Priya''s pens are blue and the pen on the desk is red, so it cannot be one of hers. The other statements go beyond the premises: she could still USE someone else''s red pen, nothing links her to the desk, and we know nothing about what she likes.'
where id = '08ed8742-15c6-427c-89aa-b54594ba0008' and correct_index = 1;

update public.test_questions
set options = '["Some Zorks are Quins", "No Zorks are Quins", "All Quins are Blips", "All Blips are Zorks"]'::jsonb,
    explanation = 'Every Zork is a Blip, and no Blip is a Quin - so no Zork can be a Quin. "All Blips are Zorks" reverses the first statement (the converse), which does not follow.'
where id = '8ab5ac53-8bde-46b2-ac77-9c02bf57dc56' and correct_index = 1;
