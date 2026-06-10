-- ---------------------------------------------------------------------------
-- 0046_seed_man_group_test.sql
--
-- Creates the Man Group selection test (DRAFT - nothing is visible to
-- students until an admin opens it) and seeds the question bank:
-- 60 live questions (20 easy / 20 medium / 20 hard across arithmetic,
-- numerical reasoning, sequences, logic and verbal reasoning) plus 6
-- practice questions shown on the intro screen. Every arithmetic answer
-- was computed programmatically when this file was generated.
-- Applied via Supabase MCP at the same time this file landed in git.
-- ---------------------------------------------------------------------------

with t as (
  insert into public.tests (event_id, title, status, duration_seconds, instructions)
  values (
    'b5e7f8a1-3c9d-4b2e-8f1a-6d7c8e9f0a1b',
    'Man Group Selection Test',
    'draft',
    900,
    'You have 15 minutes to answer as many questions as you can. There are far more questions than anyone is expected to finish - work quickly but carefully. Questions appear one at a time and you cannot go back. Your score is the number of correct answers; there is no penalty for a wrong answer. No calculators - have rough paper and a pen ready. Once you press Start the timer cannot be paused, and you only get one attempt.'
  )
  returning id
)
insert into public.test_questions
  (test_id, position, difficulty, category, prompt, options, correct_index, explanation, is_practice)
select t.id, v.position, v.difficulty, v.category, v.prompt, v.options, v.correct_index, v.explanation, v.is_practice
from t, (values
  (1, 1, 'arithmetic', 'What is 17 × 6?', '["96", "102", "106", "112"]'::jsonb, 1, '17×6 = 102.', false),
  (2, 1, 'arithmetic', 'What is 248 ÷ 8?', '["29", "30", "31", "32"]'::jsonb, 2, '248÷8 = 31.', false),
  (3, 1, 'numerical', 'What is 35% of 200?', '["60", "65", "70", "75"]'::jsonb, 2, '35% of 200 = 70.', false),
  (4, 1, 'arithmetic', 'What is 13 + 48 + 39?', '["98", "100", "102", "104"]'::jsonb, 1, '13+48+39 = 100.', false),
  (5, 1, 'arithmetic', 'What is 9 × 14?', '["122", "124", "126", "128"]'::jsonb, 2, '9×14 = 126.', false),
  (6, 1, 'numerical', 'What is three quarters of 96?', '["68", "70", "72", "74"]'::jsonb, 2, '96 ÷ 4 = 24; 24 × 3 = 72.', false),
  (7, 1, 'arithmetic', 'What is 250 − 87?', '["157", "160", "163", "167"]'::jsonb, 2, '250−87 = 163.', false),
  (8, 1, 'sequence', 'What number comes next: 4, 9, 14, 19, …?', '["22", "23", "24", "25"]'::jsonb, 2, 'The sequence increases by 5 each time.', false),
  (9, 1, 'sequence', 'What number comes next: 2, 4, 8, 16, …?', '["24", "30", "32", "36"]'::jsonb, 2, 'Each term doubles.', false),
  (10, 1, 'arithmetic', 'What is 0.5 × 0.4?', '["0.02", "0.09", "0.2", "0.9"]'::jsonb, 2, '0.5×0.4 = 0.20.', false),
  (11, 1, 'arithmetic', 'What is £2.40 + £3.85?', '["£5.95", "£6.05", "£6.25", "£6.35"]'::jsonb, 2, '2.40+3.85 = 6.25.', false),
  (12, 1, 'numerical', 'What is 20% of £45?', '["£8", "£9", "£10", "£11"]'::jsonb, 1, '10% is £4.50, so 20% is £9.', false),
  (13, 1, 'logic', 'Every sprinter is an athlete. Which statement MUST be true?', '["All athletes are sprinters", "Some athletes are not sprinters", "Anyone who is not an athlete is not a sprinter", "Most athletes are sprinters"]'::jsonb, 2, 'The contrapositive of "every sprinter is an athlete" must be true. The others go beyond the given statement.', false),
  (14, 1, 'verbal', 'Which is the odd one out?', '["Apple", "Banana", "Carrot", "Mango"]'::jsonb, 2, 'A carrot is a vegetable; the others are fruits.', false),
  (15, 1, 'numerical', 'A train departs at 09:45 and arrives at 11:20. How long is the journey?', '["1 hour 25 minutes", "1 hour 30 minutes", "1 hour 35 minutes", "1 hour 45 minutes"]'::jsonb, 2, '09:45 to 11:20 is 1 hour 35 minutes.', false),
  (16, 1, 'sequence', 'What number comes next: 81, 27, 9, 3, …?', '["0", "1", "2", "1.5"]'::jsonb, 1, 'Each term is divided by 3.', false),
  (17, 1, 'arithmetic', 'What is 7² + 24?', '["71", "73", "75", "77"]'::jsonb, 1, '49 + 24 = 73.', false),
  (18, 1, 'numerical', '5 identical pens cost £3.50 in total. How much is one pen?', '["60p", "65p", "70p", "75p"]'::jsonb, 2, '350p ÷ 5 = 70p.', false),
  (19, 1, 'verbal', 'Book is to Reading as Fork is to …?', '["Drawing", "Eating", "Cooking", "Cutlery"]'::jsonb, 1, 'A book is the tool used for reading; a fork is the tool used for eating.', false),
  (20, 1, 'arithmetic', 'What is 144 ÷ 12 + 6?', '["16", "18", "20", "24"]'::jsonb, 1, '12 + 6 = 18.', false),
  (21, 2, 'arithmetic', 'What is 23 × 17?', '["381", "391", "397", "401"]'::jsonb, 1, '23×17 = 391.', false),
  (22, 2, 'numerical', 'What is 15% of 360, plus 12?', '["64", "66", "68", "70"]'::jsonb, 1, '54 + 12 = 66.', false),
  (23, 2, 'numerical', '£96 is shared in the ratio 3:5. What is the larger share?', '["£56", "£58", "£60", "£64"]'::jsonb, 2, '96÷8 = 12; 5×12 = £60.', false),
  (24, 2, 'sequence', 'What number comes next: 3, 4, 7, 11, 18, 29, …?', '["43", "45", "47", "49"]'::jsonb, 2, 'Each term is the sum of the previous two: 18+29 = 47.', false),
  (25, 2, 'sequence', 'What number comes next: 5, 6, 8, 11, 15, 20, …?', '["24", "25", "26", "27"]'::jsonb, 2, 'The gaps increase by one each time: +1, +2, +3, +4, +5, then +6.', false),
  (26, 2, 'numerical', 'A shirt costs £24 after a 25% discount. What was the original price?', '["£30", "£31", "£32", "£36"]'::jsonb, 2, '£24 is 75% of the original: 24 ÷ 0.75 = £32.', false),
  (27, 2, 'numerical', 'A car travels 84 miles in 1 hour 45 minutes. What is its average speed?', '["44 mph", "46 mph", "48 mph", "52 mph"]'::jsonb, 2, '84 ÷ 1.75 = 48 mph.', false),
  (28, 2, 'numerical', '3 workers take 12 days to finish a job. How long would 4 workers take at the same rate?', '["8 days", "9 days", "10 days", "16 days"]'::jsonb, 1, '36 worker-days ÷ 4 workers = 9 days.', false),
  (29, 2, 'logic', 'All Zorks are Blips. No Blips are Quins. Which statement MUST be true?', '["Some Zorks are Quins", "No Zorks are Quins", "All Quins are Blips", "Some Blips are Zorks"]'::jsonb, 1, 'Zorks sit inside Blips, and Blips and Quins do not overlap, so no Zork can be a Quin.', false),
  (30, 2, 'numerical', 'What is the average (mean) of 14, 9, 17, 4 and 11?', '["10", "11", "12", "13"]'::jsonb, 1, 'The total is 55; 55 ÷ 5 = 11.', false),
  (31, 2, 'numerical', 'What is 2/3 + 1/4?', '["3/7", "5/6", "11/12", "7/12"]'::jsonb, 2, '8/12 + 3/12 = 11/12.', false),
  (32, 2, 'numerical', 'I double a number and add 7, giving 41. What was the number?', '["15", "16", "17", "18"]'::jsonb, 2, '41−7 = 34; 34÷2 = 17.', false),
  (33, 2, 'sequence', 'Which letter comes next: B, E, H, K, …?', '["M", "N", "O", "P"]'::jsonb, 1, 'The letters advance 3 places each time; K + 3 = N.', false),
  (34, 2, 'numerical', 'Which of these is NOT a square number?', '["121", "169", "190", "196"]'::jsonb, 2, '11²=121, 13²=169, 14²=196; 190 is not a perfect square.', false),
  (35, 2, 'logic', 'In a class of 30, 18 play football, 14 play tennis and 6 play both. How many play neither?', '["2", "4", "6", "8"]'::jsonb, 1, '18 + 14 − 6 = 26 play at least one, so 30 − 26 = 4 play neither.', false),
  (36, 2, 'arithmetic', 'What is 0.35 × 4200?', '["1370", "1450", "1470", "1520"]'::jsonb, 2, '0.35 × 4200 = 1470.', false),
  (37, 2, 'logic', 'Maya is taller than Sam. Sam is taller than Lee. Jo is shorter than Lee. Who is second tallest?', '["Maya", "Sam", "Lee", "Jo"]'::jsonb, 1, 'Order: Maya > Sam > Lee > Jo.', false),
  (38, 2, 'numerical', '£600 is split in the ratio 1:2:3. What is the largest share?', '["£200", "£240", "£300", "£360"]'::jsonb, 2, '600÷6 = 100; largest share is 3×100 = £300.', false),
  (39, 2, 'sequence', 'What number comes next: 1, 1, 2, 6, 24, …?', '["96", "100", "120", "144"]'::jsonb, 2, 'Multiply by 1, then 2, then 3, then 4; next is ×5 = 120.', false),
  (40, 2, 'verbal', 'Scarce is to Abundant as Transparent is to …?', '["Clear", "Opaque", "Fragile", "Visible"]'::jsonb, 1, 'The pairs are opposites.', false),
  (41, 3, 'numerical', 'What is 17.5% of 480?', '["78", "82", "84", "88"]'::jsonb, 2, '10% = 48, 5% = 24, 2.5% = 12; total 84.', false),
  (42, 3, 'numerical', 'Two trains start 150 miles apart and travel towards each other at 60 mph and 90 mph. How long until they meet?', '["50 minutes", "60 minutes", "75 minutes", "90 minutes"]'::jsonb, 1, 'Closing speed 150 mph; 150 miles ÷ 150 mph = 1 hour.', false),
  (43, 3, 'sequence', 'What number comes next: 2, 3, 5, 9, 17, 33, …?', '["57", "63", "65", "67"]'::jsonb, 2, 'Each term is double the previous minus 1: 33×2−1 = 65.', false),
  (44, 3, 'numerical', '£200 is invested at 10% compound interest per year. How much is it worth after 2 years?', '["£220", "£240", "£242", "£244"]'::jsonb, 2, '200 × 1.1 × 1.1 = £242.', false),
  (45, 3, 'numerical', 'If x:y = 4:7 and y:z = 2:3, what is x:z?', '["4:3", "8:21", "2:3", "12:14"]'::jsonb, 1, 'Scale to y=14: x:y:z = 8:14:21, so x:z = 8:21.', false),
  (46, 3, 'logic', 'Ann, Ben and Cal each drink exactly one of tea, coffee and juice. Ann does not drink tea. Ben drinks neither tea nor juice. Who drinks tea?', '["Ann", "Ben", "Cal", "Cannot be determined"]'::jsonb, 2, 'Ben must drink coffee; Ann cannot drink tea so she has juice; Cal is left with tea.', false),
  (47, 3, 'sequence', 'What number comes next: 4, 6, 10, 18, 34, …?', '["62", "64", "66", "68"]'::jsonb, 2, 'The gaps double: +2, +4, +8, +16, +32. 34+32 = 66.', false),
  (48, 3, 'numerical', 'Pipe A fills a tank in 6 hours; pipe B fills it in 3 hours. How long do both together take?', '["1.5 hours", "2 hours", "2.5 hours", "4.5 hours"]'::jsonb, 1, 'Rates: 1/6 + 1/3 = 1/2 of the tank per hour, so 2 hours.', false),
  (49, 3, 'arithmetic', 'What is 3⁴ × 3² ÷ 3³?', '["9", "27", "81", "243"]'::jsonb, 1, 'Add and subtract the indices: 3^(4+2−3) = 3³ = 27.', false),
  (50, 3, 'numerical', 'A bag holds 3 red and 5 blue balls. Two are drawn without replacement. What is the probability both are red?', '["3/28", "9/64", "3/32", "15/56"]'::jsonb, 0, '(3/8) × (2/7) = 6/56 = 3/28.', false),
  (51, 3, 'arithmetic', 'What is 13² − 12²?', '["23", "24", "25", "27"]'::jsonb, 2, '(13−12)(13+12) = 25.', false),
  (52, 3, 'sequence', 'What number comes next: 6, 11, 21, 41, 81, …?', '["121", "141", "161", "181"]'::jsonb, 2, 'Each term is double the previous minus 1: 81×2−1 = 161.', false),
  (53, 3, 'logic', 'If it rains, the match is cancelled. The match was not cancelled. What follows?', '["It rained", "It did not rain", "The match was close", "Nothing can be concluded"]'::jsonb, 1, 'If rain guarantees cancellation and there was no cancellation, there was no rain (modus tollens).', false),
  (54, 3, 'numerical', 'I think of a number, multiply it by 3, subtract 8, then halve the result, giving 14. What was my number?', '["10", "11", "12", "14"]'::jsonb, 2, 'Work backwards: 14×2 = 28; 28+8 = 36; 36÷3 = 12.', false),
  (55, 3, 'numerical', 'A price rises by 20%, then falls by 20%. The overall change is…?', '["No change", "4% decrease", "4% increase", "2% decrease"]'::jsonb, 1, '1.2 × 0.8 = 0.96, a 4% fall overall.', false),
  (56, 3, 'arithmetic', 'What is 1 ÷ 0.04?', '["0.25", "2.5", "25", "250"]'::jsonb, 2, '1 ÷ 0.04 = 100/4 = 25.', false),
  (57, 3, 'numerical', 'What is the angle between the hands of a clock at 3:30?', '["60°", "75°", "90°", "105°"]'::jsonb, 1, 'Hour hand: 105° (3.5 × 30°); minute hand: 180°; difference 75°.', false),
  (58, 3, 'verbal', 'Mitigate is to Aggravate as Concur is to …?', '["Agree", "Dissent", "Consider", "Convene"]'::jsonb, 1, 'The pairs are opposites: to concur is to agree, to dissent is to disagree.', false),
  (59, 3, 'numerical', 'What is the median of 7, 3, 9, 12, 5, 8?', '["7", "7.5", "8", "8.5"]'::jsonb, 1, 'Ordered: 3,5,7,8,9,12. The middle two are 7 and 8; median 7.5.', false),
  (60, 3, 'numerical', 'What is the sum of all whole numbers from 1 to 40?', '["780", "800", "820", "840"]'::jsonb, 2, '40 × 41 ÷ 2 = 820.', false),
  (101, 1, 'arithmetic', 'What is 12 × 15?', '["170", "175", "180", "185"]'::jsonb, 2, '12×15 = 180. In the real test, pick the answer and you move straight to the next question.', true),
  (102, 1, 'numerical', 'What is 10% of 250?', '["20", "25", "30", "35"]'::jsonb, 1, 'Move the decimal point one place: 10% of 250 is 25.', true),
  (103, 1, 'sequence', 'What number comes next: 3, 6, 9, 12, …?', '["13", "14", "15", "18"]'::jsonb, 2, 'The sequence increases by 3 each time.', true),
  (104, 1, 'logic', 'All cats are animals. Felix is a cat. What follows?', '["Felix is an animal", "All animals are cats", "Felix is not an animal", "Nothing follows"]'::jsonb, 0, 'Felix belongs to the group "cats", and every cat is an animal.', true),
  (105, 1, 'verbal', 'Hot is to Cold as Up is to …?', '["Above", "Down", "High", "Over"]'::jsonb, 1, 'The pairs are opposites.', true),
  (106, 1, 'arithmetic', 'What is 100 − 37?', '["63", "64", "67", "73"]'::jsonb, 0, '100−37 = 63.', true)
) as v(position, difficulty, category, prompt, options, correct_index, explanation, is_practice);
