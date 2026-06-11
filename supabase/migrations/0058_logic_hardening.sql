-- 0058: logic bank hardened one notch per tier (applied via MCP, file matches live DB)
--
-- Per Favour: every logic question a touch harder, with research-backed
-- option design (UCAT syllogism / LSAT must-be-true conventions): the correct
-- answer is 100% forced; wrong options are possible-but-not-necessary, cleanly
-- contradicted, or converse/invalid-chaining traps - never a second defensible
-- answer. Easy: two premises + one mild trap. Medium: red-herring third
-- premise, extra entity in the ordering puzzle, three-box wrong-labels
-- classic. Hard: two-step conditional chain with a walking red herring,
-- two-conversion calendar puzzle, three-person knights-and-knaves.
-- Same ids/positions/difficulties; bank stays 90 live (30/30/30).

update public.test_questions set
  prompt = 'Every sprinter at the club is an athlete. No athlete at the club skips training. Which MUST be true?',
  options = '["Everyone at training is a sprinter", "Some athletes at the club are not sprinters", "Every sprinter at the club attends training", "Anyone who attends training is an athlete"]'::jsonb,
  correct_index = 2,
  explanation = 'Sprinters are athletes, and no athlete skips training - so every sprinter attends. The others reverse the statements or claim things that are merely possible.'
where id = '5c6af373-1768-4300-8ac3-616a7e923b0c';

update public.test_questions set
  prompt = 'All Zorks are Blips. No Blips are Quins. Every Quin is a Vex. Which MUST be true?',
  options = '["No Zork is a Quin", "No Zork is a Vex", "Every Vex is a Quin", "Some Blips are Vexes"]'::jsonb,
  correct_index = 0,
  explanation = 'Every Zork is a Blip and no Blip is a Quin, so no Zork is a Quin. The Vex statement is a red herring: a Zork could still be a Vex by some other route, and the rest do not follow.'
where id = '8ab5ac53-8bde-46b2-ac77-9c02bf57dc56';

update public.test_questions set
  prompt = 'No reptile at the zoo can swim. Every creature in the river tank can swim. Kiko is a reptile at the zoo. Which MUST be true?',
  options = '["Some reptile at the zoo lives in the river tank", "Kiko is not in the river tank", "Every animal that can swim lives in the river tank", "Kiko is the only reptile at the zoo"]'::jsonb,
  correct_index = 1,
  explanation = 'Kiko cannot swim, but everything in the river tank can - so Kiko cannot be in it. The first option is actually impossible, and the others are not supported.'
where id = 'e605c4f0-3ca8-4966-8fae-8babe04a5753';

update public.test_questions set
  prompt = 'Every member of the chess club wears a badge. Some badge-wearers are in the debate club. Sam wears no badge. Which MUST be true?',
  options = '["Sam is not in the debate club", "Everyone in the debate club wears a badge", "Sam dislikes chess", "Sam is not in the chess club"]'::jsonb,
  correct_index = 3,
  explanation = 'Chess club members all wear badges, and Sam wears none - so Sam is not in the chess club. The debate club is a red herring: nothing says its members need badges, so Sam could still be in it.'
where id = 'b68d3c79-4fcd-4063-8bf1-d14014724ecb';

update public.test_questions set
  prompt = 'All of Priya''s pens are blue. Priya''s sister owns one red pen. The pen on the desk is red. Which MUST be true?',
  options = '["The pen on the desk is Priya''s sister''s", "Priya never uses red pens", "The pen on the desk is not Priya''s", "Priya''s sister has no blue pens"]'::jsonb,
  correct_index = 2,
  explanation = 'All of Priya''s pens are blue and the desk pen is red, so it cannot be hers. The sister is a red herring - the desk pen could belong to anyone, and we know nothing about what Priya uses or what else her sister owns.'
where id = '08ed8742-15c6-427c-89aa-b54594ba0008';

update public.test_questions set
  prompt = 'Kai is older than Liv. Liv is older than Mo. Noor is younger than Mo. Pia is older than Liv. Who is the youngest?',
  options = '["Noor", "Mo", "Liv", "It cannot be determined"]'::jsonb,
  correct_index = 0,
  explanation = 'Noor is younger than Mo, who is younger than Liv, who is younger than Kai - so Noor is youngest. Pia is the red herring: we only know she is older than Liv, which cannot make anyone younger than Noor.'
where id = '4c59ff1f-8162-4b9e-8405-ba53aa8b7601';

update public.test_questions set
  prompt = 'Three boxes are labelled "Apples", "Pears" and "Mixed". One contains only apples, one only pears, and one a mix - but every label is wrong. Tom opens the box labelled "Mixed" and pulls out an apple. What is in the box labelled "Pears"?',
  options = '["Only apples", "Only pears", "It cannot be determined", "A mix of apples and pears"]'::jsonb,
  correct_index = 3,
  explanation = 'The box labelled "Mixed" is not mixed, so the apple means it holds only apples. The box labelled "Pears" cannot hold only pears, and only-apples is taken - so it must hold the mix (and the box labelled "Apples" holds only pears).'
where id = '3274844a-417a-4d2c-bb0f-43c55bc95cfb';

update public.test_questions set
  prompt = 'All Brights are Sparks. No Spark is a Drab. Some Sparks are Glows. Tia is a Bright. Which MUST be true?',
  options = '["Tia is a Glow", "Some Brights are Glows", "No Glow is a Drab", "Tia is not a Drab"]'::jsonb,
  correct_index = 3,
  explanation = 'Tia is a Bright, so she is a Spark, and no Spark is a Drab - so Tia is not a Drab. The Glows are a red herring: "some Sparks are Glows" does not connect Tia, the Brights, or the Drabs to Glows in any forced way.'
where id = 'e44d21e9-04ea-4770-b14d-972793c42b97';

update public.test_questions set
  prompt = 'Three days after the day before yesterday is Thursday. What day will it be two days after tomorrow?',
  options = '["Thursday", "Friday", "Saturday", "Sunday"]'::jsonb,
  correct_index = 2,
  explanation = 'The day before yesterday is today minus 2; three days after that is today plus 1, which is Thursday - so today is Wednesday. Two days after tomorrow is today plus 3: Saturday.'
where id = '790f609b-fa70-4e56-84ba-431500e6218c';

update public.test_questions set
  prompt = 'On an island, knights always tell the truth and knaves always lie. You meet Ash, Beck and Cole. Ash says: "We are all knaves." Beck says: "Exactly one of us is a knight." What are they?',
  options = '["Ash and Cole are knaves; Beck is a knight", "All three are knaves", "Beck and Cole are knights; Ash is a knave", "It cannot be determined"]'::jsonb,
  correct_index = 0,
  explanation = 'Ash cannot be a knight (a knight cannot truthfully call himself a knave), so Ash lies and they are NOT all knaves. If Beck were lying too, the number of knights could not be one - but then Cole being a knight would make it exactly one (contradiction), and Cole being a knave would make them all knaves (contradiction). So Beck tells the truth: exactly one knight - Beck himself - and Cole is a knave.'
where id = '12c54f30-b44e-40b9-be5a-437746a790e6';

update public.test_questions set
  prompt = 'Everyone who entered the hall has a pass. Everyone with a pass paid the entry fee. Zara paid the entry fee, and Yusuf entered the hall. Which MUST be true?',
  options = '["Zara has a pass", "Yusuf paid the entry fee", "Zara entered the hall", "Everyone who paid the entry fee entered the hall"]'::jsonb,
  correct_index = 1,
  explanation = 'Yusuf entered, so he has a pass, so he paid - the chain only runs in that direction. Zara is the red herring: paying does not give you a pass or put you in the hall, so nothing about her follows.'
where id = '91a154a4-de77-4af5-a51c-12378182e976';
