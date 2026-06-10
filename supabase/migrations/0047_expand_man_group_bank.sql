-- ---------------------------------------------------------------------------
-- 0047_expand_man_group_bank.sql
--
-- Round-2 changes after Sam's review:
--  * Candidates may use calculators, so the bank gains 30 questions
--    (10 easy / 10 medium / 10 hard) weighted towards logical deduction,
--    sequences and verbal reasoning that a calculator cannot help with,
--    plus a few bits of simple maths that are faster in your head than
--    typed into a calculator. Bank: 60 -> 90 live questions (a fast
--    candidate could clear 60 in 15 minutes).
--  * Instructions rewritten: calculators allowed, finish-early allowed,
--    difficulty ramps as you go.
-- Applied via Supabase MCP at the same time this file landed in git.
-- ---------------------------------------------------------------------------

with t as (
  select id from public.tests
  where event_id = 'b5e7f8a1-3c9d-4b2e-8f1a-6d7c8e9f0a1b'
)
insert into public.test_questions
  (test_id, position, difficulty, category, prompt, options, correct_index, explanation, is_practice)
select t.id, v.position, v.difficulty, v.category, v.prompt, v.options, v.correct_index, v.explanation, v.is_practice
from t, (values
  (61, 1, 'logic', 'In a queue, Dev is ahead of Mia, and Mia is ahead of Ben. Who is at the back of these three?', '["Dev", "Mia", "Ben", "Cannot be determined"]'::jsonb, 2, 'Order front-to-back: Dev, Mia, Ben.', false),
  (62, 1, 'verbal', 'Which is the odd one out?', '["Oak", "Pine", "Rose", "Willow"]'::jsonb, 2, 'A rose is a flower; the others are trees.', false),
  (63, 1, 'sequence', 'Which letter comes next: A, C, F, J, …?', '["M", "N", "O", "P"]'::jsonb, 2, 'The gaps grow by one letter each time: +2, +3, +4, then +5. J + 5 = O.', false),
  (64, 1, 'logic', 'No fish can fly. A trout is a fish. What follows?', '["A trout can fly", "A trout cannot fly", "Some fish can fly", "Nothing follows"]'::jsonb, 1, 'Trout sit inside fish, and no fish flies.', false),
  (65, 1, 'numerical', 'What is 25% of 84?', '["19", "20", "21", "23"]'::jsonb, 2, 'A quarter of 84 is 21 — faster in your head than typing it.', false),
  (66, 1, 'verbal', 'Glove is to Hand as Sock is to …?', '["Shoe", "Foot", "Leg", "Wool"]'::jsonb, 1, 'A glove covers a hand; a sock covers a foot.', false),
  (67, 1, 'sequence', 'What number comes next: 100, 93, 86, 79, …?', '["70", "71", "72", "73"]'::jsonb, 2, 'The sequence falls by 7 each time.', false),
  (68, 1, 'verbal', 'Which is the odd one out?', '["Run", "Jump", "Swim", "Tired"]'::jsonb, 3, 'Tired describes a state; the others are actions.', false),
  (69, 1, 'arithmetic', 'Double 35, then add 11. What do you get?', '["79", "80", "81", "83"]'::jsonb, 2, '70 + 11 = 81.', false),
  (70, 1, 'logic', 'Every member of the chess club wears a badge. Sam wears no badge. What follows?', '["Sam is in the chess club", "Sam is not in the chess club", "Sam lost his badge", "Nothing follows"]'::jsonb, 1, 'If membership guarantees a badge, no badge means no membership.', false),
  (71, 2, 'logic', 'All of Priya’s pens are blue. The pen on the desk is red. Which MUST be true?', '["Priya has no red pens", "The pen on the desk is not Priya’s", "Priya owns the desk", "All red pens belong to someone else"]'::jsonb, 1, 'If every pen of Priya’s is blue, a red pen cannot be hers. (She might still own red pencils etc. — only this follows.)', false),
  (72, 2, 'logic', 'Kai is older than Liv. Liv is older than Mo. Noor is younger than Mo. Who is the youngest?', '["Kai", "Liv", "Mo", "Noor"]'::jsonb, 3, 'Order: Kai > Liv > Mo > Noor.', false),
  (73, 2, 'sequence', 'What number comes next: 2, 6, 12, 20, 30, …?', '["40", "42", "44", "46"]'::jsonb, 1, 'The gaps grow by 2: +4, +6, +8, +10, then +12.', false),
  (74, 2, 'verbal', 'Always is to Never as Everyone is to …?', '["Someone", "Anyone", "No one", "Somebody"]'::jsonb, 2, 'The pairs are exact opposites.', false),
  (75, 2, 'logic', 'Today is two days before Saturday. What day is tomorrow?', '["Thursday", "Friday", "Saturday", "Wednesday"]'::jsonb, 1, 'Two days before Saturday is Thursday, so tomorrow is Friday.', false),
  (76, 2, 'logic', 'A box is labelled “Apples”. Every label in the room is wrong. The box contains either apples or pears. What is inside?', '["Apples", "Pears", "Both", "Cannot be determined"]'::jsonb, 1, 'The label is wrong, so it cannot be apples — pears is the only option left.', false),
  (77, 2, 'sequence', 'Which letter is exactly midway between J and P in the alphabet?', '["L", "M", "N", "K"]'::jsonb, 1, 'J K L M N O P — M is the middle.', false),
  (78, 2, 'arithmetic', 'What is 60 ÷ 0.5, plus 10?', '["40", "70", "120", "130"]'::jsonb, 3, 'Dividing by a half doubles: 120, plus 10 is 130.', false),
  (79, 2, 'logic', 'All Brights are Sparks. Some Sparks are Glows. Tia is a Bright. Which MUST be true?', '["Tia is a Glow", "Tia is a Spark", "Some Brights are Glows", "Tia is not a Glow"]'::jsonb, 1, 'Brights sit inside Sparks, so Tia is a Spark. Whether she is a Glow cannot be determined.', false),
  (80, 2, 'sequence', 'What number comes next: 1, 2, 4, 7, 11, 16, …?', '["20", "21", "22", "24"]'::jsonb, 2, 'The gaps grow by one: +1, +2, +3, +4, +5, then +6.', false),
  (81, 3, 'logic', 'Ana, Bea and Cleo each have one hobby: chess, dance or art. Bea does not dance. Ana does art. Who dances?', '["Ana", "Bea", "Cleo", "Cannot be determined"]'::jsonb, 2, 'Ana has art; Bea cannot dance so she has chess; Cleo is left with dance.', false),
  (82, 3, 'logic', 'The day after tomorrow is two days before Friday. What day is today?', '["Sunday", "Monday", "Tuesday", "Wednesday"]'::jsonb, 1, 'Two days before Friday is Wednesday; if that is the day after tomorrow, today is Monday.', false),
  (83, 3, 'sequence', 'What number comes next: 2, 5, 4, 7, 6, 9, …?', '["7", "8", "10", "11"]'::jsonb, 1, 'The pattern alternates +3, −1. After 9 comes 9 − 1 = 8.', false),
  (84, 3, 'logic', 'One of two islanders says: “We are both liars.” What can you conclude?', '["Both are liars", "Both tell the truth", "The speaker lies and the other tells the truth", "The speaker tells the truth and the other lies"]'::jsonb, 2, 'A truth-teller could never say it (it would make them a liar). So the speaker lies — meaning they are not BOTH liars, so the other tells the truth.', false),
  (85, 3, 'verbal', 'Ubiquitous is to Rare as Ephemeral is to …?', '["Brief", "Lasting", "Fragile", "Frequent"]'::jsonb, 1, 'Ubiquitous (everywhere) is the opposite of rare; ephemeral (short-lived) is the opposite of lasting.', false),
  (86, 3, 'logic', 'Jay, Kit and Lou sit in a row of three seats. Jay is not on the left. Kit is on the right. Where is Jay?', '["Left", "Middle", "Right", "Cannot be determined"]'::jsonb, 1, 'Kit takes the right seat; Jay cannot be left, so Jay is in the middle and Lou is on the left.', false),
  (87, 3, 'logic', 'Only students with a pass may enter the hall. Zara entered the hall. Which MUST be true?', '["Zara is a student with a pass", "Zara borrowed a pass", "Everyone in the hall is a student", "Zara entered without a pass"]'::jsonb, 0, 'Entry requires being a student with a pass; Zara entered, so she must satisfy the condition.', false),
  (88, 3, 'numerical', 'Which fraction is the largest?', '["3/7", "4/9", "2/5", "5/11"]'::jsonb, 3, '5/11 ≈ 0.455 beats 4/9 ≈ 0.444, 3/7 ≈ 0.429 and 2/5 = 0.4.', false),
  (89, 3, 'numerical', 'In a group of 40 students, 25 like maths, 22 like physics and 5 like neither. How many like both?', '["7", "10", "12", "17"]'::jsonb, 2, '35 like at least one subject; 25 + 22 − 35 = 12 like both.', false),
  (90, 3, 'sequence', 'What letter comes next: J, F, M, A, M, J, …?', '["A", "J", "S", "M"]'::jsonb, 1, 'They are the months’ initials — January to June — so July: J.', false)
) as v(position, difficulty, category, prompt, options, correct_index, explanation, is_practice);

update public.tests
set instructions = 'You have 15 minutes. There are far more questions than anyone is expected to finish, and they get gradually harder as you go - work quickly but carefully. Questions appear one at a time and you cannot go back. Your result reflects how many you answer correctly; there is no penalty for a wrong answer, and skipping is free. You may use rough paper, and calculators are allowed - though most questions are designed to be faster in your head. You can finish early once you have done as much as you can. Once you press Start the timer cannot be paused, and you only get one attempt.',
    updated_at = now()
where event_id = 'b5e7f8a1-3c9d-4b2e-8f1a-6d7c8e9f0a1b';
