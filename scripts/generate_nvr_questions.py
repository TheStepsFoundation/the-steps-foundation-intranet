#!/usr/bin/env python3
"""Generate the nonverbal-reasoning question bank for migration 0049.

Three families, mirroring standard online-test formats:
  A. Sequence completion  - a dial figure evolves by rotation/toggle rules
  B. Set A / Set B        - infer the rule uniting each set, place the test panel
  C. Analogy A:B :: C:?   - apply the A->B transformation to C

Every question's correct answer is COMPUTED from the generating rule (never
hand-judged), keeping the bank programmatically verifiable like rounds 1-2.
Deterministic via fixed seed. Output: supabase/migrations/0049_nonverbal_revamp.sql
"""
import json, random, xml.etree.ElementTree as ET

rng = random.Random(20260610)
EVENT_ID = "b5e7f8a1-3c9d-4b2e-8f1a-6d7c8e9f0a1b"
BLACK, WHITE, GRAY = "#111111", "#ffffff", "#bbbbbb"

# ---------- shared drawing ----------------------------------------------------

def frame_rect():
    return f'<rect x="3" y="3" width="104" height="104" fill="{WHITE}" stroke="{BLACK}" stroke-width="2"/>'

def wrap(inner, vw, vh, w=None):
    w = w or vw
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw} {vh}" '
            f'width="{w}" height="{vh * w // vw}" role="img">{inner}</svg>')

# ---------- Family A: dial sequence -------------------------------------------
# Satellites N,E,S,W around a centre square; black marker, gray marker, centre
# fill and a corner tick each move (or not) by simple modular rules.

SAT = [(55, 16), (94, 55), (55, 94), (16, 55)]            # N E S W
CORN = [((74, 36), (102, 8)), ((74, 74), (102, 102)),     # TR BR
        ((36, 74), (8, 102)), ((36, 36), (8, 8))]         # BL TL

def dial_frame(black_pos, gray_pos, center_black, corner):
    parts = [frame_rect()]
    for x, y in SAT:
        parts.append(f'<line x1="55" y1="55" x2="{x}" y2="{y}" stroke="{BLACK}" stroke-width="2"/>')
    cfill = BLACK if center_black else WHITE
    parts.append(f'<rect x="43" y="43" width="24" height="24" fill="{cfill}" stroke="{BLACK}" stroke-width="2"/>')
    for i, (x, y) in enumerate(SAT):
        fill = BLACK if i == black_pos else (GRAY if i == gray_pos else WHITE)
        parts.append(f'<circle cx="{x}" cy="{y}" r="11" fill="{fill}" stroke="{BLACK}" stroke-width="2"/>')
    (x1, y1), (x2, y2) = CORN[corner]
    parts.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{BLACK}" stroke-width="2"/>')
    return "".join(parts)

def dial_state(t, p):
    black = (p["b0"] + p["db"] * t) % 4
    gray = (p["g0"] + p["dg"] * t) % 4
    if gray == black:
        gray = (gray + 1) % 4
    centre = (p["c0"] + (p["dc"] * t)) % 2 == 1
    corner = (p["k0"] + p["dk"] * t) % 4
    return black, gray, centre, corner

def gen_dial(difficulty):
    while True:
        p = {"b0": rng.randrange(4), "g0": rng.randrange(4), "c0": rng.randrange(2),
             "k0": rng.randrange(4), "db": rng.choice([1, -1]), "dg": 0, "dc": 0, "dk": 0}
        if difficulty >= 2:
            p["dg"] = -p["db"]
        if difficulty == 3:
            p["dc"] = 1
            p["dk"] = rng.choice([1, -1])
        states = [dial_state(t, p) for t in range(5)]
        if len({s for s in states}) < 5:
            continue
        seq = "".join(f'<g transform="translate({i * 118},0)">{dial_frame(*states[i])}</g>' for i in range(4))
        prompt = "Which figure comes next in the sequence?\n" + wrap(seq, 470, 110, 470)
        correct = states[4]
        # distractors: wrong black direction / gray frozen / centre-corner wrong
        b, g, c, k = correct
        cands = [((b - 2 * p["db"]) % 4, g, c, k),
                 (b, (g + 1) % 4 if (g + 1) % 4 != b else (g + 2) % 4, c, k),
                 (b, g, (not c) if difficulty == 3 else c, (k + 2) % 4)]
        opts_states, seen = [correct], {correct}
        for st in cands:
            if st not in seen:
                opts_states.append(st); seen.add(st)
            if len(opts_states) == 4:
                break
        while len(opts_states) < 4:
            st = (rng.randrange(4), rng.randrange(4), rng.random() < .5, rng.randrange(4))
            if st[0] != st[1] and st not in seen:
                opts_states.append(st); seen.add(st)
        rng.shuffle(opts_states)
        options = [wrap(dial_frame(*st), 110, 110, 104) for st in opts_states]
        ci = opts_states.index(correct)
        moves = ["the black disc moves one step " + ("clockwise" if p["db"] == 1 else "anticlockwise")]
        if p["dg"]: moves.append("the grey disc moves one step the opposite way")
        if p["dc"]: moves.append("the centre square alternates black/white")
        if p["dk"]: moves.append("the corner tick advances one corner " + ("clockwise" if p["dk"] == 1 else "anticlockwise"))
        return prompt, options, ci, "Each step: " + "; ".join(moves) + "."

# ---------- Family B: Set A / Set B -------------------------------------------

QUAD = [(28, 28), (72, 28), (28, 72), (72, 72)]

def shape_svg(kind, x, y, s, fill):
    if kind == "circle":
        return f'<circle cx="{x}" cy="{y}" r="{s}" fill="{fill}" stroke="{BLACK}" stroke-width="2"/>'
    if kind == "square":
        return f'<rect x="{x - s}" y="{y - s}" width="{2 * s}" height="{2 * s}" fill="{fill}" stroke="{BLACK}" stroke-width="2"/>'
    return (f'<polygon points="{x},{y - s} {x + s},{y + s} {x - s},{y + s}" '
            f'fill="{fill}" stroke="{BLACK}" stroke-width="2"/>')

def panel(shapes):  # shapes: list of (kind, black?)
    parts = [f'<rect x="2" y="2" width="96" height="96" fill="{WHITE}" stroke="{BLACK}" stroke-width="2"/>']
    pts = QUAD[:len(shapes)]
    for (kind, blk), (x, y) in zip(shapes, pts):
        parts.append(shape_svg(kind, x, y, 15, BLACK if blk else WHITE))
    return "".join(parts)

RULES = [  # (name, predicate, explanation-A, explanation-B uses negation pair)
    ("has_black_circle", lambda sh: any(k == "circle" and b for k, b in sh), "every panel contains a black circle", "no panel contains a black circle"),
    ("count3", lambda sh: len(sh) == 3, "every panel has exactly 3 shapes", "every panel has exactly 4 shapes"),
    ("has_triangle", lambda sh: any(k == "triangle" for k, b in sh), "every panel contains a triangle", "no panel contains a triangle"),
    ("blacks_odd", lambda sh: sum(1 for k, b in sh if b) % 2 == 1, "every panel has an odd number of black shapes", "every panel has an even number of black shapes"),
    ("black_majority", lambda sh: sum(1 for k, b in sh if b) > len(sh) / 2, "black shapes outnumber white in every panel", "white shapes outnumber black in every panel"),
]

def rand_panel(n=None):
    n = n or rng.choice([2, 3, 4])
    return [(rng.choice(["circle", "square", "triangle"]), rng.random() < .5) for _ in range(n)]

def gen_sets(difficulty):
    idx = {1: [0, 1, 2], 2: [3], 3: [4]}[difficulty]
    name, pred, expA, expB = RULES[rng.choice(idx)]
    def sample(want, forbid_other=None):
        for _ in range(4000):
            sh = rand_panel(3 if name == "count3" and want else (4 if name == "count3" else None))
            if name == "count3":
                sh = rand_panel(3) if want else rand_panel(4)
            if pred(sh) == want:
                return sh
        raise RuntimeError("sampling failed")
    setA = [sample(True) for _ in range(4)]
    setB = [sample(False) for _ in range(4)]
    answer = rng.choice(["Set A", "Set B"])
    test = sample(answer == "Set A")
    parts, lab = [], '<text x="{x}" y="16" font-family="sans-serif" font-size="14" font-weight="bold" fill="#111">{t}</text>'
    parts.append(lab.format(x=78, t="Set A"))
    parts.append(lab.format(x=318, t="Set B"))
    parts.append(lab.format(x=508, t="Test shape"))
    for i, sh in enumerate(setA):
        parts.append(f'<g transform="translate({(i % 2) * 104},{24 + (i // 2) * 104})">{panel(sh)}</g>')
    for i, sh in enumerate(setB):
        parts.append(f'<g transform="translate({240 + (i % 2) * 104},{24 + (i // 2) * 104})">{panel(sh)}</g>')
    parts.append(f'<g transform="translate(490,76)">{panel(test)}</g>')
    prompt = "Which set does the test shape belong to?\n" + wrap("".join(parts), 600, 240, 560)
    options = ["Set A", "Set B", "Neither"]
    return prompt, options, options.index(answer), f"Set A: {expA}. Set B: {expB}. The test shape fits {answer}."

# ---------- Family C: analogy --------------------------------------------------

DOTP = [(55, 14), (96, 55), (55, 96), (14, 55)]

def fig(shape, size, black, rot, dot):
    s = 30 if size == "large" else 17
    fill = BLACK if black else WHITE
    if shape == "triangle":
        body = f'<polygon points="55,{55 - s} {55 + s},{55 + s} {55 - s},{55 + s}" fill="{fill}" stroke="{BLACK}" stroke-width="2"/>'
    elif shape == "square":
        body = f'<rect x="{55 - s}" y="{55 - s}" width="{2 * s}" height="{2 * s}" fill="{fill}" stroke="{BLACK}" stroke-width="2"/>'
    else:  # arrow
        body = (f'<polygon points="55,{55 - s} {55 + s // 1},55 55,{55 + s} {55 + s // 3},55" '
                f'fill="{fill}" stroke="{BLACK}" stroke-width="2"/>')
    g = f'<g transform="rotate({rot} 55 55)">{body}</g>'
    dx, dy = DOTP[dot]
    return frame_rect() + g + f'<circle cx="{dx}" cy="{dy}" r="6" fill="#555"/>'

TRANSFORMS = {
    "rot90cw":  (lambda f: {**f, "rot": (f["rot"] + 90) % 360, "dot": (f["dot"] + 1) % 4}, "rotate 90° clockwise (the dot moves with it)"),
    "rot90ccw": (lambda f: {**f, "rot": (f["rot"] - 90) % 360, "dot": (f["dot"] - 1) % 4}, "rotate 90° anticlockwise (the dot moves with it)"),
    "invert":   (lambda f: {**f, "black": not f["black"]}, "invert the fill (black ↔ white)"),
    "resize":   (lambda f: {**f, "size": "small" if f["size"] == "large" else "large"}, "swap the size (large ↔ small)"),
    "dotflip":  (lambda f: {**f, "dot": (f["dot"] + 2) % 4}, "move the dot to the opposite side"),
}

def gen_analogy(difficulty):
    while True:
        keys = {1: 1, 2: 2, 3: 2}[difficulty]
        pool = list(TRANSFORMS) if difficulty < 3 else ["rot90ccw", "resize", "dotflip", "invert"]
        chosen = rng.sample(pool, keys)
        def T(f):
            for k in chosen:
                f = TRANSFORMS[k][0](f)
            return f
        A = {"shape": rng.choice(["triangle", "square", "arrow"]), "size": rng.choice(["large", "small"]),
             "black": rng.random() < .5, "rot": rng.choice([0, 90, 180, 270]), "dot": rng.randrange(4)}
        B = T(dict(A))
        C = dict(A)
        C["shape"] = rng.choice([s for s in ["triangle", "square", "arrow"] if s != A["shape"]])
        C["rot"] = rng.choice([0, 90, 180, 270]); C["dot"] = rng.randrange(4); C["black"] = rng.random() < .5
        ans = T(dict(C))
        def render(f): return fig(f["shape"], f["size"], f["black"], f["rot"], f["dot"])
        if render(A) == render(B) or render(C) == render(ans):
            continue
        sep = '<text x="{x}" y="62" font-family="sans-serif" font-size="22" font-weight="bold" fill="#111">{t}</text>'
        strip = (f'<g>{render(A)}</g>' + sep.format(x=116, t=":") +
                 f'<g transform="translate(136,0)">{render(B)}</g>' + sep.format(x=252, t="::") +
                 f'<g transform="translate(288,0)">{render(C)}</g>' + sep.format(x=404, t=":") +
                 f'<g transform="translate(424,0)"><rect x="3" y="3" width="104" height="104" fill="#fff" stroke="#111" stroke-width="2"/>'
                 f'<text x="46" y="68" font-family="sans-serif" font-size="34" font-weight="bold" fill="#111">?</text></g>')
        prompt = "The first figure is to the second as the third is to which answer figure?\n" + wrap(strip, 535, 110, 500)
        distract = []
        for k in TRANSFORMS:
            if k not in chosen:
                f = TRANSFORMS[k][0](dict(C))
                if render(f) != render(ans):
                    distract.append(f)
        f2 = T(T(dict(C)))
        if render(f2) != render(ans):
            distract.append(f2)
        seen, opts = {render(ans)}, [ans]
        for f in distract:
            r = render(f)
            if r not in seen:
                opts.append(f); seen.add(r)
            if len(opts) == 4:
                break
        if len(opts) < 4:
            continue
        rng.shuffle(opts)
        options = [wrap(render(f), 110, 110, 104) for f in opts]
        ci = next(i for i, f in enumerate(opts) if render(f) == render(ans))
        rule = " then ".join(TRANSFORMS[k][1] for k in chosen)
        return prompt, options, ci, f"The transformation is: {rule}. Applying it to the third figure gives the answer."

# ---------- assemble -----------------------------------------------------------

def sql_str(s): return "'" + s.replace("'", "''") + "'"

rows = []          # (position, difficulty, prompt, options, ci, explanation, practice)
pos = 91
plan = [("dial", gen_dial), ("sets", gen_sets), ("analogy", gen_analogy)]
for difficulty in (1, 2, 3):
    for fam, gen in plan:
        for _ in range(3 if not (difficulty == 2 and fam == "sets") else 4):
            pass
# exact mix: 10 per family, 10 per difficulty
mix = [("dial", 1, 3), ("sets", 1, 4), ("analogy", 1, 3),
       ("dial", 2, 4), ("sets", 2, 3), ("analogy", 2, 3),
       ("dial", 3, 3), ("sets", 3, 3), ("analogy", 3, 4)]
gens = {"dial": gen_dial, "sets": gen_sets, "analogy": gen_analogy}
generated = []
for fam, diff, n in mix:
    for _ in range(n):
        generated.append((diff, *gens[fam](diff)))
# interleave by difficulty so positions 91-120 ramp easy->hard like the rest
generated.sort(key=lambda r: r[0])
for diff, prompt, options, ci, expl in generated:
    rows.append((pos, diff, prompt, options, ci, expl, False))
    pos += 1
# two practice questions so the warm-up teaches the format
practice = [(7, 1, *gen_dial(1)[0:4]), (8, 1, *gen_analogy(1)[0:4])]

# validation: every svg parses, options unique, correct index sane
def validate(prompt, options, ci):
    for blob in [prompt] + options:
        i = blob.find("<svg")
        if i >= 0:
            ET.fromstring(blob[i:])
    assert 0 <= ci < len(options)
    assert len(set(options)) == len(options)
for r in rows: validate(r[2], r[3], r[4])
for r in practice: validate(r[2], r[3], r[4])
print(f"validated {len(rows)} live + {len(practice)} practice questions")

RETIRE = [41, 44, 46, 49, 51, 53, 54, 56, 57, 59, 60, 81, 83, 86, 90]

out = []
out.append("""-- 0049: nonverbal reasoning revamp (round 3)
-- +30 generated shape/pattern questions (sequence completion, Set A/B,
-- analogy) with SVG figures rendered by TestRunner's PromptContent /
-- OptionContent convention; -15 retired questions that were labelled hard
-- but are calculator-trivial or logically thin (net bank 90 -> 105).
-- Answers computed from generating rules (scripts/generate_nvr_questions.py,
-- deterministic seed). Practice gains 2 NVR warm-ups so the format is taught.

alter table public.test_questions drop constraint if exists test_questions_category_check;
alter table public.test_questions add constraint test_questions_category_check
  check (category in ('arithmetic','numerical','sequence','logic','verbal','nonverbal'));

with t as (select id from public.tests where event_id = '""" + EVENT_ID + """' limit 1)
update public.test_questions q set active = false
from t where q.test_id = t.id and q.is_practice = false
  and q.position in (""" + ", ".join(map(str, RETIRE)) + """);

with t as (select id from public.tests where event_id = '""" + EVENT_ID + """' limit 1)
update public.tests s set instructions = s.instructions ||
  E'\\n\\nSome questions show shapes and patterns instead of numbers — work out the rule and pick the figure that fits. No maths needed for those.'
from t where s.id = t.id;
""")
out.append("with t as (select id from public.tests where event_id = '" + EVENT_ID + "' limit 1)\n"
           "insert into public.test_questions\n"
           "  (test_id, position, difficulty, category, prompt, options, correct_index, explanation, is_practice)\n"
           "select t.id, v.position, v.difficulty, 'nonverbal', v.prompt, v.options::jsonb, v.correct_index, v.explanation, v.is_practice\n"
           "from t, (values")
vals = []
for posn, diff, prompt, options, ci, expl, prac in rows + [(p, d, pr, o, c, e, True) for p, d, pr, o, c, e in practice]:
    vals.append(f"  ({posn}, {diff}, {sql_str(prompt)}, {sql_str(json.dumps(options, ensure_ascii=False))}, {ci}, {sql_str(expl)}, {str(prac).lower()})")
out.append(",\n".join(vals))
out.append(") as v(position, difficulty, prompt, options, correct_index, explanation, is_practice);\n")

sql = "\n".join(out)
with open("supabase/migrations/0049_nonverbal_revamp.sql", "w", encoding="utf-8") as f:
    f.write(sql)
print(f"wrote migration: {len(sql)//1024} KB, {len(rows)} live rows, retire {len(RETIRE)}")
