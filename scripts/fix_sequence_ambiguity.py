#!/usr/bin/env python3
# ---------------------------------------------------------------------------
# 0061: regenerate the two ambiguous sequence questions Sam's #105 review
# exposed (see _alt_hyps in generate_nvr_questions.py for the lesson).
#
# Audit method: the stored explanation contains the full sides sequence +
# gap ordinal, so ambiguity is checked against the EXPANDED hypothesis set
# without reverse-engineering SVGs. Flagged: bank #105 (3,4,5,4,3 hiding the
# pentagon apex -> 3/4 alternation also fits) and #122 (5,4,5,6,5 hiding the
# hexagon -> 5/4 alternation also fits). Both get fresh, guard-hardened
# replacements (same id/position/difficulty, updated in place).
# ---------------------------------------------------------------------------
import os, json

os.environ["NVR_DEFS_ONLY"] = "1"
g = {"__name__": "nvr_defs"}
try:
    exec(open("scripts/generate_nvr_questions.py", encoding="utf-8").read(), g)
except SystemExit:
    pass

NAME2SIDES = {"triangle": 3, "square": 4, "pentagon": 5, "hexagon": 6}
ORD = {"first": 0, "second": 1, "third": 2, "fourth": 3, "fifth": 4}

# Active sequence questions with a sides layer (from prod, 2026-06-13)
LIVE = [
    ("bfa1ca5f-8177-4818-8fe4-af57cfd64217", 105, 2, "triangle square pentagon square triangle", "third"),
    ("b6c9b109-3ea8-4eee-9381-006c55c28ada", 107, 2, "triangle square pentagon triangle square", "fourth"),
    ("0bd89467-dd97-4e20-bc3b-2911662d265a", 110, 2, "pentagon square triangle pentagon square", "fifth"),
    ("5a66eeb6-8f84-4b21-80f1-369750a7ec36", 114, 3, "square pentagon hexagon pentagon square", "fifth"),
    ("03f75f1e-4444-44fb-9ceb-ee748e0181f1", 122, 3, "pentagon square pentagon hexagon pentagon", "fourth"),
]

def ambiguous(seq, gap):
    visible = [(t, v) for t, v in enumerate(seq) if t != gap]
    hyps = g["_morph_hyps"]() + g["_tri_morph_hyps"]()  # union superset
    completions = {h(gap) for h in hyps if all(h(t) == v for t, v in visible)}
    return completions if len(completions) > 1 else None

flagged = []
for qid, pos, diff, names, gw in LIVE:
    seq = [NAME2SIDES[n] for n in names.split()]
    comps = ambiguous(seq, ORD[gw])
    print(f"#{pos} (d{diff}) {seq} gap={ORD[gw]}: {'AMBIGUOUS ' + str(sorted(comps)) if comps else 'clean'}")
    if comps:
        flagged.append((qid, pos, diff))

assert {p for _, p, _ in flagged} == {105, 122}, f"unexpected flag set: {flagged}"

g["rng"].seed(20260613)
sql_str = g["sql_str"]
updates = []
for qid, pos, diff in flagged:
    prompt, options, ci, expl = (g["gen_seq_med"]() if diff == 2 else g["gen_seq_dial"](3))
    updates.append(
        "update public.test_questions set\n"
        f"  prompt = {sql_str(prompt)},\n"
        f"  options = {sql_str(json.dumps(options, ensure_ascii=False))}::jsonb,\n"
        f"  correct_index = {ci},\n"
        f"  explanation = {sql_str(expl)}\n"
        f"where id = '{qid}';\n"
    )
    print(f"replacement for #{pos}: correct_index={ci}, expl: {expl[:140]}")

header = """-- ---------------------------------------------------------------------------
-- 0061_sequence_ambiguity_fix.sql
--
-- Favour reviewed Sam's practice run and caught a second defensible answer
-- on sequence #105: the corner-shape wave (triangle-square-PENTAGON-square-
-- triangle) hid its apex, so plain 3/4 alternation also fits the visible
-- frames and predicts triangle - which was offered as a distractor. Audit of
-- the live sequence family (rules parsed from stored explanations, tested
-- against an expanded hypothesis set incl. period-2 alternations) flagged
-- exactly two: #105 (medium) and #122 (hard, 5,4,5,6,5 hiding the hexagon).
-- Both replaced in place (same id/position/difficulty) with questions from
-- the hardened generator, whose uniqueness guard now includes alternation
-- hypotheses for the corner morph, battery and dot layers (_alt_hyps).
-- Existing answers on these ids are TEAM PRACTICE only (no student attempts
-- exist); their per-question audit rows will show the new content.
-- Applied via MCP alongside this commit (scripts/fix_sequence_ambiguity.py).
-- ---------------------------------------------------------------------------

"""
sql = header + "\n".join(updates)
with open("supabase/migrations/0061_sequence_ambiguity_fix.sql", "w", encoding="utf-8") as f:
    f.write(sql)
print(f"wrote 0061: {len(sql)//1024} KB")
