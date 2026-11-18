# Original score for "El galeon San Jose", composed and synthesized here (D minor / D major), following the picture:
# deep mystery under water (3/4 harp pulse, music-box "treasure" motif, A7 half cadence) | proud 6/8 sea theme on fife +
# horn from the cut to the surface, the captain on the bar line | the theme turns minor when the English appear |
# percussive battle hits on the broadsides | lament bass under the sinking | sad fife at dusk | ticking time-lapse,
# searching pizzicato, a comedic "plink-plonk" shrug | the motif returns in the deep as the light finds the wreck |
# plucky comedic tug-of-war (75 bpm, stings on Colombia / Espana / cazatesoros) | harp glissando down into the water |
# soft mysterious ending Bb - C - D (a gentle major resolve after the last word).
# The melodies are new; only general idioms are used (6/8 lilt, lament bass, bVI-bVII-I cadence).
import numpy as np
from dsp import SR, TAU, ns, tt, rng, pan, place, fades, dbg, make_ir, convolve_st, integrated, lp, hp, bp, modal, phase
import instruments as I
import timeline as T

N = ns(T.DUR)
F = I.m2f

# where each section of the music sits (used for the cue sheet and the level automation in mix.py)
SECTIONS = [
    ("deep", 0.0, T.SEA0), ("sail", T.SEA0, 11.75), ("threat", 11.75, T.BATTLE0 - 0.05), ("battle", T.BATTLE0 - 0.05, T.REPENTE - 0.05),
    ("sink", T.REPENTE - 0.05, T.DUSK), ("sad", T.DUSK, T.SEARCH0), ("search", T.SEARCH0, T.SUP0), ("find", T.SUP0, T.DOCK0),
    ("dock", T.DOCK0, T.SHOT11), ("dock2", T.SHOT11, T.DIP - 0.05), ("end", T.DIP - 0.05, T.DUR),
]


class Band:
    def __init__(self):
        self.tr = {}
        self.send = {}
        self.cues = []

    def track(self, name, send):
        if name not in self.tr:
            self.tr[name] = np.zeros((2, N))
            self.send[name] = send
        return self.tr[name]

    def add(self, name, x, t, p=0.0, g=1.0):
        buf = self.track(name, 0.15)
        place(buf, pan(x, p) if np.ndim(x) == 1 else x, t, g)


R = rng(1708)


def _r():
    return rng(int(R.integers(1 << 30)))


# ================================================================ extra instruments (own synthesis)
def bdrum(vel=0.8, r=None, dur=1.2):
    """orchestral bass drum: low skin sweep + felt thump"""
    r = r or rng(0)
    t = tt(dur)
    y = np.sin(phase(52 * (1 + 0.5 * np.exp(-t / 0.03)))) * np.exp(-t / 0.35)
    y += lp(r.standard_normal(len(t)), 300, 2) * np.exp(-t / 0.02) * 0.8
    return fades(y * vel, 0.001, 0.1)


def castanet(r, vel=0.6):
    t = tt(0.08)
    y = modal(0.08, [(r.uniform(1900, 2300), 1.0, 0.01), (r.uniform(3300, 3800), 0.6, 0.006), (5200, 0.3, 0.004)], r)
    y += bp(r.standard_normal(len(t)), 1500, 8000, 1) * np.exp(-t / 0.002) * 0.6
    return y * vel


def rev_cymbal(vel, r, dur):
    """reversed cymbal swell that peaks at its end"""
    x = I.cymbal(1.0, r, dur + 0.3)[::-1][-ns(dur):]
    return fades(x * vel, 0.05, 0.004)


# ================================================================ helpers
def pad(b, t0, t1, ms, vel=0.5, att=0.4, rel=0.7, warm=900.0, p=0.0, track="pad"):
    b.add(track, I.pad([F(m) for m in ms], t1 - t0, vel, _r(), att=att, rel=rel, warm=warm), t0, p)


def harp(b, t, m, vel=0.5, dur=1.2, bright=0.3, p=-0.1, track="harp"):
    b.add(track, I.pluck(F(m), vel * R.uniform(0.94, 1.04), _r(), dur=dur, bright=bright), t, p)


def chord_pizz(b, t, ms, vel=0.35, dur=0.35, p=0.25, spread=0.004):
    for k, m in enumerate(ms):
        b.add("pizz", I.pluck(F(m), vel * R.uniform(0.92, 1.05), _r(), dur=dur, bright=0.55), t + k * spread, p - 0.1 * k)


def tuba(b, t, m, dur=0.3, vel=0.6, kind="tuba", scoop=-22.0):
    b.add("tuba", I.brass(F(m), dur, vel * R.uniform(0.95, 1.03), _r(), kind, scoop=scoop), t, -0.1)


def stab(b, t, ms, vel=0.8, dur=0.22):
    for m in ms:
        trk = "tuba" if m < 42 else "stab"
        b.add(trk, I.brass(F(m), dur + (0.1 if m < 42 else 0), vel, _r(), "tuba" if m < 42 else "stab", scoop=-14), t, (m - 56) / 26)


def timp_roll(b, t0, t1, m, v0, v1, rate=14.0):
    k = 0
    t = t0
    while t < t1:
        u_ = (t - t0) / max(t1 - t0, 1e-6)
        b.add("timpani", I.timpani(F(m), (v0 + (v1 - v0) * u_ ** 1.4) * (0.9 + 0.1 * (k % 2)), _r(), dur=0.9), t, -0.1)
        t += 1 / rate
        k += 1


def roll(b, t0, t1, v0, v1, accent=None, at=None):
    for t, v in I.snare_roll(t0, t1, v0, v1, _r()):
        b.add("snare", I.snare(v, _r(), dur=0.14, buzz=True), t, 0.05)
    if accent:
        at = t1 if at is None else at
        b.add("snare", I.snare(accent, _r()), at, 0.05)


def melody(b, track, notes, vel, fn, p=0.0, gate=0.92):
    """notes = [(t, dur, midi)]"""
    for (t, d, m) in notes:
        v = vel * R.uniform(0.94, 1.04)
        if fn == "fife":
            x = I.fife(F(m), d * gate, v, _r())
        elif fn == "horn":
            x = I.brass(F(m), d * gate, v, _r(), "horn", scoop=-16)
        elif fn == "soft":
            x = I.brass(F(m), d * gate, v, _r(), "soft", scoop=-10)
        elif fn == "glock":
            x = I.glock(F(m), v, _r())
        elif fn == "vibes":
            x = I.vibes(F(m), v, _r(), dur=max(1.2, d + 0.8), damp=d + 0.4, trem_depth=0.18)
        elif fn == "musicbox":
            x = I.musicbox(F(m), v, _r())
        elif fn == "pluck":
            x = I.pluck(F(m), v, _r(), dur=max(0.4, d), bright=0.7)
        b.add(track, x, t, p)


# ================================================================ the score
def build():
    b = Band()
    for name, send in [("pad", 0.28), ("harp", 0.22), ("pizz", 0.18), ("tuba", 0.10), ("horn", 0.18), ("stab", 0.16), ("fife", 0.18),
                       ("glock", 0.24), ("vibes", 0.28), ("musicbox", 0.3), ("snare", 0.13), ("cymbal", 0.16), ("timpani", 0.2),
                       ("bdrum", 0.15), ("triangle", 0.25), ("brush", 0.12), ("cast", 0.12)]:
        b.track(name, send)

    # ============ DEEP 0 - 7.267: under water. 3/4, q = 0.694 (6 beats to the flash), then q = 0.775 to the surface cut
    q1 = T.FLASH / 6
    pad(b, 0.0, 3 * q1, [50, 57, 64, 65], 0.5, att=1.0, rel=0.6, warm=800)            # Dm9
    pad(b, 3 * q1, 6 * q1, [46, 53, 57, 62], 0.5, att=0.45, rel=0.6, warm=800)         # Bbmaj7
    for k in range(6):
        root = 38 if k < 3 else 34
        harp(b, k * q1, [root, root + 7, root + 12][k % 3], 0.55 if k % 3 == 0 else 0.42, 1.4)
    motif = [(1.0, 0.5, 69), (1.5, 0.5, 74), (2.0, 1.0, 76), (3.0, 1.5, 77), (4.5, 0.5, 76), (5.0, 1.0, 72)]
    melody(b, "musicbox", [(0.08 + bt * q1, d * q1, m) for bt, d, m in motif], 0.55, "musicbox", 0.2)
    melody(b, "vibes", [(0.08 + bt * q1, d * q1, m - 12) for bt, d, m in motif], 0.22, "vibes", -0.25)
    b.cues.append((0.0, "DEEP: Dm9 - Bbmaj7 pad, harp pulse in 3/4, music-box 'treasure' motif A-D-E-F-E-C (D Dorian/Lydian colour)"))
    b.add("cymbal", rev_cymbal(0.35, _r(), 1.1), T.FLASH - 1.1, 0.0)
    timp_roll(b, 3.35, T.FLASH - 0.03, 38, 0.08, 0.35)
    for m in [43, 50, 58]:
        b.add("horn", I.brass(F(m), 1.3, 0.36, _r(), "soft", scoop=-8), T.FLASH, (m - 50) / 30)
    b.add("timpani", I.timpani(F(43), 0.5, _r()), T.FLASH, -0.1)
    b.cues.append((T.FLASH, "reveal on the white flash: reverse-cymbal swell + timpani roll into a soft low-brass Gm chord (wreck wide)"))
    q2 = (T.SEA0 - T.FLASH) / 4
    pad(b, T.FLASH, T.FLASH + 2 * q2, [43, 50, 52, 58], 0.5, att=0.25, rel=0.5, warm=800)       # Gm6
    pad(b, T.FLASH + 2 * q2, T.FLASH + 3 * q2, [45, 52, 55, 62], 0.5, att=0.2, rel=0.4, warm=850)  # A7sus4
    pad(b, T.FLASH + 3 * q2, T.SEA0 + 0.05, [45, 52, 55, 61], 0.55, att=0.15, rel=0.3, warm=900)  # A7
    for k, m in enumerate([43, 50, 43, 50, 45, 52, 45, 52]):
        harp(b, T.FLASH + k * q2 / 2, m, 0.5 if k % 2 == 0 else 0.38, 1.1)
    ans = [(0.5, 0.5, 67), (1.0, 0.5, 70), (1.5, 0.5, 74), (2.0, 1.0, 76), (3.0, 0.9, 73)]
    melody(b, "vibes", [(T.FLASH + bt * q2, d * q2, m) for bt, d, m in ans], 0.42, "vibes", -0.2)
    timp_roll(b, 7.0, T.SEA0 - 0.03, 45, 0.15, 0.45, rate=16)       # quick fill in the gap after "del mar."
    roll(b, 7.03, T.SEA0 - 0.02, 0.15, 0.45)
    b.cues.append((T.FLASH, "wide of the wreck: Gm6 - A7sus4 - A7 (half cadence), vibes answer G-Bb-D-E-C#, quick timpani + snare fill after 'del mar.' into the surface"))

    # ============ SAIL 7.267 - 11.75: proud 6/8 sea theme (D major); e = eighth, bar line on the captain (8.633)
    e = (T.BATTLE0 - T.CAPTAIN) / 24
    t0 = T.SEA0
    for m in [50, 54, 57, 62]:
        b.add("horn", I.brass(F(m), 1.15, 0.62, _r(), "soft", scoop=-10), t0, (m - 56) / 24)
    tuba(b, t0, 38, 0.55, 0.7)
    b.add("timpani", I.timpani(F(38), 0.75, _r()), t0, -0.1)
    b.add("cymbal", I.cymbal(0.3, _r(), dur=2.0), t0, 0.0)
    b.add("glock", I.glock(F(86), 0.45, _r()), t0, 0.3)
    pad(b, t0, T.CAPTAIN, [50, 57, 62, 66], 0.42, att=0.12, rel=0.4)
    pick = [(T.CAPTAIN - 3 * e, e, 69), (T.CAPTAIN - 2 * e, e, 71), (T.CAPTAIN - e, e, 73)]
    theme = [(0, 3, 74), (3, 1, 76), (4, 1, 78), (5, 1, 79), (6, 2, 81), (8, 1, 83), (9, 2, 81), (11, 1, 78)]
    th = pick + [(T.CAPTAIN + a * e, d * e, m) for a, d, m in theme]
    melody(b, "fife", th, 0.6, "fife", 0.25)
    melody(b, "horn", [(t, d, m - 12) for t, d, m in th], 0.5, "horn", -0.2)
    b.cues.append((T.SEA0, "SURFACE: D major arrival on the cut (soft brass, timpani, cymbal, glock), 3-note pickup A-B-C# into the theme"))
    b.cues.append((T.CAPTAIN, "proud 6/8 sea theme on fife + horn, bar line on the captain: D . . E F# G | A . B A . F#"))
    bars = [(T.CAPTAIN, [(38, [62, 66, 69])], [(45, None)]), (T.CAPTAIN + 6 * e, [(43, [62, 67, 71])], [(45, [61, 64, 69])])]
    for tb, first, second in bars:
        (r1, c1), (r2, c2) = first[0], second[0]
        c2 = c2 or c1
        tuba(b, tb, r1, 0.3, 0.62)
        tuba(b, tb + 3 * e, r2, 0.3, 0.55)
        for k, c in ((1, c1), (2, c1), (4, c2), (5, c2)):
            chord_pizz(b, tb + k * e, c, 0.32 if k in (1, 4) else 0.26)
        for k, v in ((0, 0.42), (2, 0.2), (3, 0.34), (5, 0.2)):
            b.add("snare", I.snare(v, _r()), tb + k * e, 0.05)
    b.add("cymbal", I.cymbal(0.25, _r(), dur=1.5), T.CAPTAIN, 0.0)
    b.add("triangle", I.triangle(0.3, _r()), T.CAPTAIN + 6 * e, 0.35)

    # ============ THREAT 11.75 - 14.867: the theme turns minor in the low brass; drums gather
    t3 = T.CAPTAIN + 12 * e
    low = [(0, 3, 50), (3, 1, 52), (4, 1, 53), (5, 1, 55), (6, 2, 57), (8, 1, 58), (9, 2, 57), (11, 1, 52)]
    melody(b, "horn", [(t3 + a * e, d * e, m) for a, d, m in low], 0.62, "horn", -0.15)
    pad(b, t3, t3 + 6 * e, [50, 53, 57], 0.45, att=0.2, rel=0.3, warm=650)
    pad(b, t3 + 6 * e, t3 + 9 * e, [50, 53, 58], 0.45, att=0.1, rel=0.2, warm=650)
    pad(b, t3 + 9 * e, T.BATTLE0, [49, 52, 57], 0.5, att=0.1, rel=0.15, warm=700)
    for bar in range(2):
        tb = t3 + bar * 6 * e
        tuba(b, tb, 38 if bar == 0 else 34, 0.28, 0.6)
        tuba(b, tb + 3 * e, 38 if bar == 0 else 33, 0.28, 0.55)
        for k, v in ((0, 0.34), (2, 0.18), (3, 0.3), (5, 0.18)):
            b.add("snare", I.snare(v, _r()), tb + k * e, 0.05)
    b.add("timpani", I.timpani(F(38), 0.55, _r()), t3, -0.1)
    timp_roll(b, 13.95, T.BATTLE0 - 0.03, 45, 0.1, 0.55)
    roll(b, 14.2, T.BATTLE0 - 0.02, 0.12, 0.7)
    b.cues.append((t3, "ENGLISH SHIPS: the same theme in D minor on low horn (D . . E F G | A . Bb A . E), dark pad, timpani + snare roll gathering"))

    # ============ BATTLE 14.867 - 16.667: hits on the broadsides, 6/8 snare drive
    hit = lambda t, ms, v, tm, bd=True, cym=0.0: (stab(b, t - 0.01, ms, v), b.add("timpani", I.timpani(F(tm), v, _r()), t - 0.01, -0.1),
                                                 bd and b.add("bdrum", bdrum(v, _r()), t - 0.01, 0.0),
                                                 cym and b.add("cymbal", I.cymbal(cym, _r(), dur=1.8), t - 0.01, 0.0))
    hit(T.GUNS_ES[0], [38, 50, 57, 62, 65], 0.85, 38, True, 0.5)
    hit(T.KICKS5[1], [45], 0.55, 45, True)
    hit(T.GUNS_EN[0], [34, 46, 53, 58, 62], 0.66, 46, True, 0.3)
    hit(T.KICKS5[3], [33, 45, 52, 57, 61], 0.55, 45, True)
    eb = (T.GUNS_EN[0] - T.GUNS_ES[0]) / 3
    t = T.GUNS_ES[0] + eb
    k = 1
    while t < 16.05:
        b.add("snare", I.snare((0.42 if k % 3 == 0 else 0.26) * (1 + 0.3 * (t - 14.9)), _r()), t, 0.05)
        t += eb
        k += 1
    roll(b, 16.1, T.REPENTE - 0.02, 0.2, 0.6)
    pad(b, 16.1, T.REPENTE, [57, 61, 64], 0.45, att=0.5, rel=0.05, warm=1200)
    hit(T.REPENTE, [38, 53, 58, 61], 0.95, 38, True, 0.6)
    b.cues.append((T.GUNS_ES[0], "BATTLE: Dm brass stab + timpani + bass drum + cymbal on the galleon's broadside; timpani on kick 456"))
    b.cues.append((T.GUNS_EN[0], "Bb stab on the English reply, A stab on the splashes (kick 481), 6/8 snare drive"))
    b.cues.append((T.REPENTE, "'de repente': snare roll + rising pad into a dark Bbm/D tutti stab (kick 500)"))

    # ============ SINK 16.667 - 18.933: lament bass D - C# - C - B - Bb - A, falling vibes
    steps = [16.75, 17.12, 17.49, 17.86, 18.23, 18.6]
    bass = [50, 49, 48, 47, 46, 45]
    ups = [[53, 57, 62], [52, 57, 61], [53, 57, 62], [53, 56, 62], [53, 58, 62], [52, 57, 61]]
    for i, (ts, bm, up) in enumerate(zip(steps, bass, ups)):
        te = steps[i + 1] if i + 1 < len(steps) else T.DUSK + 0.05
        pad(b, ts, te, [bm] + up, 0.5, att=0.12 if i else 0.25, rel=0.3, warm=750)
        tuba(b, ts, bm - 12, te - ts - 0.03, 0.42, "soft", scoop=-6)
    melody(b, "vibes", [(17.0, 0.37, 81), (17.37, 0.37, 77), (17.74, 0.6, 74), (18.48, 0.6, 69)], 0.45, "vibes", 0.25)
    timp_roll(b, 16.9, 17.95, 38, 0.06, 0.3, rate=12)
    b.add("timpani", I.timpani(F(45), 0.5, _r()), 18.57, -0.1)
    b.cues.append((16.75, "SINKING: chromatic lament bass D-C#-C-B-Bb-A (pad + soft tuba), vibes falling A-F-D ... A (clear of 'se hundio'), soft timpani roll"))

    # ============ SAD 18.933 - 22.033: dusk, rowboat. Dm - Bb - Gm - Asus4/A, harp arpeggios, lonely fife
    q = (T.SEARCH0 - T.DUSK) / 4
    chords = [([50, 57, 62, 65], [38, 45, 50, 53]), ([46, 53, 58, 62], [34, 41, 46, 50]), ([43, 50, 58, 62], [43, 50, 55, 58]),
              ([45, 52, 57, 62], [45, 52, 57, 61])]
    for i, (pc, arp) in enumerate(chords):
        ts = T.DUSK + i * q
        if i < 3:
            pad(b, ts, ts + q, pc, 0.42, att=0.3 if i == 0 else 0.2, rel=0.5, warm=750)
        else:
            pad(b, ts, ts + q / 2, pc, 0.42, att=0.2, rel=0.25, warm=750)
            pad(b, ts + q / 2, ts + q + 0.05, [45, 52, 57, 61], 0.42, att=0.1, rel=0.3, warm=750)
        for k, m in enumerate(arp):
            harp(b, ts + k * q / 4, m, 0.42 if k == 0 else 0.3, 1.3)
    sad = [(T.DUSK + q / 2, q / 2, 69), (T.DUSK + q, q, 77), (T.DUSK + 2 * q, q / 2, 76), (T.DUSK + 2.5 * q, q / 2, 74), (T.DUSK + 3 * q, q * 0.95, 73)]
    melody(b, "fife", sad, 0.36, "fife", 0.2)
    b.cues.append((T.DUSK, "DUSK: Dm - Bb - Gm - Asus4/A, harp arpeggios, a lonely fife A - F - E D - C# (sad, under the voice)"))

    # ============ SEARCH 22.033 - 25.233: time-lapse ticking, then searching under water, the shrug
    es = (T.UNDER8 - T.SEARCH0) / 4
    pad(b, T.SEARCH0, T.SEARCH0 + 2 * es, [50, 57, 64, 65], 0.38, att=0.2, rel=0.3, warm=800)
    pad(b, T.SEARCH0 + 2 * es, T.UNDER8, [46, 53, 57, 62], 0.38, att=0.15, rel=0.2, warm=800)
    k = 0
    t = T.SEARCH0
    while t < T.UNDER8 - 0.02:
        b.add("glock", I.glock(F(81 if k % 2 == 0 else 88), 0.2 if k % 2 == 0 else 0.14, _r(), dur=0.5), t, 0.3 if k % 2 else -0.3)
        if k % 2 == 0:
            harp(b, t, [38, 45][(k // 2) % 2] if t < T.SEARCH0 + 2 * es else [34, 41][(k // 2) % 2], 0.45, 0.8)
        t += es / 2
        k += 1
    b.cues.append((T.SEARCH0, "TIME-LAPSE: glock ticking in 16ths (A5/E6 'clock'), harp pulse, Dm9 - Bbmaj7"))
    pad(b, T.UNDER8, T.SHRUG, [50, 55, 58, 64], 0.38, att=0.08, rel=0.15, warm=650)
    for k, m in enumerate([50, 53, 52]):
        b.add("pizz", I.pluck(F(m), 0.45, _r(), dur=0.6, bright=0.4), T.UNDER8 + k * es, -0.15)
    melody(b, "vibes", [(23.6, 0.37, 69), (23.97, 0.18, 74), (24.15, 0.3, 76)], 0.4, "vibes", 0.2)
    b.add("pizz", I.pluck(F(57), 0.6, _r(), dur=0.5, bright=0.6), T.SHRUG - 0.04, 0.1)
    b.add("pizz", I.pluck(F(50), 0.6, _r(), dur=0.7, bright=0.5), T.SHRUG + 0.12, -0.1)
    pad(b, 24.47, T.SUP0 + 0.05, [46, 53, 57, 62], 0.32, att=0.3, rel=0.3, warm=700)
    b.cues.append((T.UNDER8, "UNDER WATER: dark Gm/D pad, searching pizzicato D-F-E, vibes A-D-E (a question)"))
    b.cues.append((T.SHRUG, "the shrug: everything stops, comedic pizzicato 'plink-plonk' A3 -> D3 (with the bubble 'bloops')"))

    # ============ FIND 25.233 - 29.967: modern ship pulse, then the deep: the motif returns as the light finds the wreck
    ef = (T.DEEP9 - T.SUP0) / 8
    pad(b, T.SUP0, T.SUP0 + 4 * ef, [50, 57, 64, 65], 0.38, att=0.12, rel=0.3, warm=850)
    pad(b, T.SUP0 + 4 * ef, T.DEEP9, [46, 53, 57, 62], 0.4, att=0.1, rel=0.15, warm=850)
    for k in range(8):
        m = [50, 57, 53, 57][k % 4] if k < 4 else [46, 53, 50, 53][k % 4]
        b.add("pizz", I.pluck(F(m), 0.42 if k % 2 == 0 else 0.32, _r(), dur=0.5, bright=0.45), T.SUP0 + k * ef, -0.15 + 0.1 * (k % 2))
        b.add("brush", I.brush(0.4 if k % 2 else 0.25, _r()), T.SUP0 + k * ef, 0.15)
    b.cues.append((T.SUP0, "2015 support ship: steady pizzicato eighths + brushes, Dm9 - Bbmaj7"))
    pad(b, T.DEEP9, T.DOCK0, [38, 45], 0.42, att=0.08, rel=0.1, warm=380, track="pad")
    pad(b, 28.1, 28.96, [50, 57, 64, 65], 0.34, att=0.35, rel=0.2, warm=800)
    pad(b, 28.96, 29.5, [46, 53, 57, 62], 0.4, att=0.12, rel=0.15, warm=900)
    pad(b, 29.5, 29.75, [45, 52, 55, 62], 0.42, att=0.06, rel=0.1, warm=900)
    pad(b, 29.75, T.DOCK0 + 0.02, [45, 52, 55, 61], 0.45, att=0.04, rel=0.05, warm=1000)
    mot = [(28.14, 0.27, 69), (28.41, 0.28, 74), (28.69, 0.27, 76), (28.96, 0.54, 77), (29.5, 0.25, 76), (29.75, 0.2, 73)]
    melody(b, "musicbox", mot, 0.5, "musicbox", 0.2)
    melody(b, "vibes", [(t, d, m - 12) for t, d, m in mot], 0.22, "vibes", -0.2)
    for m, dt in ((81, 0.0), (86, 0.03), (89, 0.06)):
        b.add("glock", I.glock(F(m), 0.3, _r()), 28.96 + dt, 0.35)
    b.add("cymbal", rev_cymbal(0.22, _r(), 0.8), 28.96 - 0.8, 0.0)
    timp_roll(b, 29.45, T.DOCK0 - 0.03, 45, 0.06, 0.32)
    b.cues.append((T.DEEP9, "THE DEEP: low D-A drone; the treasure motif returns on music box + vibes on 'a 600 metros de profundidad'"))
    b.cues.append((28.96, "the light finds the wreck: glock sparkle A-D-F + soft reverse cymbal, Bbmaj7 -> A7sus4 -> A7 into the dock"))

    # ============ DOCK 29.967 - 36.167: comedic plucky tug-of-war, 75 bpm (beats on 30.50 / 31.30 / 32.10 = the stings)
    td = T.DOCK0
    chord_pizz(b, td, [50, 54, 57, 62], 0.5, 0.45, 0.0, 0.006)
    tuba(b, td, 38, 0.18, 0.62, scoop=-30)
    b.add("glock", I.glock(F(86), 0.4, _r()), td, 0.3)
    b.add("triangle", I.triangle(0.3, _r(), dur=0.8), td, 0.35)
    qd = 0.8
    beats = [T.STINGS["Colombia"] - 0.033 + qd * k for k in range(8)]     # 30.50 ... 36.10
    harm = ["D", "A7", "D", "A7", "Dm", "A7", "Dm", "A7"]
    CHD = {"D": (38, 45, [62, 66, 69]), "A7": (33, 40, [61, 64, 67]), "Dm": (38, 45, [62, 65, 69])}
    chord_pizz(b, td + 0.133, [57], 0.3, 0.3, 0.2)
    for i, (tb, h) in enumerate(zip(beats, harm)):
        lo, hi_, ch = CHD[h]
        soft = 0.92 if tb > T.SHOT11 else 1.0
        tuba(b, tb, lo if i % 2 == 0 else hi_ - 12 + 12, 0.17, 0.62 * soft, scoop=-30)
        chord_pizz(b, tb + qd / 2, ch, 0.34 * soft, 0.3)
        if tb + qd * 0.75 < T.GLIDE0:
            b.add("pizz", I.pluck(F(ch[0] - 12), 0.22 * soft, _r(), dur=0.25, bright=0.5), tb + qd * 0.75, -0.2)
    # stings
    for k, m in enumerate([74, 78, 81]):
        b.add("pizz", I.pluck(F(m), 0.55, _r(), dur=0.5, bright=0.8), beats[0] + k * 0.05, 0.25)
    b.add("glock", I.glock(F(93), 0.42, _r()), beats[0] + 0.1, 0.3)
    b.add("triangle", I.triangle(0.35, _r(), dur=1.0), beats[0] + 0.1, 0.4)
    for k in range(4):
        b.add("cast", castanet(_r(), 0.5 + 0.12 * k), beats[1] - 0.12 + k * 0.04, -0.3)
    for k, m in enumerate([57, 61, 64, 69]):
        b.add("pizz", I.pluck(F(m), 0.5, _r(), dur=0.6, bright=0.75), beats[1] + k * 0.015, -0.3 + 0.1 * k)
    b.add("pizz", I.pluck(F(70), 0.45, _r(), dur=0.2, bright=0.8), beats[1] + 0.16, -0.25)
    b.add("pizz", I.pluck(F(69), 0.5, _r(), dur=0.4, bright=0.8), beats[1] + 0.26, -0.25)
    for k, m in enumerate([50, 49, 48]):
        b.add("tuba", I.brass(F(m), 0.12, 0.55, _r(), "soft", scoop=-35), beats[2] + k * 0.15, 0.1)
        b.add("pizz", I.pluck(F(m - 12), 0.4, _r(), dur=0.3, bright=0.4), beats[2] + k * 0.15, 0.1)
    b.cues.append((td, "DOCK: comedic 'ta-da' (pizz D chord, tuba, glock, triangle), then a plucky 75 bpm tug: tuba on the beats, pizz on the offbeats"))
    b.cues.append((beats[0], "sting 'Colombia' (frame 916): bright pizz arpeggio D-F#-A + glock + triangle"))
    b.cues.append((beats[1], "sting 'Espana' (frame 941): castanet trill + strummed A chord + Bb-A grace"))
    b.cues.append((beats[2], "sting 'cazatesoros' (frame 964): sly chromatic tuba D-C#-C 'mwa-ha-ha'"))
    sneak = [(beats[4] + k * qd / 2, qd / 2, m) for k, m in enumerate([57, 58, 57, 56, 57, 58, 60, 61])]
    melody(b, "pizz", sneak, 0.45, "pluck", -0.05)
    pad(b, beats[5], T.GLIDE0 + 0.2, [50, 53, 57], 0.38, att=0.6, rel=0.4, warm=700)
    b.cues.append((beats[4], "shot 11 ('nadie sabe con certeza'): the tug turns D minor, softer, a sneaky chromatic pizz line A-Bb-A-G#"))
    gl = [86, 85, 83, 81, 79, 78, 76, 74, 73, 71, 69, 67, 66, 64, 62]
    for k, m in enumerate(gl):
        b.add("harp", I.pluck(F(m), 0.42 - 0.012 * k, _r(), dur=0.9, bright=0.5), T.GLIDE0 + 0.02 + k * 0.045, 0.3 - 0.04 * k)
    b.cues.append((T.GLIDE0, "camera glides off the dock: harp glissando down D6 -> D4 into the water"))

    # ============ END 36.9 - 42.0: soft mysterious ending on the wreck, Bbmaj7 - C(add9) - D(add9) major resolve
    pad(b, T.DIP - 0.05, 38.15, [46, 53, 57, 62], 0.42, att=0.5, rel=0.5, warm=750)
    pad(b, 38.15, 39.48, [48, 55, 62, 64], 0.42, att=0.25, rel=0.4, warm=800)
    pad(b, 39.48, 41.2, [50, 57, 62, 64, 66], 0.45, att=0.3, rel=0.8, warm=850)
    harp(b, T.DIP - 0.05, 34, 0.5, 2.0)
    harp(b, 38.15, 36, 0.48, 2.0)
    harp(b, 39.48, 38, 0.52, 2.5)
    end_m = [(37.2, 0.35, 69), (37.55, 0.35, 74), (37.9, 0.35, 76), (38.25, 0.7, 77), (38.95, 0.35, 76), (39.3, 0.5, 74), (39.9, 1.5, 78)]
    melody(b, "musicbox", end_m, 0.45, "musicbox", 0.2)
    b.add("glock", I.glock(F(86), 0.3, _r(), dur=2.2), 39.9, 0.3)
    for k, m in enumerate([62, 66, 69, 74]):
        b.add("vibes", I.vibes(F(m), 0.32, _r(), dur=2.1, damp=None, trem_depth=0.15), 39.9 + 0.02 * k, -0.2 + 0.12 * k)
    b.add("triangle", I.triangle(0.18, _r(), dur=1.6), 39.92, 0.35)
    b.cues.append((T.DIP, "UNDER WATER, the lonely wreck: Bbmaj7 pad, the treasure motif on music box (callback to the opening)"))
    b.cues.append((38.15, "C(add9): the motif leans on E"))
    b.cues.append((39.9, "after 'todos' (39.84): gentle resolve on D major (add9) - music box F#, glock D, vibes chord, triangle; fades out by 42.0"))
    end = np.ones(N)
    a = ns(40.6)
    end[a:] = np.linspace(1, 0, N - a) ** 1.5
    for k in b.tr:
        b.tr[k] *= end[None, :]
    return b


TARGET = {  # relative balance inside the band (LU, measured on each track's own active span)
    "pad": -3.0, "harp": -5.0, "pizz": -5.0, "tuba": -4.0, "horn": -3.0, "stab": -1.5, "fife": -2.0, "glock": -9.0, "vibes": -4.0,
    "musicbox": -3.0, "snare": -8.0, "cymbal": -12.0, "timpani": -4.0, "bdrum": -6.0, "triangle": -16.0, "brush": -16.0, "cast": -10.0,
}


def render(b, ref=-20.0):
    hall = make_ir(1.8, 7, pre=0.02, hf=1.4)
    dry = np.zeros((2, N))
    wet = np.zeros((2, N))
    levels = {}
    for k, x in b.tr.items():
        if not np.any(x):
            continue
        L = integrated(x)
        g = dbg(ref + TARGET.get(k, -6) - L)
        levels[k] = (round(L, 1), round(ref + TARGET.get(k, -6), 1))
        x = x * g
        b.tr[k] = x
        dry += x
        wet += b.send[k] * x
    out = dry + 0.75 * convolve_st(wet.mean(0), hall)
    out = hp(out, 30, 2)
    return out, levels


if __name__ == "__main__":
    import time
    t0 = time.time()
    b = build()
    print(f"built in {time.time() - t0:.1f} s")
    out, lv = render(b)
    print(f"rendered in {time.time() - t0:.1f} s, I {integrated(out):.1f}, peak {20 * np.log10(np.abs(out).max()):.1f}")
    for k, v in lv.items():
        print(k, v)
