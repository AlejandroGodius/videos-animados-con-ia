# Picture timeline of "El galeon San Jose" (1708) mirrored read-only from src/videos/galeon/story.ts + cast.ts, so every
# sound lands on its frame. 30 fps, 1260 frames = 42.000 s, hard cuts only (a white 4-frame flash at frame 125).
# All event times are in seconds of the final video; voice.wav starts at 0.
import json
import numpy as np

FPS = 30
TOTAL = 1260
DUR = TOTAL / FPS            # 42.0 s exactly
fr = lambda f: f / FPS
LEAD = 1 / FPS               # hard impacts land 1 frame before the picture event

# id: (first frame, end frame, place)
SHOTS = {
    1: (0, 125, "under"), 2: (125, 218, "under"), 3: (218, 355, "sea"), 4: (355, 446, "sea"), 5: (446, 495, "battle"),
    6: (495, 568, "battle"), 7: (568, 661, "dusk"), 8: (661, 757, "day/under"), 9: (757, 899, "day/deep"),
    10: (899, 1010, "dock"), 11: (1010, TOTAL, "dock/under"),
}


def shot_t(i):
    a, b = SHOTS[i][:2]
    return fr(a), fr(b)


# ---------------- shots 1-2: underwater hook
FLASH = fr(125)                                   # white flash, cut to the wide of the wreck

# ---------------- shots 3-4: open sea, golden
SEA0 = fr(218)                                    # cut to the surface: the galleon under full sail
CAPTAIN = fr(259)                                 # cut to the proud Spanish captain (story.ts key at 0.3 of shot 3)
ENGLISH = fr(355)                                 # three English warships beside the island (far)
ENG_CAPTAIN = fr(408)                             # cut to the English captain with his spyglass (key at 0.58 of shot 4)

# ---------------- shot 5: "Canonazo va, canonazo viene"
BATTLE0 = fr(446)
KICKS5 = [fr(f) for f in (446, 456, 468, 481)]
GUNS_ES = [fr(446 + 1.5 * j) for j in range(4)]  # the galleon's broadside (muzzle flash at local lj = 0)
# NOTE: the brief puts the English reply on the 2nd "canonazo" (frame 468). cast.ts currently fires it at kickFrames[1]
# (frame 456). Change ENG_FIRE_FRAME to 456 if the picture keeps that.
ENG_FIRE_FRAME = 468
GUNS_EN = [fr(ENG_FIRE_FRAME + 1.5 * j) for j in range(4)]
BALL_F = 13                                       # ball flight in frames (cast.ts fu = lj / 13)
SPL_ES = [t + fr(BALL_F) for t in GUNS_ES]       # splashes near the English hull (459-477)
SPL_EN = [t + fr(BALL_F) for t in GUNS_EN]       # splashes near the galleon (481-499)

# ---------------- shot 6: the sinking (no explosion: creaks, groans, rushing water, splashes)
SINK_SHOT = fr(495)
REPENTE = fr(500)                                 # kick on "de repente"
SINK0, SINK1 = SINK_SHOT + 0.2, SINK_SHOT + 2.2   # galleonPose: u = (t - 0.2) / 2.0
JUMPS = [SINK_SHOT + 0.3 + k * 0.28 for k in range(4)]   # cast.ts round 3: 4 sailors jump from the quarterdeck
SAILOR_SPLASH = [t + 0.9 for t in JUMPS]          # frames ~531-556
HULL_SPLASH = [fr(527), fr(536), fr(547)]         # the bow goes under (one splash crown from local 1.0 s); the big one right after "hundio" (545)
HUNDIO = 18.18                                    # "hundio." 18.18-18.44 (words.json)
DUSK = fr(568)

# ---------------- shot 7: dusk, rowboat (bob sin(1.6 t), rock sin(1.2 t))
BOAT_CREAKS = [DUSK + (np.pi / 2 + k * np.pi) / 1.6 for k in range(2)]   # bob extremes 19.92, 21.89

# ---------------- shot 8: searchers over the years -> helmet diver
SEARCH0 = fr(661)
UNDER8 = fr(705)                                  # cut under water (key at 0.46 of shot 8)
SHRUG = fr(731)                                   # shrug pose from local frame 70

# ---------------- shot 9: support ship -> the ROV in the dark at 600 m
SUP0 = fr(757)
DEEP9 = fr(823)                                   # cut to the deep (key at 0.465 of shot 9); lamps on
ROV0, ROV1 = SUP0 + 2.2, SUP0 + 4.6               # rovPos: u = (t - 2.2) / 2.4

# ---------------- shots 10-11: tug-of-war on the dock, then the camera sinks to the wreck
DOCK0 = fr(899)
SHOT11 = fr(1010)
TUG_END = fr(1085)                                # the camera starts gliding down off the dock (key at 0.3 of shot 11)
GLIDE0, GLIDE1 = fr(1085), fr(1105)
DIP = fr(1107)                                    # the lens goes under the water
SETTLE = fr(1155)                                 # lands on the lonely wreck
STINGS = {"Colombia": fr(916), "Espana": fr(941), "cazatesoros": fr(964)}


def tug_x(t):
    """chest x offset (m) at video time t (cast.ts tugChest, continuous over shots 10-11)"""
    T = np.asarray(t) - DOCK0
    return 0.16 * np.sin(2.3 * T) + 0.06 * np.sin(5.7 * T + 1)


def tug_v(t):
    T = np.asarray(t) - DOCK0
    return 0.368 * np.cos(2.3 * T) + 0.342 * np.cos(5.7 * T + 1)


def tug_reversals(t0=DOCK0, t1=GLIDE1, merge=0.08):
    """moments the chest stops and jerks the other way: (t, +1 toward the Spanish side / -1 toward the Colombian side)"""
    t = np.arange(t0, t1, 0.001)
    v = tug_v(t)
    idx = np.flatnonzero(np.diff(np.sign(v)) != 0)
    out = []
    for i in idx:
        tm, d = float(t[i]), (1 if v[i + 1] > 0 else -1)
        if out and tm - out[-1][0] < merge:     # a tiny wiggle: keep the first jerk only
            out.pop()
            continue
        out.append((tm, d))
    return out


def under_at(t):
    """True where the picture is under water"""
    return (t < SEA0) or (UNDER8 <= t < SUP0) or (DEEP9 <= t < DOCK0) or (t >= DIP)


def words(path):
    """words.json -> list of dicts with 's' / 'e' (seconds) + 'w'"""
    raw = json.load(open(path, encoding="utf-8"))
    return [dict(w=x["word"], s=float(x["start"]), e=float(x["end"])) for x in raw]
