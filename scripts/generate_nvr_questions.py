#!/usr/bin/env python3
"""Generate the nonverbal-reasoning question bank for migration 0050.

Four families modelled on standard 11+ NVR formats (per Favour's source PDFs,
Atom Learning style), replacing the 0049 set he judged too easy:
  A. Code questions     - letters code figure features; deduce the mapping from
                          labelled examples, pick the code for the test figure
  B. Matrix completion  - 3x3 grid governed by simultaneous row/column rules
  C. Odd one out        - three rotations of one figure plus one reflection
  D. Nets and cubes     - which cube can be made from the net; wrong options
                          violate the dud / opposites / orientation rules

Difficulty model (Favour 2026-06-11): easy = 2 simultaneous rules/coded
features, medium = 3, hard = 4 - plus red herrings at medium/hard. Every
answer is COMPUTED from generating rules; code questions are checked for
unique deducibility by exhaustive hypothesis search, and every nets option is
checked against the full 24-orientation legality set. Deterministic seed.
Output: supabase/migrations/0053_nets_simplify.sql
"""
import itertools, json, random, time, xml.etree.ElementTree as ET

rng = random.Random(20260611)
EVENT_ID = "b5e7f8a1-3c9d-4b2e-8f1a-6d7c8e9f0a1b"
BLACK, WHITE, GRAY = "#111111", "#ffffff", "#bbbbbb"
FILLS = {"white": WHITE, "grey": GRAY, "black": BLACK}

def wrap(inner, vw, vh, w=None):
    # opaque white backing so figures stay legible on dark-mode cards
    w = w or vw
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vw} {vh}" '
            f'width="{w}" height="{vh * w // vw}" role="img">'
            f'<rect x="0" y="0" width="{vw}" height="{vh}" fill="{WHITE}"/>{inner}</svg>')

# ---------- symbol library (local coords ~[-20,20], north = -y) ----------------
def s_arrow(fill):
    return f'<polygon points="0,-17 13,1 6,1 6,17 -6,17 -6,1 -13,1" fill="{fill}" stroke="{BLACK}" stroke-width="2.5"/>'
def s_flag(fill):
    return (f'<line x1="-2" y1="-17" x2="-2" y2="17" stroke="{BLACK}" stroke-width="3"/>'
            f'<polygon points="-2,-17 16,-9 -2,-1" fill="{fill}" stroke="{BLACK}" stroke-width="2"/>')
def s_L(fill):
    return f'<polygon points="-12,-17 -4,-17 -4,9 14,9 14,17 -12,17" fill="{fill}" stroke="{BLACK}" stroke-width="2.5"/>'
def s_half(fill):
    return (f'<circle cx="0" cy="0" r="15" fill="{WHITE}" stroke="{BLACK}" stroke-width="2.5"/>'
            f'<path d="M -15 0 A 15 15 0 0 1 15 0 Z" fill="{fill}" stroke="{BLACK}" stroke-width="2.5"/>')
def s_T(fill):
    return f'<polygon points="-14,-17 14,-17 14,-9 5,-9 5,17 -5,17 -5,-9 -14,-9" fill="{fill}" stroke="{BLACK}" stroke-width="2.5"/>'
def s_S(fill):
    return f'<polyline points="13,-14 -8,-14 -8,0 8,0 8,14 -13,14" fill="none" stroke="{BLACK}" stroke-width="4.5"/>'
def s_wedge(fill):
    return f'<path d="M -3 3 L -3 -15 A 18 18 0 0 1 15 3 Z" fill="{fill}" stroke="{BLACK}" stroke-width="2.5"/>'
def s_tri(fill):
    return f'<polygon points="0,-16 14,12 -14,12" fill="{fill}" stroke="{BLACK}" stroke-width="2.5"/>'
def s_dome(fill):
    return f'<path d="M -15 8 A 15 15 0 0 1 15 8 Z" fill="{fill}" stroke="{BLACK}" stroke-width="2.5"/>'
def s_ring(fill):
    return f'<circle cx="0" cy="0" r="12" fill="{fill}" stroke="{BLACK}" stroke-width="3.5"/>'
def s_cross(fill):
    return f'<polygon points="-4,-16 4,-16 4,-4 16,-4 16,4 4,4 4,16 -4,16 -4,4 -16,4 -16,-4 -4,-4" fill="{fill}" stroke="{BLACK}" stroke-width="2.5"/>'
def s_diamond(fill):
    return f'<polygon points="0,-16 16,0 0,16 -16,0" fill="{fill}" stroke="{BLACK}" stroke-width="2.5"/>'

SYMS = {"arrow": s_arrow, "flag": s_flag, "L": s_L, "half": s_half, "T": s_T,
        "S": s_S, "wedge": s_wedge, "ring": s_ring, "cross": s_cross, "diamond": s_diamond,
        "tri": s_tri, "dome": s_dome}
SYM_NAME = {"arrow": "arrow", "flag": "flag", "L": "L-shape", "half": "half-shaded circle",
            "T": "T-shape", "S": "S-shape", "wedge": "quarter-wedge", "ring": "ring",
            "cross": "cross", "diamond": "diamond", "tri": "triangle", "dome": "dome"}
# extra rotations that visibly change each symbol (mod its own symmetry)
ROT_DISTINCT = {"arrow": [90, 180, 270], "flag": [90, 180, 270], "L": [90, 180, 270],
                "half": [90, 180, 270], "T": [90, 180, 270], "wedge": [90, 180, 270],
                "S": [90, 270], "ring": [], "cross": [], "diamond": [],
                "tri": [90, 180, 270], "dome": [90, 180, 270]}
# symmetry group (rotations that leave the symbol unchanged) for canonicalising
SYM_GROUP = {"ring": [0, 90, 180, 270], "cross": [0, 90, 180, 270],
             "diamond": [0, 90, 180, 270], "S": [0, 180]}

def place(sym, fill, x, y, scale=1.0, rot=0):
    return (f'<g transform="translate({x},{y}) rotate({rot}) scale({scale})">'
            f'{SYMS[sym](fill)}</g>')

# ---------- Family A: code questions -------------------------------------------

F_OUTER, F_FILL = ["square", "circle", "triangle"], ["white", "grey", "black"]
F_INNER, F_DOT, F_SIZE = ["cross", "ring", "diamond"], ["N", "E", "S", "W"], ["large", "small"]
FEATURES = [("outer", F_OUTER), ("fill", F_FILL), ("inner", F_INNER), ("dot", F_DOT), ("size", F_SIZE)]
FEAT_LABEL = {"outer": "the outer shape", "fill": "the shading", "inner": "the inner mark",
              "dot": "the dot position", "size": "the size"}
POS_LETTERS = [list("ABCD"), list("XYZW"), list("FGHJ"), list("KLMN")]
DOT_XY = {"N": (0, -41), "E": (41, 0), "S": (0, 41), "W": (-41, 0)}
ORDINAL = ["First", "Second", "Third", "Fourth"]

def outer_svg(kind, fill, r):
    f = FILLS[fill]
    if kind == "square":
        return f'<rect x="{-r}" y="{-r}" width="{2*r}" height="{2*r}" fill="{f}" stroke="{BLACK}" stroke-width="2.5"/>'
    if kind == "circle":
        return f'<circle cx="0" cy="0" r="{r}" fill="{f}" stroke="{BLACK}" stroke-width="2.5"/>'
    return f'<polygon points="0,{-r} {r},{round(r*0.85)} {-r},{round(r*0.85)}" fill="{f}" stroke="{BLACK}" stroke-width="2.5"/>'

def inner_svg(kind, ink):
    if kind == "cross":
        return f'<polygon points="-3,-11 3,-11 3,-3 11,-3 11,3 3,3 3,11 -3,11 -3,3 -11,3 -11,-3 -3,-3" fill="{ink}"/>'
    if kind == "ring":
        return f'<circle cx="0" cy="0" r="8" fill="none" stroke="{ink}" stroke-width="3.5"/>'
    return f'<polygon points="0,-10 10,0 0,10 -10,0" fill="{ink}"/>'

def code_panel(p):
    r = 33 if p["size"] == "large" else 22
    ink = WHITE if p["fill"] == "black" else BLACK
    dx, dy = DOT_XY[p["dot"]]
    yoff = 6 if p["outer"] == "triangle" else 0   # triangle centroid sits low
    return (f'<rect x="-50" y="-50" width="100" height="100" fill="{WHITE}" stroke="{BLACK}" stroke-width="2"/>'
            f'<g transform="translate(0,{-yoff})">{outer_svg(p["outer"], p["fill"], r)}</g>'
            f'<g transform="translate(0,{0 if p["outer"] != "triangle" else 4})">{inner_svg(p["inner"], ink)}</g>'
            f'<circle cx="{dx}" cy="{dy}" r="5" fill="{BLACK}"/>')

def solve_codes(examples, test, n_pos):
    """All consistent (positions -> distinct features, value <-> letter bijection)
    hypotheses. Returns None if any consistent hypothesis cannot code the test
    panel (unknowable), else the set of predicted codes."""
    answers = set()
    for combo in itertools.permutations(range(len(FEATURES)), n_pos):
        ok, maps = True, []
        for p, fi in enumerate(combo):
            fname = FEATURES[fi][0]
            m, rev = {}, {}
            for panel, code in examples:
                v, c = panel[fname], code[p]
                if m.get(v, c) != c or rev.get(c, v) != v:
                    ok = False
                    break
                m[v] = c
                rev[c] = v
            if not ok:
                break
            maps.append((fname, m))
        if not ok:
            continue
        pred = []
        for fname, m in maps:
            if test[fname] not in m:
                return None
            pred.append(m[test[fname]])
        answers.add(tuple(pred))
    return answers

def rand_code_panel():
    return {f: rng.choice(vs) for f, vs in FEATURES}

def gen_codes(difficulty):
    # Favour 2026-06-11 (round 2): one notch easier. Easy = 2 letters with NO
    # red herrings (uncoded features held constant), medium = 2 letters with
    # varying uncoded features, hard = 3 letters. A 1-letter code was rejected:
    # with one position the deduction collapses to spot-the-shared-feature and
    # there are rarely more than two plausible distractor codes.
    k = {1: 2, 2: 2, 3: 3}[difficulty]
    n_ex = k + 2
    noiseless = difficulty == 1
    for _ in range(4000):
        coded = rng.sample(range(len(FEATURES)), k)
        vmaps = []
        for p, fi in enumerate(coded):
            vals = FEATURES[fi][1]
            vmaps.append(dict(zip(vals, rng.sample(POS_LETTERS[p][:len(vals)], len(vals)))))
        def code_of(panel):
            return tuple(vmaps[p][panel[FEATURES[fi][0]]] for p, fi in enumerate(coded))
        examples = [rand_code_panel() for _ in range(n_ex)]
        test = rand_code_panel()
        if noiseless:
            for fi in range(len(FEATURES)):
                if fi not in coded:
                    f, vs = FEATURES[fi]
                    cv = rng.choice(vs)
                    for e in examples:
                        e[f] = cv
                    test[f] = cv
        # coded feature values of the test must be learnable from the examples,
        # coded features must actually vary, and the test must not be a copy
        bad = False
        for fi in coded:
            f = FEATURES[fi][0]
            seen = {e[f] for e in examples}
            if test[f] not in seen or len(seen) < 2:
                bad = True
                break
        if bad or any(all(e[f] == t for f, t in test.items()) for e in examples):
            continue
        # red herring: at medium/hard every UNCODED feature must vary too
        if difficulty >= 2:
            for fi in range(len(FEATURES)):
                if fi not in coded and len({e[FEATURES[fi][0]] for e in examples}) < 2:
                    bad = True
                    break
            if bad:
                continue
        exs = [(e, code_of(e)) for e in examples]
        sols = solve_codes(exs, test, k)
        if sols is None or len(sols) != 1:
            continue
        answer = code_of(test)
        # distractors: 1-letter mutations using letters seen at that position
        seen_letters = [sorted({c[p] for _, c in exs}) for p in range(k)]
        cands = []
        for p in range(k):
            for c in seen_letters[p]:
                if c != answer[p]:
                    cands.append(answer[:p] + (c,) + answer[p + 1:])
        rng.shuffle(cands)
        opts = [answer]
        for c in cands:
            if c not in opts:
                opts.append(c)
            if len(opts) == 4:
                break
        if len(opts) < 4:
            continue
        rng.shuffle(opts)
        ci = opts.index(answer)
        # prompt drawing: labelled examples, then the unlabelled test panel
        parts = []
        for i, (e, c) in enumerate(exs):
            x = 54 + i * 112
            parts.append(f'<g transform="translate({x},56)">{code_panel(e)}</g>')
            parts.append(f'<text x="{x}" y="132" text-anchor="middle" font-family="sans-serif" '
                         f'font-size="16" font-weight="bold" fill="{BLACK}">{" ".join(c)}</text>')
        tx = 54 + n_ex * 112 + 36
        parts.append(f'<g transform="translate({tx},56)">{code_panel(test)}</g>')
        parts.append(f'<text x="{tx}" y="132" text-anchor="middle" font-family="sans-serif" '
                     f'font-size="20" font-weight="bold" fill="{BLACK}">?</text>')
        vw = tx + 70
        prompt = ("Each figure is labelled with its code. Work out what each letter stands for, "
                  "then select the code for the final figure.\n" + wrap("".join(parts), vw, 146, min(vw, 720)))
        options = [" ".join(o) for o in opts]
        expl = []
        for p, fi in enumerate(coded):
            fname, vals = FEATURES[fi]
            pairs = ", ".join(f"{vmaps[p][v]} = {v}" for v in vals if v in {e[fname] for e in examples})
            expl.append(f"{ORDINAL[p]} letter codes {FEAT_LABEL[fname]} ({pairs})")
        explanation = "; ".join(expl) + f". The final figure's code is {' '.join(answer)}."
        return prompt, options, ci, explanation
    raise RuntimeError("gen_codes failed")

# ---------- Family B: matrix completion ----------------------------------------

CORNER_XY = {0: (38, -38), 1: (38, 38), 2: (-38, 38), 3: (-38, -38)}  # NE SE SW NW
CORNER_NAME = {0: "top-right", 1: "bottom-right", 2: "bottom-left", 3: "top-left"}

def inner_arrow(ink):
    return f'<polygon points="0,-14 10,0 4,0 4,14 -4,14 -4,0 -10,0" fill="{ink}"/>'

def matrix_cell(c):
    ink = WHITE if c["fill"] == "black" else BLACK
    dx, dy = CORNER_XY[c["dot"]]
    return (f'<rect x="-50" y="-50" width="100" height="100" fill="{WHITE}" stroke="{BLACK}" stroke-width="2"/>'
            f'{outer_svg(c["shape"], c["fill"], 32)}'
            f'<g transform="rotate({c["rot"]})">{inner_arrow(ink)}</g>'
            f'<circle cx="{dx}" cy="{dy}" r="5.5" fill="{BLACK}" stroke="{WHITE}" stroke-width="1.5"/>')

M_ATTRS = ["shape", "fill", "rot", "dot"]

def gen_matrix(difficulty):
    k = {1: 2, 2: 3, 3: 4}[difficulty]
    for _ in range(2000):
        ruled = rng.sample(M_ATTRS, k)
        rules, desc = {}, []
        for a in ruled:
            axis = rng.choice(["row", "col"])
            axname = "row" if axis == "row" else "column"
            if a == "shape":
                vals = rng.sample(F_OUTER, 3)
                rules[a] = lambda r, c, vals=vals, axis=axis: vals[r if axis == "row" else c]
                desc.append(f"the outer shape is fixed by {axname} ({', '.join(vals)})")
            elif a == "fill":
                vals = rng.sample(F_FILL, 3)
                rules[a] = lambda r, c, vals=vals, axis=axis: vals[r if axis == "row" else c]
                desc.append(f"the shading is fixed by {axname} ({', '.join(vals)})")
            elif a == "rot":
                base, d = rng.randrange(4), rng.choice([1, -1])
                rules[a] = lambda r, c, base=base, d=d, axis=axis: ((base + d * (r if axis == "row" else c)) % 4) * 90
                desc.append(f"the arrow rotates 90° {'clockwise' if d == 1 else 'anticlockwise'} along each {axname}")
            else:
                base, d = rng.randrange(4), rng.choice([1, -1])
                rules[a] = lambda r, c, base=base, d=d, axis=axis: (base + d * (r if axis == "row" else c)) % 4
                desc.append(f"the corner dot moves one corner {'clockwise' if d == 1 else 'anticlockwise'} along each {axname}")
        const = {"shape": rng.choice(F_OUTER), "fill": rng.choice(F_FILL),
                 "rot": rng.randrange(4) * 90, "dot": rng.randrange(4)}
        def cell(r, c):
            out = dict(const)
            for a, fn in rules.items():
                out[a] = fn(r, c)
            return out
        correct = cell(2, 2)
        # distractors: each takes one ruled attribute from a different grid cell
        cands = []
        for a in ruled:
            for (r, c) in [(0, 0), (0, 2), (2, 0), (1, 1)]:
                wrong = cell(r, c)[a]
                if wrong != correct[a]:
                    mut = dict(correct)
                    mut[a] = wrong
                    cands.append(mut)
        seen = {matrix_cell(correct)}
        opts = [correct]
        rng.shuffle(cands)
        for m in cands:
            s = matrix_cell(m)
            if s not in seen:
                opts.append(m)
                seen.add(s)
            if len(opts) == 4:
                break
        if len(opts) < 4:
            continue
        rng.shuffle(opts)
        ci = next(i for i, o in enumerate(opts) if matrix_cell(o) == matrix_cell(correct))
        grid = []
        for r in range(3):
            for c in range(3):
                x, y = 54 + c * 104, 54 + r * 104
                if (r, c) == (2, 2):
                    grid.append(f'<rect x="{x-50}" y="{y-50}" width="100" height="100" fill="{WHITE}" stroke="{BLACK}" stroke-width="2"/>'
                                f'<text x="{x}" y="{y+12}" text-anchor="middle" font-family="sans-serif" font-size="40" font-weight="bold" fill="{BLACK}">?</text>')
                else:
                    grid.append(f'<g transform="translate({x},{y})">{matrix_cell(cell(r, c))}</g>')
        prompt = "Select the option that completes the matrix.\n" + wrap("".join(grid), 316, 316, 300)
        options = [wrap(f'<g transform="translate(55,55)">{matrix_cell(o)}</g>', 110, 110, 104) for o in opts]
        explanation = "Rules: " + "; ".join(desc) + ". Apply all of them to the bottom-right cell."
        return prompt, options, ci, explanation
    raise RuntimeError("gen_matrix failed")

# ---------- Family C: odd one out (reflection among rotations) ------------------

def odd_compound(base, chiral, base_fill, accent_fill, chiral_scale):
    # three DIFFERENT elements at the corners of a scalene triangle: chirality
    # comes from the arrangement itself, never from one small element alone
    # (a near-collinear layout lets a reflection masquerade as a 180 rotation)
    return (place(base, FILLS[base_fill], 0, 16, 1.6)
            + place(chiral, WHITE, 28, -20, chiral_scale)
            + f'<rect x="-38" y="-30" width="16" height="16" fill="{FILLS[accent_fill]}" stroke="{BLACK}" stroke-width="2"/>')

def odd_option_svg(inner, angle, mirror):
    flip = ' scale(-1,1)' if mirror else ''
    return wrap(f'<rect x="3" y="3" width="104" height="104" fill="{WHITE}" stroke="{BLACK}" stroke-width="2"/>'
                f'<g transform="translate(55,55) rotate({angle}){flip} scale(0.85)">{inner}</g>', 110, 110, 104)

def raster_distinct(svgs, thresh=0.03):
    """Every pair of option images must differ on >= thresh of pixels, so a
    reflection can never look near-identical to one of the shown rotations.
    Soft dependency: skipped (returns True) if cairosvg/PIL are unavailable."""
    try:
        import io as _io
        import cairosvg
        from PIL import Image, ImageChops
    except Exception:
        return True
    imgs = []
    for s in svgs:
        png = cairosvg.svg2png(bytestring=s.encode(), output_width=88, output_height=88)
        imgs.append(Image.open(_io.BytesIO(png)).convert("L"))
    for i in range(len(imgs)):
        for j in range(i + 1, len(imgs)):
            diff = ImageChops.difference(imgs[i], imgs[j])
            frac = sum(1 for px in diff.getdata() if px > 40) / (88 * 88)
            if frac < thresh:
                return False
    return True

def herring_fills(n=4):
    # two values, each appearing twice, shuffled - so no option is uniquely shaded
    a, b = rng.sample(F_FILL, 2)
    fills = [a, a, b, b]
    rng.shuffle(fills)
    return fills

def gen_odd(difficulty):
    base = rng.choice(["wedge", "half", "arrow"])
    chiral = {1: rng.choice(["flag", "L"]), 2: rng.choice(["flag", "L"]), 3: "S"}[difficulty]
    cscale = {1: 0.95, 2: 0.7, 3: 0.55}[difficulty]
    step = 90 if difficulty == 1 else 45
    if difficulty == 1:
        bfills = [rng.choice(F_FILL)] * 4
        afills = [rng.choice(F_FILL)] * 4
    elif difficulty == 2:
        bfills = [rng.choice(F_FILL)] * 4
        afills = herring_fills()
    else:
        bfills = herring_fills()
        afills = herring_fills()
    options = None
    for _ in range(300):
        angles = rng.sample(range(0, 360, step), 4)
        mirror_idx = rng.randrange(4)
        cand = [odd_option_svg(odd_compound(base, chiral, bfills[i], afills[i], cscale),
                               angles[i], i == mirror_idx) for i in range(4)]
        if len(set(cand)) == 4 and raster_distinct(cand):
            options = cand
            break
    if options is None:
        raise RuntimeError("gen_odd failed to find visually distinct options")
    prompt = "Three of these figures are rotations of one figure. Select the one that is most unlike the others."
    herring = "" if difficulty == 1 else " The shading differences are a red herring - no single figure is uniquely shaded."
    explanation = (f"The odd one out is a REFLECTION of the others, not a rotation - "
                   f"check which side of the {SYM_NAME[base]} the {SYM_NAME[chiral]} sits on as you rotate each figure.{herring}")
    return prompt, options, mirror_idx, explanation

# ---------- Family D: nets and cubes --------------------------------------------
# Cross net (U above F; L F R B in a row; D below F). Folding gives each face a
# painted frame (u = symbol right, v = symbol up) in cube-body coordinates:
AX = {"F": (0, 0, 1), "B": (0, 0, -1), "U": (0, 1, 0), "D": (0, -1, 0), "L": (-1, 0, 0), "R": (1, 0, 0)}
FRAME = {"F": ((1, 0, 0), (0, 1, 0)), "U": ((1, 0, 0), (0, 0, -1)), "D": ((1, 0, 0), (0, 0, 1)),
         "L": ((0, 0, 1), (0, 1, 0)), "R": ((0, 0, -1), (0, 1, 0)), "B": ((-1, 0, 0), (0, 1, 0))}
OPP = {"F": "B", "B": "F", "U": "D", "D": "U", "L": "R", "R": "L"}
NET_POS = {"U": (1, 0), "L": (0, 1), "F": (1, 1), "R": (2, 1), "B": (3, 1), "D": (1, 2)}

def vneg(a): return (-a[0], -a[1], -a[2])

def _verify_frames():
    """Independent derivation of FRAME by simulating the fold: rotate each net
    cell about its hinge(s) so the flaps wrap BEHIND the F plane. Integer-exact."""
    def rotx(v, sgn):  # +/-90 about x
        x, y, z = v
        return (x, -sgn * z, sgn * y)
    def roty(v, sgn):  # +/-90 about y
        x, y, z = v
        return (sgn * z, y, -sgn * x)
    chains = {"F": [], "U": [("x", -1)], "D": [("x", 1)], "L": [("y", -1)],
              "R": [("y", 1)], "B": [("y", 1), ("y", 1)]}
    for face, chain in chains.items():
        n, u, v = (0, 0, 1), (1, 0, 0), (0, 1, 0)   # painted normal/right/up flat on the net
        for ax, sgn in chain:
            f = rotx if ax == "x" else roty
            n, u, v = f(n, sgn), f(u, sgn), f(v, sgn)
        assert n == AX[face], f"fold sim normal mismatch for {face}: {n}"
        assert (u, v) == FRAME[face], f"fold sim frame mismatch for {face}: {(u, v)}"
_VERIFIED = None  # set after FRAME/AX definitions below
def vcross(a, b): return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
def mapv(M, v): return tuple(sum(M[i][j]*v[j] for j in range(3)) for i in range(3))

def rot_uv(u, v, r):
    """Frame of a symbol rotated r deg clockwise within its face."""
    for _ in range((r // 90) % 4):
        u, v = vneg(v), u
    return u, v

def orient_for(fl_face, top_face):
    """Rotation matrix taking body axes so fl_face faces +z (front-left panel)
    and top_face faces +y. Returns (M, fr_face)."""
    nf, ng = AX[fl_face], AX[top_face]
    nh = vcross(nf, ng)
    # M[i][j] = sum_k Tcol_k[i] * Scol_k[j] with Scols = (nf, ng, nh) -> (z, y, z×y=-x)
    Tcols = [(0, 0, 1), (0, 1, 0), (-1, 0, 0)]
    Scols = [nf, ng, nh]
    M = [[sum(Tcols[k][i] * Scols[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
    fr = next(f for f, n in AX.items() if mapv(M, n) == (1, 0, 0))
    return M, fr

ALL_VIEWS = [(f, g) for f in AX for g in AX if g != f and g != OPP[f]]
_verify_frames()

ISO = 27
def P(v):
    x, y, z = v
    return (0.866 * (x - z) * ISO, (0.5 * (x + z) - y) * ISO)

def canon_panel(sym, u, v):
    """Quantised, symmetry-canonical signature of a rendered panel."""
    cands = []
    for r in SYM_GROUP.get(sym, [0]):
        uu, vv = rot_uv(u, v, r)
        cands.append((uu, vv))
    return (sym, min(cands))

CUBE_AXES = {"T": ((0, 1, 0), (1, 0, 0), (0, 0, 1)),
             "FL": ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
             "FR": ((1, 0, 0), (0, 0, 1), (0, 1, 0))}

def cube_svg(panels):
    """panels: dict pos -> (sym, fill, u_world, v_world); pos in T, FL, FR.
    Panel quads use canonical in-plane axes; only the symbol uses (u, v)."""
    cx, cy = 55, 60
    parts = []
    for pos in ("FL", "FR", "T"):
        n, a1, a2 = CUBE_AXES[pos]
        sym, fill, u, v = panels[pos]
        assert sum(ui * ni for ui, ni in zip(u, n)) == 0, "symbol frame must lie in the panel plane"
        pn, pu, pv = P(n), P(u), P(v)
        q1, q2 = P(a1), P(a2)
        corners = [(cx + pn[0] + s1 * q1[0] + s2 * q2[0], cy + pn[1] + s1 * q1[1] + s2 * q2[1])
                   for s1, s2 in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
        pts = " ".join(f"{x:.1f},{y:.1f}" for x, y in corners)
        parts.append(f'<polygon points="{pts}" fill="{WHITE}" stroke="{BLACK}" stroke-width="2"/>')
        # symbol local coords are ~[-20,20]; matrix maps local x->u, local -y->v
        k = 0.034
        a, b = pu[0] * k, pu[1] * k
        c, d = -pv[0] * k, -pv[1] * k
        e, f = cx + pn[0], cy + pn[1]
        parts.append(f'<g transform="matrix({a:.3f},{b:.3f},{c:.3f},{d:.3f},{e:.1f},{f:.1f})">{SYMS[sym](fill)}</g>')
    return "".join(parts)

def legit_panels(faces, M, fr_map):
    """Render-true panels for orientation map fr_map = {pos: face}."""
    out = {}
    for pos, face in fr_map.items():
        sym, fill, cr = faces[face]
        u, v = rot_uv(*FRAME[face], cr)
        out[pos] = (sym, fill, mapv(M, u), mapv(M, v))
    return out

def panels_sig(panels):
    return tuple(canon_panel(panels[pos][0], panels[pos][2], panels[pos][3]) for pos in ("T", "FL", "FR"))

def legal_set(faces):
    sigs = set()
    for fl, top in ALL_VIEWS:
        M, fr = orient_for(fl, top)
        sigs.add(panels_sig(legit_panels(faces, M, {"FL": fl, "T": top, "FR": fr})))
    return sigs

def pick_view(faces, need_directional=2):
    for _ in range(200):
        fl, top = rng.choice(ALL_VIEWS)
        M, fr = orient_for(fl, top)
        vis = [fl, top, fr]
        if sum(1 for f in vis if faces[f][0] in ROT_DISTINCT and ROT_DISTINCT[faces[f][0]]) >= need_directional:
            return fl, top, fr, M
    raise RuntimeError("no informative view")

def net_svg(faces):
    parts = []
    for face, (gx, gy) in NET_POS.items():
        x, y = 8 + gx * 54, 8 + gy * 54
        sym, fill, cr = faces[face]
        parts.append(f'<rect x="{x}" y="{y}" width="54" height="54" fill="{WHITE}" stroke="{BLACK}" stroke-width="2"/>')
        parts.append(f'<g transform="translate({x+27},{y+27}) rotate({cr}) scale(0.95)">{SYMS[sym](fill)}</g>')
    return wrap("".join(parts), 232, 178, 232)

# shapes that read alike once affine-skewed onto a cube face; never let a dud
# introduce one when its lookalike is on the net
CONFUSABLE = {"dome": {"half", "wedge"}, "half": {"dome"}, "wedge": {"dome"},
              "tri": {"arrow"}, "arrow": {"tri"}}

def gen_cube_net(level):
    """Both levels share the same blatant violation structure (opposites +
    180-degree flip + off-net dud); only shape complexity separates them.
    level 1 (MEDIUM) = bold, simple shapes; level 2 (HARD) = the thinner,
    subtler original pool. The two former harder tiers (90-degree flips,
    wrong colours, exotic symbols) were dropped per Favour: past the point
    where working it out beats screenshotting the question into an LLM."""
    pool = {1: ["arrow", "tri", "dome", "T", "L", "ring"],
            2: ["arrow", "flag", "L", "half", "T", "wedge"]}[level]
    for _ in range(500):
        chosen = rng.sample(pool, 6)
        if sum(1 for s in chosen if ROT_DISTINCT[s]) < 4:
            continue
        faces = {f: (chosen[i], rng.choice([WHITE, BLACK]) if chosen[i] not in ("S", "ring") else WHITE,
                     rng.randrange(4) * 90) for i, f in enumerate(AX)}
        legal = legal_set(faces)
        confus = set().union(*(CONFUSABLE.get(c, set()) for c in chosen))
        unused = [s for s in SYMS if s not in chosen and s not in confus]

        fl, top, fr, M = pick_view(faces)
        correct_panels = legit_panels(faces, M, {"FL": fl, "T": top, "FR": fr})
        wrongs, reasons = [], []

        def fresh_view():
            f2, t2, r2, M2 = pick_view(faces)
            return {"FL": f2, "T": t2, "FR": r2}, M2

        # 1) opposites violation: top panel shows the face OPPOSITE the front-left
        vmap, M2 = fresh_view()
        opp_face = OPP[vmap["FL"]]
        pan = legit_panels(faces, M2, vmap)
        s_o, f_o, _ = faces[opp_face]
        pan["T"] = (s_o, f_o, pan["T"][2], pan["T"][3])   # in the top panel's own plane
        wrongs.append(pan)
        reasons.append(f"shows the {SYM_NAME[s_o]} next to the {SYM_NAME[faces[vmap['FL']][0]]}, "
                       f"but they are on opposite faces of the net")

        # 2) orientation violation
        vmap, M2 = fresh_view()
        pan = legit_panels(faces, M2, vmap)
        rot_targets = [p for p in pan if ROT_DISTINCT[pan[p][0]]]
        pos = rng.choice(rot_targets)
        face = vmap[pos]
        sym, fill, cr = faces[face]
        extra = 180
        u, v = rot_uv(*rot_uv(*FRAME[face], cr), extra)
        pan[pos] = (sym, fill, mapv(M2, u), mapv(M2, v))
        wrongs.append(pan)
        reasons.append(f"the {SYM_NAME[sym]} is rotated the wrong way")

        # 3) third wrong option: blatant dud at level 1, wrong colour at level 2
        vmap, M2 = fresh_view()
        pan = legit_panels(faces, M2, vmap)
        pos = rng.choice(list(pan))
        dud = rng.choice(unused)
        dud_fill = WHITE if dud in ("S", "ring") else rng.choice([WHITE, BLACK])
        pan[pos] = (dud, dud_fill, pan[pos][2], pan[pos][3])
        reasons.append(f"shows a {SYM_NAME[dud]}, which is not on the net at all")
        wrongs.append(pan)

        # verify: correct is legal; every wrong is illegal (vs all 24 views) and
        # colour-duds are checked by fill mismatch instead of signature
        if panels_sig(correct_panels) not in legal:
            continue
        ok = True
        sigs = {json.dumps(panels_sig(correct_panels), sort_keys=True)}
        fills_by_sym = {faces[f][0]: faces[f][1] for f in faces}
        for pan in wrongs:
            sig = panels_sig(pan)
            fill_bad = any(p[0] in fills_by_sym and p[1] != fills_by_sym[p[0]] for p in pan.values())
            dud_bad = any(p[0] not in fills_by_sym for p in pan.values())
            if sig in legal and not fill_bad and not dud_bad:
                ok = False
                break
            j = json.dumps(sig, sort_keys=True) + ("F" if fill_bad else "") + ("D" if dud_bad else "")
            if j in sigs:
                ok = False
                break
            sigs.add(j)
        if not ok:
            continue

        all_pans = [("C", correct_panels)] + [("W", w) for w in wrongs]
        rng.shuffle(all_pans)
        ci = next(i for i, (tag, _) in enumerate(all_pans) if tag == "C")
        options = [wrap(cube_svg(pan), 110, 116, 104) for _, pan in all_pans]
        if len(set(options)) < 4:
            continue
        prompt = "Which cube can be made from this net?\n" + net_svg(faces)
        explanation = ("Check each cube against the net using duds, opposite faces and orientation. "
                       + "; ".join(f"one option {r}" for r in reasons)
                       + ". The remaining cube is consistent with the net.")
        return prompt, options, ci, explanation
    raise RuntimeError("gen_cube_net failed")


# ---------- Family D (easy): square-based pyramid nets ---------------------------
# 4 triangles around a base square, symbols pointing outward (= toward the apex
# once folded). Adjacent triangles share a slant edge; opposite triangles only
# ever meet at the apex, so a view showing them side by side is impossible.

# CHIRALITY (bug caught by Favour on the first preview): unfolding a
# paint-outside pyramid into a paint-up net requires flipping it apex-down,
# and that flip MIRRORS the net's cyclic order. So for an outside viewer of
# the assembled pyramid, (left, right) is legal iff right is the CLOCKWISE
# neighbour of left AS DRAWN ON THE NET: order N -> E -> S -> W.
PYR_ORDER = ["N", "E", "S", "W"]
PYR_OPP = {"N": "S", "S": "N", "E": "W", "W": "E"}
PYR_NET_ROT = {"N": 0, "E": 90, "S": 180, "W": 270}

def pyr_right_of(f):
    return PYR_ORDER[(PYR_ORDER.index(f) + 1) % 4]

def _verify_pyramid_order():
    """Numeric tripwire for the chirality above. Net N becomes the final
    SOUTH face after the apex-up flip (180 about the E-W axis); E/W stay.
    A ground-level viewer at the corner between two faces sees the face on
    the +left side of their view axis on the left."""
    final_dir = {"N": (0, -1), "S": (0, 1), "E": (1, 0), "W": (-1, 0)}
    for lf in PYR_ORDER:
        rf = pyr_right_of(lf)
        ld, rd = final_dir[lf], final_dir[rf]
        fx, fy = -(ld[0] + rd[0]), -(ld[1] + rd[1])   # facing the pyramid
        lx, ly = -fy, fx                              # viewer's left (ccw 90 from facing)
        assert ld[0] * lx + ld[1] * ly > 0 and rd[0] * lx + rd[1] * ly < 0, \
            f"pyramid pair ({lf},{rf}) is not a physically visible left/right pair"
_verify_pyramid_order()

def pyramid_net_svg(tris, base_sym):
    c, h, half = 88, 50, 28
    parts = [f'<rect x="{c-half}" y="{c-half}" width="{2*half}" height="{2*half}" fill="{WHITE}" stroke="{BLACK}" stroke-width="2"/>',
             place(base_sym[0], base_sym[1], c, c, 0.85)]
    APEX = {"N": (c, c-half-h), "E": (c+half+h, c), "S": (c, c+half+h), "W": (c-half-h, c)}
    CORNERS = {"N": ((c-half, c-half), (c+half, c-half)), "E": ((c+half, c-half), (c+half, c+half)),
               "S": ((c+half, c+half), (c-half, c+half)), "W": ((c-half, c+half), (c-half, c-half))}
    for f in ["N", "E", "S", "W"]:
        (x1, y1), (x2, y2) = CORNERS[f]
        ax, ay = APEX[f]
        parts.append(f'<polygon points="{x1},{y1} {x2},{y2} {ax},{ay}" fill="{WHITE}" stroke="{BLACK}" stroke-width="2"/>')
        sym, fill = tris[f]
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        sx, sy = mx + (ax - mx) * 0.42, my + (ay - my) * 0.42
        parts.append(place(sym, fill, round(sx, 1), round(sy, 1), 0.62, rot=PYR_NET_ROT[f]))
    return wrap("".join(parts), 176, 176, 176)

def _unit2(v, scale):
    n = (v[0] ** 2 + v[1] ** 2) ** 0.5
    return (v[0] / n * scale, v[1] / n * scale)

def pyramid_view_svg(left, right, lrot=0, rrot=0):
    """3/4 view: apex + two visible triangular faces; extra rot 0 = correct
    (symbol points at the apex)."""
    Px, A, B, C, D = (55, 14), (12, 82), (57, 98), (97, 74), (50, 58)
    parts = [
        f'<polygon points="{A[0]},{A[1]} {B[0]},{B[1]} {Px[0]},{Px[1]}" fill="{WHITE}" stroke="{BLACK}" stroke-width="2"/>',
        f'<polygon points="{B[0]},{B[1]} {C[0]},{C[1]} {Px[0]},{Px[1]}" fill="{WHITE}" stroke="{BLACK}" stroke-width="2"/>',
        f'<line x1="{A[0]}" y1="{A[1]}" x2="{D[0]}" y2="{D[1]}" stroke="{BLACK}" stroke-width="1.5" stroke-dasharray="4,3"/>',
        f'<line x1="{C[0]}" y1="{C[1]}" x2="{D[0]}" y2="{D[1]}" stroke="{BLACK}" stroke-width="1.5" stroke-dasharray="4,3"/>',
    ]
    for (sym, fill), rot, Lc, Rc in [(left, lrot, A, B), (right, rrot, B, C)]:
        mid = ((Lc[0] + Rc[0]) / 2, (Lc[1] + Rc[1]) / 2)
        cx, cy = mid[0] + (Px[0] - mid[0]) * 0.30, mid[1] + (Px[1] - mid[1]) * 0.30
        u = (Rc[0] - Lc[0], Rc[1] - Lc[1])
        v = (Px[0] - mid[0], Px[1] - mid[1])
        for _ in range((rot // 90) % 4):
            u, v = (-v[0], -v[1]), u
        un, vn = _unit2(u, 0.60), _unit2(v, 0.64)
        parts.append(f'<g transform="matrix({un[0]:.3f},{un[1]:.3f},{-vn[0]:.3f},{-vn[1]:.3f},{cx:.1f},{cy:.1f})">{SYMS[sym](fill)}</g>')
    return wrap("".join(parts), 110, 112, 104)

def gen_pyramid():
    pool = ["arrow", "flag", "L", "half", "T", "wedge"]
    for _ in range(300):
        chosen = rng.sample(pool, 5)
        tris = {f: (chosen[i], rng.choice([WHITE, BLACK])) for i, f in enumerate(PYR_ORDER)}
        base_sym = (chosen[4], rng.choice([WHITE, BLACK]))
        confus = set().union(*(CONFUSABLE.get(c, set()) for c in chosen))
        unused = [x for x in SYMS if x not in chosen and x not in confus]
        cf = rng.choice(PYR_ORDER)
        correct = ("ok", cf, 0, pyr_right_of(cf), 0, None)
        wrongs, reasons = [], []
        f1 = rng.choice(PYR_ORDER)
        wrongs.append(("opp", f1, 0, PYR_OPP[f1], 0, None))
        reasons.append(f"shows the {SYM_NAME[tris[f1][0]]} and the {SYM_NAME[tris[PYR_OPP[f1]][0]]} side by side, "
                       f"but they sit on opposite sides of the square and can only meet at the apex")
        f2 = rng.choice(PYR_ORDER)
        side = rng.randrange(2)
        wrongs.append(("flip", f2, 180 if side == 0 else 0, pyr_right_of(f2), 0 if side == 0 else 180, None))
        flipped = tris[f2][0] if side == 0 else tris[pyr_right_of(f2)][0]
        reasons.append(f"the {SYM_NAME[flipped]} points to the base, but every shape on the net points away from the square")
        f3 = rng.choice(PYR_ORDER)
        dud = rng.choice(unused)
        wrongs.append(("dud", f3, 0, pyr_right_of(f3), 0, dud))
        reasons.append(f"shows a {SYM_NAME[dud]}, which is not on the net")

        def render(t):
            _, lf, lr, rf, rr, dudsym = t
            left = tris[lf]
            right = (dudsym, rng.choice([WHITE, BLACK])) if dudsym else tris[rf]
            return pyramid_view_svg(left, right, lr, rr)

        rendered, seen, ok = [], set(), True
        for tag, t in [("C", correct)] + [("W", w) for w in wrongs]:
            r = render(t)
            if r in seen:
                ok = False
                break
            seen.add(r)
            rendered.append((tag, r))
        if not ok:
            continue
        rng.shuffle(rendered)
        ci = next(i for i, (tag, _) in enumerate(rendered) if tag == "C")
        options = [r for _, r in rendered]
        prompt = ("This net folds up into a square-based pyramid, with the shapes on the outside. "
                  "Which pyramid can be made from this net?\n" + pyramid_net_svg(tris, base_sym))
        explanation = ("When the net folds, every triangle's shape ends up pointing at the apex, and triangles on "
                       "opposite sides of the square never share an edge. " + "; ".join(f"one option {r}" for r in reasons)
                       + ". The remaining pyramid is consistent with the net.")
        return prompt, options, ci, explanation
    raise RuntimeError("gen_pyramid failed")

def gen_nets(difficulty):
    # Favour 2026-06-11 (round 2): easy = pyramid nets (one less face to track),
    # medium = old easy cube nets, hard = old medium; old hard dropped.
    if difficulty == 1:
        return gen_pyramid()
    return gen_cube_net(difficulty - 1)

# ---------- assemble -------------------------------------------------------------

def sql_str(s): return "'" + s.replace("'", "''") + "'"

t0 = time.time()
rows = []
pos = 91
# 30 live: 10 per difficulty; codes 8, matrix 8, odd 7, nets 7
mix = [("codes", 1, 3), ("matrix", 1, 3), ("odd", 1, 2), ("nets", 1, 2),
       ("codes", 2, 3), ("matrix", 2, 3), ("odd", 2, 2), ("nets", 2, 2),
       ("codes", 3, 2), ("matrix", 3, 2), ("odd", 3, 3), ("nets", 3, 3)]
gens = {"codes": gen_codes, "matrix": gen_matrix, "odd": gen_odd, "nets": gen_nets}
generated = []
for fam, diff, n in mix:
    print(f"[gen] {fam} d{diff} x{n} ... ", end="", flush=True)
    for _ in range(n):
        generated.append((diff, fam, *gens[fam](diff)))
    print(f"ok ({time.time() - t0:.2f}s)", flush=True)
by_diff = {1: [], 2: [], 3: []}
for r in generated:
    by_diff[r[0]].append(r)
generated = []
for d in (1, 2, 3):
    rng.shuffle(by_diff[d])
    generated.extend(by_diff[d])
fam_at = {}
for diff, fam, prompt, options, ci, expl in generated:
    rows.append((pos, diff, prompt, options, ci, expl, False))
    fam_at[pos] = fam
    pos += 1
print("[gen] practice x2 ... ", end="", flush=True)
practice = [(107, 1, *gen_codes(1)), (108, 1, *gen_nets(2))]
print(f"ok ({time.time() - t0:.2f}s)", flush=True)

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
from collections import Counter
print("family mix:", Counter(fam_at.values()))

out = []
out.append("""-- 0053: nets ladder re-grade (round 7)
-- Per Favour: the old medium cube tier IS the right hard tier; medium stays
-- cubes but with simpler, bolder shapes (new solid triangle + dome symbols,
-- ring instead of thin flag / small wedge). Violation structure identical at
-- both levels (opposites + 180-flip + off-net dud) - only shape complexity
-- separates medium from hard. Confusable-shape guard keeps lookalike duds
-- (dome vs half-circle, triangle vs arrow) out of the options.
--
-- (superseded header below, kept for context)
-- 0052: pyramid chirality fix (round 6)
-- Favour spot-checked #94 and flagged it. The marked answer was a MIRROR
-- IMAGE pyramid: unfolding a paint-outside pyramid into a paint-up net flips
-- it apex-down, which reverses the net's cyclic order - so legal (left,right)
-- view pairs are the CLOCKWISE net neighbours, the exact opposite of what
-- rounds 5 generated. Pair rule fixed + numeric self-check added at import.
-- Cubes unaffected (fold-sim guarded). Same full-replace pattern as 0050/51.
--
-- (superseded header below, kept for context)
-- 0051: nonverbal difficulty tune (round 5)
-- Per Favour 2026-06-11 (round 2): easy nets become square-based pyramid nets
-- (one less face to track), medium nets = old easy cubes, hard nets = old
-- medium cubes (the old hard tier invited screenshot-the-question-into-an-LLM
-- behaviour); code questions shift one notch easier (easy = 2 letters with no
-- red herrings, medium = old easy, hard = old medium; a 1-letter code is
-- degenerate). Matrix and odd-one-out unchanged. Same replace pattern as 0050.
--
-- Replaces the 0049 nonverbal set after Favour's review (2026-06-11): too
-- easy, Set A/B felt off. New families modelled on his 11+ NVR source PDFs:
-- letter codes, 3x3 matrix completion, odd-one-out (reflection among
-- rotations), nets & cubes (dud / opposites / orientation violations).
-- Difficulty = 2/3/4 simultaneous rules for easy/medium/hard + red herrings.
-- 30 live at positions 91-120 (10/10/10) + 2 practice at 107-108.
-- Answers computed from generating rules; code questions verified uniquely
-- deducible by hypothesis search; nets options verified against the full
-- 24-orientation legality set (scripts/generate_nvr_questions.py, fixed seed).
-- The 0049 retire list (44,46,...,90) and category constraint stay as applied.

with t as (select id from public.tests where event_id = '""" + EVENT_ID + """' limit 1)
update public.test_questions q set active = false
from t where q.test_id = t.id and q.category = 'nonverbal';

with t as (select id from public.tests where event_id = '""" + EVENT_ID + """' limit 1)
delete from public.test_questions q
where q.test_id = (select id from t) and q.category = 'nonverbal'
  and not exists (select 1 from public.test_answers a where a.question_id = q.id);
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
with open("supabase/migrations/0053_nets_simplify.sql", "w", encoding="utf-8") as f:
    f.write(sql)
print(f"wrote migration: {len(sql)//1024} KB, {len(rows)} live rows + {len(practice)} practice")
