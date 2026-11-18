# Every sound effect + ambience bed of "El galeon San Jose" as a cue list timed to the picture (timeline.py), rendered
# into one stereo SFX stem. Same conventions as the bridge template: each EVENT has a "naive" level (LU relative to the
# voice stem, measured as the event's max momentary loudness) and is placed SFX_DB = -6 dB under it; ambience BEDS
# (integrated loudness) are not reduced. Two reverb buses: "air" (open sea / dock, short and sparse) and "water"
# (under water, dark and long); each bus return is gated to the shots of its own place so the hard cuts stay hard.
# Under water everything is low-passed (muffled); the surface is open (waves, wind in the sails, flags, gulls).
# The sinking has NO explosion (the cause is disputed): only creaks, groans, rushing water and splashes.
import numpy as np
from dsp import (SR, TAU, ns, tt, rng, dbg, lp, hp, bp, peq, reson, resbank, pan, st, place, fades, widen, make_ir,
                 convolve_st, momentary_max, integrated, colored, smooth_noise, shape, phase, modal)
import sfx_gen as G
import timeline as T

N = ns(T.DUR)
SFX_DB = -6.0
ROPE = [(380, 6, 1.0), (820, 8, 0.7), (1500, 9, 0.4), (2600, 10, 0.2)]


class Cue:
    def __init__(self, t, name, desc, gen, naive, kind="event", p=0.0, extra=0.0, lpf=None, send=0.1, bus="air", cut=None,
                 group=None):
        self.t, self.name, self.desc, self.gen, self.naive = t, name, desc, gen, naive
        self.kind, self.p, self.extra, self.lpf, self.send, self.bus, self.cut = kind, p, extra, lpf, send, bus, cut
        self.group = group or name
        self.applied = naive + (SFX_DB if kind == "event" else 0.0) + extra
        self.measured = None


# ================================================================ small helpers
def u(x):
    """unit RMS"""
    return x / (np.sqrt(np.mean(np.asarray(x) ** 2)) + 1e-12)


def pan_move(x, p0, p1):
    """mono -> stereo with the pan gliding from p0 to p1 over the sound"""
    p = np.clip(np.linspace(p0, p1, len(x)), -1, 1)
    th = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(th), x * np.sin(th)]) * np.sqrt(2)


def gauss_band(fc_fn, width):
    """STFT gain: a log-frequency gaussian band whose centre follows fc_fn(frame times)"""
    return lambda Tm, F: np.exp(-0.5 * (np.log2(np.maximum(F[:, None], 20) / np.maximum(fc_fn(Tm), 30)[None, :]) / width) ** 2)


# ================================================================ water
def wave_wash(r, dur=3.6, size=1.0):
    """one sea wave rolling in and breaking: band rises with the swell, foam fizz after the break"""
    n = ns(dur)
    t = np.arange(n) / SR
    nz = colored(n, r, 0.5)
    rise, fall = r.uniform(0.7, 1.2), r.uniform(0.6, 1.1)
    env = np.where(t < rise, (t / rise) ** 2, np.exp(-(t - rise) / fall))
    pts = [0, rise, rise + 0.3, dur]
    y = shape(nz, gauss_band(lambda Tm: 300 + 900 * np.interp(Tm, pts, [0, 1, 0.8, 0.15]), 1.3), 1024, 256)
    fizz = hp(nz, 2500) * np.clip(env - 0.25, 0, 1) * 0.12
    return fades((y * env + fizz) * size, 0.05, 0.3)


def slosh(r, close=1.0, hollow=0.0):
    """one small wave lapping against a hull / pier: wet slap + a few bubbles (+ a hollow knock on wood)"""
    L = 0.6
    n = ns(L)
    t = np.arange(n) / SR
    fc = r.uniform(450, 950)
    y = shape(r.standard_normal(n), gauss_band(lambda Tm: fc * (1 + 0 * Tm), 1.1), 512, 128)
    y *= np.exp(-t / r.uniform(0.09, 0.16)) * (1 - np.exp(-t / 0.03))
    y = u(y) + 0.7 * u(G.bubbles(L, r, 90, 300, 1500, (0.005, 0.02), np.exp(-t / 0.15)) + 1e-9 * r.standard_normal(n))
    if hollow:
        y += hollow * 1.2 * u(modal(L, [(r.uniform(140, 210), 1.0, 0.05), (r.uniform(330, 470), 0.5, 0.03)], r)) * np.exp(-t / 0.06)
    return y * close


def lapping(dur, r, rate=1.0, close=1.0, hollow=0.0, width=0.7):
    n = ns(dur)
    out = np.zeros((2, n))
    tm = r.uniform(0.0, 0.4)
    while tm < dur - 0.15:
        place(out, pan(slosh(r, r.uniform(0.4, 1.0) * close, hollow), r.uniform(-width, width)), tm)
        tm += r.exponential(1 / rate) + 0.15
    return out


def sea_bed(dur, r, wind=1.0, waves=0.9, wave_gap=(2.0, 3.8), hull=0.0, flags=0.0, lap=0.0, lap_rate=1.0, sails=0.0,
            gust=0.18, curves=None):
    """open sea at the surface: wind, rolling waves, a ship's hull swishing through the water, sails, flags, lapping.
    curves = {component: (pts)} piecewise-linear gain automation in seconds from the bed start"""
    n = ns(dur)
    t = np.arange(n) / SR
    cv = lambda k: np.interp(t, [p[0] for p in curves[k]], [p[1] for p in curves[k]]) if curves and k in curves else 1.0
    out = wind * u(G.breeze(dur, r, 1.0, gust, 750)) * cv("wind")
    if waves:
        wv = np.zeros((2, n))
        tm = r.uniform(0, 1.0)
        while tm < dur:
            place(wv, pan(wave_wash(r, 3.6, r.uniform(0.6, 1.0)), r.uniform(-0.75, 0.75)), tm - 0.8)
            tm += r.uniform(*wave_gap)
        out = out + waves * u(wv) * cv("waves")
    if hull:
        hs = np.stack([bp(colored(n, r, 0.6), 250, 2600, 1) * (0.6 + 0.4 * smooth_noise(n, r, 0.4)) for _ in range(2)])
        out = out + hull * u(hs) * cv("hull")
    if flags:
        out = out + flags * u(pan(G.flag_flutter(dur, r), 0.3)) * cv("flags")
    if sails:
        rate = 2.4 + 0.8 * smooth_noise(n, r, 0.3)
        m = 0.5 + 0.5 * np.sin(phase(rate))
        sl = bp(r.standard_normal(n), 120, 1400, 1) * m ** 2.5 * (0.5 + 0.5 * smooth_noise(n, r, 0.2))
        out = out + sails * u(pan(sl, -0.2)) * cv("sails")
    if lap:
        out = out + lap * u(lapping(dur, r, lap_rate)) * cv("lap")
    return out


def underwater_bed(dur, r, depth=0.0, bubbles=1.0, bubble_rate=4.0, drone=0.0):
    """under water: low rumble + slow current, muffled surface wash (shallow), sparse muffled bubble plinks,
    a dark drone in the deep. depth 0 = near the seabed in the shallows, 1 = 600 m"""
    n = ns(dur)
    out = np.zeros((2, n))
    for ch in range(2):
        rum = hp(lp(colored(n, r, 2.0), 230 - 110 * depth, 2), 28, 2) * (0.75 + 0.25 * smooth_noise(n, r, 0.12))
        cur = bp(colored(n, r, 1.0), 110, 620 - 300 * depth, 1) * (0.6 + 0.4 * smooth_noise(n, r, 0.2))
        surf = bp(colored(n, r, 0.8), 180, 700, 1) * (0.5 + 0.5 * np.sin(TAU * 0.13 * np.arange(n) / SR + r.uniform(0, TAU))) ** 2
        out[ch] = u(rum) + 0.45 * u(cur) + 0.3 * (1 - depth) * u(surf)
    if drone:
        t = np.arange(n) / SR
        d = sum(np.sin(TAU * f * t * (1 + 0.004 * smooth_noise(n, r, 0.1)) + r.uniform(0, TAU)) / (k + 1)
                for k, f in enumerate([41.0, 61.5, 82.3, 123.0]))
        out += drone * 0.8 * st(u(lp(d, 300, 2)))
    if bubbles:
        b = lp(G.bubbles(dur, r, bubble_rate, 250, 1500, (0.008, 0.03)), 1700, 2)
        out += bubbles * 0.35 * widen(u(b + 1e-9), r, 9, 1.0)
    return out


def splash(r, size=0.6):
    """water splash scaled by size (0.25 = a sailor, 0.6 = a cannonball column, 1 = big): thump, slap, body,
    bubble cloud, spray raining back"""
    dur = 0.9 + 1.7 * size
    n = ns(dur)
    t = np.arange(n) / SR
    nz = r.standard_normal(n)
    thump = np.exp(-t / (0.05 + 0.12 * size)) * np.sin(phase((95 - 35 * size) * (1 + 0.5 * np.exp(-t / 0.02)))) * (0.6 + 1.4 * size)
    slap = bp(nz, 280, 7500, 1) * np.exp(-t / (0.02 + 0.02 * size)) * 1.5
    benv = (1 - np.exp(-t / 0.015)) * (0.6 * np.exp(-t / (0.1 + 0.15 * size)) + 0.4 * np.exp(-t / (0.25 + 0.5 * size)))
    body = shape(colored(n, r, 0.4), gauss_band(lambda Tm: 800 + 1900 * np.exp(-Tm / 0.3), 1.35), 1024, 256) * benv * 1.3
    bub = G.bubbles(dur, r, 700 * size * np.exp(-t / 0.35) + 10, 260, 2600, (0.005, 0.03), np.exp(-t / (0.3 + 0.5 * size))) * 1.0
    t_sp = 0.18 + 0.35 * size
    senv = np.clip((t - t_sp) / 0.15, 0, 1) * np.exp(-np.maximum(t - t_sp - 0.15, 0) / (0.25 + 0.45 * size))
    spray = G.bubbles(dur, r, 450 * senv + 4, 1300, 5200, (0.003, 0.012), senv, rise=(8, 25)) * 0.55 + hp(nz, 3000) * senv * 0.05
    return fades(thump + slap + body + bub + spray * (0.4 + 0.6 * size), 0.0, 0.25)


def glugs(r, dur=0.6, count=5, f=(90, 230)):
    """air escaping a sinking hull / a helmet: big low bubbles 'blub-blub'"""
    n = ns(dur)
    y = np.zeros(n)
    tm = 0.0
    for k in range(count):
        L = r.uniform(0.07, 0.13)
        tl = tt(L * 3)
        f0 = r.uniform(*f)
        b = np.sin(phase(f0 * (1 + r.uniform(2, 5) * tl))) * np.exp(-tl / L) * (1 - np.exp(-tl / 0.004))
        b += 0.25 * np.sin(phase(2.1 * f0 * (1 + 3 * tl))) * np.exp(-tl / (L * 0.5))
        G._place_mono(y, b * r.uniform(0.6, 1.0), tm)
        tm += r.uniform(0.07, 0.16)
        if tm > dur - 0.05:
            break
    return y


def water_rush(r, dur):
    """water pouring into the hull: rushing flow that grows, gurgles and low glugs"""
    n = ns(dur)
    t = np.arange(n) / SR
    env = np.clip(t / (0.65 * dur), 0, 1) ** 0.8
    flow = bp(colored(n, r, 0.7), 250, 3600, 1) * (0.7 + 0.3 * smooth_noise(n, r, 7.0))
    gurgle = G.bubbles(dur, r, 260 * env + 20, 160, 1100, (0.01, 0.04), env)
    fizz = G.bubbles(dur, r, 380 * env + 20, 700, 2600, (0.004, 0.012), env)
    lo = glugs(r, dur, int(dur / 0.13), (80, 180))
    return fades((u(flow) * 0.8 + 0.8 * u(gurgle + 1e-9) + 0.35 * u(fizz + 1e-9) + 0.6 * u(lo + 1e-9)) * env, 0.05, 0.05)


def plunge(r):
    """the lens dips under the surface: wet slap, then everything muffles into a bubble burst and a low whoomp"""
    dur = 2.4
    n = ns(dur)
    t = np.arange(n) / SR
    nz = r.standard_normal(n)
    slap = bp(nz, 300, 6500, 1) * np.exp(-t / 0.022) * 1.4
    body = shape(colored(n, r, 0.8), gauss_band(lambda Tm: 500 + 2400 * np.exp(-Tm / 0.08), 1.4), 1024, 256)
    body *= (1 - np.exp(-t / 0.01)) * np.exp(-t / 0.45) * 1.1
    bub = lp(G.bubbles(dur, r, 900 * np.exp(-t / 0.3) + 10, 200, 2300, (0.006, 0.035), np.exp(-t / 0.6)), 2600, 2) * 1.3
    whoomp = np.sin(phase(55 * (1 + 0.6 * np.exp(-t / 0.03)))) * np.exp(-t / 0.25) * 1.2
    return fades(slap + body + bub + whoomp, 0.0, 0.3)


# ================================================================ battle
def cannon(r, size=1.0):
    """black-powder cannon: sharp crack, blast, sub thump, long rumble, echoes off the water; saturated like a real blast"""
    dur = 3.2
    n = ns(dur)
    t = np.arange(n) / SR
    nz = r.standard_normal(n)
    crack = bp(nz, 150, 12000, 2) * np.exp(-t / 0.004) * 2.0
    blast = lp(colored(n, r, 0.5), 1400, 2) * np.exp(-t / 0.07) * (1 - np.exp(-t / 0.001)) * 2.2
    sub = np.sin(phase(62 * size ** -0.2 * (1 + 0.6 * np.exp(-t / 0.03)))) * np.exp(-t / 0.28) * 2.6
    rum = lp(colored(n, r, 2.0), 260, 2) * (1 - np.exp(-t / 0.03)) * np.exp(-t / 0.9) * 1.1
    y = crack + blast + sub + rum
    src = blast + 0.5 * crack
    for d, g, f_lp in [(0.32, 0.28, 1800), (0.71, 0.16, 1100), (1.2, 0.08, 800)]:
        k = ns(d)
        y[k:] += lp(src, f_lp, 2)[: n - k] * g
    y /= np.abs(y).max()
    y = np.tanh(1.8 * y) / np.tanh(1.8)
    return fades(y, 0.0, 0.4)


def broadside(r, times, pans, far=0.0):
    """four guns in a ripple (times relative to the first)"""
    out = np.zeros((2, ns(3.6)))
    for k, (dt, p) in enumerate(zip(times, pans)):
        c = cannon(r, r.uniform(0.9, 1.1)) * (1.0 if k == 0 else r.uniform(0.7, 0.9))
        if far:
            c = lp(c, 9000 - 4000 * far, 1)
        place(out, pan(c, p), dt)
    return out


def ball_whistle(r, dur, p0, p1):
    """cartoon cannonball flight: descending whistle + air rush, panned across"""
    n = ns(dur)
    t = np.arange(n) / SR
    f = r.uniform(1900, 2300) * (1 - 0.42 * t / dur)
    tone = np.sin(phase(f)) + 0.15 * np.sin(2 * phase(f))
    air = bp(r.standard_normal(n), 600, 4500, 1) * 0.5
    env = np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 1.3
    return pan_move(fades((0.5 * tone + air) * env, 0.01, 0.03), p0, p1)


def splash_volley(r, times, pans, size=0.6):
    out = np.zeros((2, ns(3.5)))
    for k, (dt, p) in enumerate(zip(times, pans)):
        place(out, pan(splash(r, size * r.uniform(0.85, 1.1)) * (1.0 if k == 0 else r.uniform(0.6, 0.9)), p), dt)
    return out


# ================================================================ wood
def hull_groan(r, dur, deep=1.0, pts=None):
    """a big wooden hull straining: very slow stick-slip through low timber modes + a higher plank creak on top"""
    lo = G.creak(dur, r, 13 * deep, 32 * deep, [(f * 0.6, q, g) for f, q, g in G.TIMBER], pts or [(0, 0), (0.25, 1), (0.7, 0.9), (1, 0)], 0.3, 0.06)
    hi = G.creak(dur * 0.8, r, 55, 125, G.WOOD, pts or [(0, 0), (0.3, 0.6), (0.6, 1), (1, 0)], 0.2, 0.03, scale=0.8)
    y = u(lo)
    G._place_mono(y, 0.55 * u(hi), dur * 0.15)
    return y


def hull_crunch(r):
    """'de repente': the hull gives way - splintering crack + timber thud + the first groan (not an explosion)"""
    dur = 1.6
    n = ns(dur)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for i in range(10):
        tm = (abs(r.normal(0, 0.04)) if i else 0.0) + i * 0.008
        md = [(r.uniform(500, 1400), 1.0, 0.012), (r.uniform(1500, 3500), 0.7, 0.006), (r.uniform(3500, 7000), 0.4, 0.003)]
        k = modal(0.15, md, r) + hp(r.standard_normal(ns(0.15)), 1200) * np.exp(-tt(0.15) / 0.003)
        G._place_mono(y, k * (1.0 if i == 0 else r.uniform(0.3, 0.8)), tm)
    thud = np.exp(-t / 0.16) * np.sin(phase(78 * (1 + 0.35 * np.exp(-t / 0.025)))) * 1.6
    thud += resbank(lp(r.standard_normal(n), 900) * np.exp(-t / 0.04), G.TIMBER[:4]) * 0.4
    tear = G.timber_tear(r, 0.9)
    y = u(y) + 0.9 * u(thud)
    G._place_mono(y, 0.6 * u(tear), 0.05)
    return y


def plank_pops(r, times):
    y = np.zeros(ns(max(times) + 0.3))
    for tm in times:
        md = [(r.uniform(700, 1600), 1.0, 0.01), (r.uniform(1800, 4200), 0.6, 0.005)]
        k = modal(0.12, md, r) + hp(r.standard_normal(ns(0.12)), 1500) * np.exp(-tt(0.12) / 0.002) * 0.7
        G._place_mono(y, k * r.uniform(0.6, 1.0), tm)
    return y


def ship_creak(r, dur=0.8, big=1.0):
    c = G.creak(dur, r, 38 * big, 85 * big, G.TIMBER, [(0, 0), (0.35, 1), (0.75, 0.7), (1, 0)], 0.2, 0.04, scale=r.uniform(0.85, 1.1))
    w = G.creak(dur * 0.6, r, 90, 160, G.WOOD, [(0, 0), (0.4, 1), (1, 0)], 0.15, 0.02, scale=r.uniform(0.9, 1.15))
    y = u(c)
    G._place_mono(y, 0.4 * u(w), dur * 0.25)
    return y


def rope_creak(r, a=1.0):
    """taut rope / rigging: fibre stick-slip + fibre crackle"""
    d = 0.26 + 0.2 * a
    c = G.creak(d, r, 85, 170 + 60 * a, ROPE, [(0, 0), (0.2, 1), (0.6, 0.75), (1, 0)], 0.15, 0.04, scale=r.uniform(0.9, 1.1))
    cr = np.zeros(len(c))
    for tm in np.sort(r.uniform(0.02, d * 0.8, 9)):
        G._place_mono(cr, hp(r.standard_normal(ns(0.01)), 2500) * np.exp(-tt(0.01) / 0.0015) * r.uniform(0.3, 1.0), tm)
    return u(c) + 0.35 * u(cr + 1e-9)


def barrel_knock(r):
    d = 0.5
    t = tt(d)
    k = modal(d, [(r.uniform(150, 190), 1.0, 0.07), (r.uniform(320, 380), 0.6, 0.045), (r.uniform(580, 680), 0.35, 0.03), (1050, 0.18, 0.02)], r)
    k += lp(r.standard_normal(len(t)), 600) * np.exp(-t / 0.01) * 0.4
    s = slosh(r, 0.5)
    y = u(k)
    G._place_mono(y, 0.5 * u(s), 0.02)
    return y


# ================================================================ sea life, ships, gear
def sail_fwump(r):
    """canvas filling with wind: low 'fwump' + a flutter tail"""
    d = 0.9
    n = ns(d)
    t = np.arange(n) / SR
    nz = r.standard_normal(n)
    body = lp(nz, 650, 2) * np.exp(-t / 0.18) * (1 - np.exp(-t / 0.015))
    m = 0.5 + 0.5 * np.sin(phase(14 - 8 * t / d))
    flut = bp(nz, 200, 2500, 1) * m ** 3 * np.exp(-t / 0.25)
    return fades(u(body) + 0.5 * u(flut), 0.0, 0.1)


def gull(r, calls=None, base=None):
    """herring-gull-like call 'kyow-kyow': raspy harmonic voice, pitch up-then-down, each call a bit lower"""
    calls = calls or int(r.integers(2, 4))
    base = base or r.uniform(1150, 1500)
    out = np.zeros(ns(1.8))
    tm = 0.0
    for c in range(calls):
        d = r.uniform(0.26, 0.38)
        n = ns(d)
        t = np.arange(n) / SR
        f0 = base * (0.94 ** c) * np.interp(t, [0, 0.07, d], [1.0, 1.22, 0.72])
        ph = phase(f0)
        y = sum(np.sin(k * ph + r.uniform(0, TAU)) * k ** -1.1 for k in range(1, 7))
        y *= 1 + 0.45 * np.sin(TAU * r.uniform(85, 110) * t)
        y = peq(bp(y, 700, 7000, 1), 2600, 6, 1.2)
        env = np.clip(t / 0.02, 0, 1) * np.clip((d - t) / 0.08, 0, 1)
        G._place_mono(out, y * env, tm)
        tm += d + r.uniform(0.1, 0.2)
    return out


def spyglass(r):
    """brass telescope snapped open: metal tube slide + a click"""
    slide = G.creak(0.17, r, 500, 1200, G.SMALLMETAL, [(0, 0.3), (0.3, 1), (1, 0.8)], 0.1, 0.25)
    slide = u(slide) + 0.6 * u(bp(r.standard_normal(ns(0.17)), 2000, 9000, 1) * np.linspace(0.4, 1, ns(0.17)))
    y = np.zeros(ns(0.45))
    G._place_mono(y, fades(slide, 0.01, 0.01), 0.0)
    G._place_mono(y, 1.6 * u(G.clink(r, 2900, 0.12)) + 0.8 * u(modal(0.12, [(900, 1, 0.02), (1800, 0.5, 0.01)], r)), 0.17)
    return y


def timelapse(r, dur):
    """years racing by: wind gusting fast + a chain of whooshes (clouds racing)"""
    n = ns(dur)
    w = G.breeze(dur, r, 1.0, 3.0, 1100)
    w *= (0.55 + 0.45 * smooth_noise(n, r, 4.0))[None, :]
    out = 0.6 * u(w)
    tm = 0.0
    k = 0
    while tm < dur - 0.2:
        place(out, pan(0.9 * u(G.whoosh(0.5, r, 0.22, 300, 1900, 0.9, 0.12, 0.2)), (-0.5 if k % 2 else 0.5)), tm)
        tm += r.uniform(0.26, 0.38)
        k += 1
    return fades(out, 0.08, 0.05)


def diver_burst(r):
    """exhaust bubbles from the helmet: a rising cloud + a few low 'blubs' + a hiss of air, muffled"""
    d = 1.0
    n = ns(d)
    t = np.arange(n) / SR
    b = G.bubbles(d, r, 260 * np.exp(-t / 0.18) + 8, 180, 1300, (0.01, 0.04), np.exp(-t / 0.35), rise=(3, 9))
    lo = glugs(r, d, 3, (110, 220))
    hiss = bp(r.standard_normal(n), 400, 1800, 1) * np.exp(-t / 0.2) * 0.1
    return lp(u(b + 1e-9) + 0.6 * u(lo + 1e-9) + 0.3 * u(hiss), 2400, 2)


def shrug(r):
    """the diver's comedic shrug: two muffled bubble 'bloops' falling ('dunno') + a suit rustle"""
    d = 0.6
    y = np.zeros(ns(d))
    for tm, f0, f1, L in [(0.0, 330, 470, 0.11), (0.16, 250, 340, 0.14)]:
        tl = tt(L)
        f = f0 + (f1 - f0) * (1 - np.exp(-tl / 0.03))
        b = (np.sin(phase(f)) + 0.15 * np.sin(2 * phase(f))) * np.sin(np.pi * np.clip(tl / L, 0, 1)) ** 0.6
        G._place_mono(y, b, tm)
    t = tt(d)
    rus = bp(r.standard_normal(len(t)), 600, 4000, 1) * np.sin(np.pi * np.clip(t / 0.3, 0, 1)) ** 2 * 0.12
    return lp(y + rus, 3500, 2)


def engine(dur, r):
    """modern support ship's diesel heard from the stern: firing pulses through low hull resonances + mechanical tick"""
    n = ns(dur)
    imp = G.stick_slip(dur, 15.5, r, 0.04)
    y = resbank(imp, [(48, 3, 1.0), (96, 4, 0.7), (150, 5, 0.45), (260, 6, 0.25), (420, 7, 0.12)])
    y = u(y) + 0.5 * u(lp(colored(n, r, 1.0), 450, 2)) + 0.06 * u(hp(G.stick_slip(dur, 31.0, r, 0.05), 2500))
    return y


def winch(r, dur):
    """electric winch / A-frame lowering the ROV: brake clunk, motor spinning up, gear whine, cable creaks"""
    n = ns(dur)
    t = np.arange(n) / SR
    sp = np.clip(t / 0.35, 0, 1) * np.clip((dur - t) / 0.3, 0, 1)
    f = 50 + 115 * sp
    ph = phase(f)
    mot = sum(np.sin(k * ph) / k for k in range(1, 9)) * sp
    gear = bp(np.sin(11 * ph) * sp, 1500, 3500, 1) * 0.15
    y = u(mot) + 0.5 * u(gear + 1e-9) + 0.25 * u(lp(colored(n, r, 1.0), 900) * sp)
    clunk = modal(0.4, [(220, 1.0, 0.05), (510, 0.6, 0.03), (930, 0.3, 0.02)], r) + lp(r.standard_normal(ns(0.4)), 400) * np.exp(-tt(0.4) / 0.02)
    G._place_mono(y, 1.4 * u(clunk), 0.0)
    for tm in (0.7, 1.35):
        if tm < dur - 0.3:
            G._place_mono(y, 0.35 * u(rope_creak(r, 0.6)), tm)
    return y


def thruster(r, dur):
    """ROV thrusters under water: electric whine with wobble, propeller wash, entrained bubbles - muffled"""
    n = ns(dur)
    t = np.arange(n) / SR
    sp = 0.88 + 0.12 * smooth_noise(n, r, 0.6)
    ph = phase(370 * sp)
    tone = np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.3 * np.sin(3 * ph) + 0.12 * np.sin(5 * ph)
    wash = bp(colored(n, r, 1.0), 80, 700, 1) * sp
    bub = G.bubbles(dur, r, 30, 250, 1100, (0.006, 0.02))
    y = 0.5 * u(tone) + u(wash) + 0.35 * u(bub + 1e-9)
    return lp(y, 1600, 2) * np.clip(t / 0.2, 0, 1)


def lamp_click(r):
    """ROV lamp switching on: relay click + a short electrical hum swell"""
    d = 0.7
    t = tt(d)
    click = u(G.clink(r, r.uniform(1700, 2100), 0.06)) * 0.8
    knock = u(modal(0.12, [(420, 1, 0.012), (980, 0.5, 0.008)], r))
    hum = sum(np.sin(TAU * 100 * k * t) / k for k in (1, 2, 3)) * (1 - np.exp(-t / 0.03)) * (0.3 + 0.7 * np.exp(-t / 0.12))
    y = 0.5 * u(hum)
    G._place_mono(y, click, 0.0)
    G._place_mono(y, 0.8 * knock, 0.0)
    return lp(fades(y, 0.0, 0.15), 2800, 2)


def sonar_ping(r, f=1480.0, echo=0.25):
    d = 2.2
    t = tt(d)
    y = (np.sin(phase(f * (1 - 0.01 * t))) + 0.08 * np.sin(phase(2 * f))) * np.exp(-t / 0.35) * (1 - np.exp(-t / 0.004))
    if echo:
        k = ns(0.6)
        y[k:] += lp(y, 1200, 2)[: len(y) - k] * echo
    return fades(y, 0.0, 0.2)


def tug_scrape(r, t0, t1):
    """the chest dragged back and forth on the planks: friction stick-slip whose rate and level follow its speed;
    panned with the chest (Colombia left, Spain right)"""
    dur = t1 - t0
    n = ns(dur)
    tv = t0 + np.arange(n) / SR
    sp = np.abs(T.tug_v(tv))
    sp = (sp / sp.max()) ** 1.5
    imp = G.stick_slip(dur, 25 + 110 * sp[::480], r, 0.25, sp)
    y = u(resbank(imp, [(f * 1.25, q, g) for f, q, g in G.WOOD])) + 0.5 * u(bp(r.standard_normal(n), 500, 4000, 1)) * sp
    p = np.clip(T.tug_x(tv) / 0.22 * 0.4, -1, 1)
    th = (p + 1) * np.pi / 4
    return np.stack([y * np.cos(th), y * np.sin(th)]) * np.sqrt(2)


# ================================================================ cue list
def cues():
    C = []
    R = rng(1708)
    rr = lambda: rng(int(R.integers(1 << 30)))
    add = C.append

    # ------------------------------------------------ ambience beds (not reduced by the -6 dB event rule)
    def bed(fn, dur, fin, fout, seed):
        return lambda: (fades(fn(dur, rng(seed)), fin, fout), 0.0)

    a, b = 0.0, T.SEA0
    add(Cue(a, "amb_under_hook", "under water by the chest and the wreck: rumble, current, muffled surface wash, bubbles (shots 1-2)",
            bed(lambda d, r: underwater_bed(d, r, 0.1, 1.2, 6.0), b - a, 0.12, 0.012, 11), -25, "bed", send=0.0, bus="water"))
    a, b = T.SEA0, T.DUSK
    curves = {"hull": [(0, 1.0), (T.ENGLISH - a, 1.0), (T.ENGLISH - a + 0.05, 0.6), (T.BATTLE0 - a, 0.6), (T.SINK_SHOT - a, 0.4), (b - a, 0.2)],
              "flags": [(0, 1.0), (T.CAPTAIN - a, 1.6), (T.ENGLISH - a, 1.6), (T.ENGLISH - a + 0.05, 0.7), (T.SINK_SHOT - a, 0.5), (b - a, 0.0)],
              "sails": [(0, 1.0), (T.ENGLISH - a, 1.0), (T.ENGLISH - a + 0.05, 0.6), (T.SINK_SHOT - a, 0.0), (b - a, 0.0)],
              "lap": [(0, 0.3), (T.SINK_SHOT - a, 0.3), (T.SINK_SHOT - a + 0.05, 1.3), (b - a, 1.5)],
              "wind": [(0, 1.0), (T.SINK_SHOT - a, 1.0), (T.SINK_SHOT - a + 0.05, 0.7), (b - a, 0.7)]}
    add(Cue(a, "amb_sea", "golden open sea: wind, rolling waves, the galleon's hull swishing, sails luffing, flags (louder by the captain), "
            "water-level lapping in the sinking shot (shots 3-6)",
            bed(lambda d, r: sea_bed(d, r, 1.0, 0.9, (2.2, 3.6), hull=0.7, flags=0.32, lap=0.5, lap_rate=1.4, sails=0.3, curves=curves), b - a, 0.012, 0.02, 12),
            -24, "bed", send=0.0))
    a, b = T.DUSK, T.SEARCH0
    add(Cue(a, "amb_dusk", "dusk, calm sea: gentle lapping on the rowboat, faint breeze, slow distant swell (shot 7)",
            bed(lambda d, r: sea_bed(d, r, 0.45, 0.5, (3.5, 5.0), lap=1.0, lap_rate=1.1, gust=0.1) + 0.0, b - a, 0.012, 0.012, 13),
            -28, "bed", send=0.0))
    a, b = T.SEARCH0, T.UNDER8
    add(Cue(a, "amb_search", "day sea under racing clouds: wind and waves (shot 8, surface)",
            bed(lambda d, r: sea_bed(d, r, 1.0, 0.8, (1.2, 2.0), lap=0.3), b - a, 0.012, 0.012, 14), -27, "bed", send=0.0))
    a, b = T.UNDER8, T.SUP0
    add(Cue(a, "amb_under_diver", "under water by the helmet diver: rumble, current, his steady stream of bubbles (shot 8, under)",
            bed(lambda d, r: underwater_bed(d, r, 0.25, 2.0, 14.0), b - a, 0.012, 0.012, 15), -25, "bed", send=0.0, bus="water"))
    a, b = T.SUP0, T.DEEP9
    curves9 = {"flags": [(0, 1.0), (b - a, 1.0)]}
    add(Cue(a, "amb_support", "support ship at sea: diesel engine from the stern, wind, waves, the Colombian flag flapping (shot 9, surface)",
            bed(lambda d, r: sea_bed(d, r, 0.9, 0.7, (1.8, 3.0), flags=0.4, lap=0.4, curves=curves9) + 0.55 * st(engine(d, r)), b - a, 0.012, 0.012, 16),
            -25, "bed", send=0.0))
    a, b = T.DEEP9, T.DOCK0
    add(Cue(a, "amb_deep", "600 m deep in the dark: very low rumble, dark drone, few bubbles (shot 9, deep)",
            bed(lambda d, r: underwater_bed(d, r, 1.0, 0.6, 3.0, drone=0.6), b - a, 0.012, 0.012, 17), -27, "bed", send=0.0, bus="water"))
    a, b = T.DOCK0, T.DIP
    curves10 = {"lap": [(0, 1.0), (T.GLIDE0 - a, 1.0), (b - a, 2.6)], "wind": [(0, 1.0), (T.GLIDE0 - a, 1.0), (b - a, 0.5)],
                "waves": [(0, 1.0), (T.GLIDE0 - a, 1.0), (b - a, 1.6)]}
    add(Cue(a, "amb_dock", "sunny harbour in Cartagena: water lapping on the pier piles (hollow), breeze, soft swell; the water gets "
            "closer as the camera sinks off the dock (shots 10-11)",
            bed(lambda d, r: sea_bed(d, r, 0.8, 0.5, (2.5, 4.0), lap=0.9, lap_rate=1.3, curves=curves10) + 0.45 * u(lapping(d, r, 0.8, 1.0, hollow=1.0)),
                b - a, 0.012, 0.01, 18), -27, "bed", send=0.0))
    a, b = T.DIP, T.DUR
    add(Cue(a, "amb_under_end", "under water again, settling on the lonely wreck: calm rumble, current, slow bubbles; fades out to the end",
            lambda d=b - a: (fades(underwater_bed(d, rng(19), 0.15, 1.0, 4.0) * np.interp(tt(d), [0, 3.3, d], [1, 1, 0])[None, :] ** 1.5,
                                   0.03, 0.05), 0.0), -25, "bed", send=0.0, bus="water"))

    # ------------------------------------------------ shots 1-2: hook under water
    add(Cue(T.FLASH, "flash_swell", "soft muffled reverse swell into the white flash (frame 125) + low whoomp (cut to the wreck)",
            lambda: _flash(rng(125)), -12, lpf=3500, send=0.2, bus="water"))
    add(Cue(5.0, "wreck_groan", "the old wreck groans far off (muffled timber)", lambda: (hull_groan(rng(500), 1.5, 0.8), 0.0), -17,
            p=-0.2, lpf=900, send=0.3, bus="water"))

    # ------------------------------------------------ shots 3-4: the galleon, the captains
    add(Cue(T.SEA0 + 0.03, "sail_fwump", "cut to the surface: the sails fill with a 'fwump'", lambda: (sail_fwump(rng(218)), 0.0), -12, p=0.2, send=0.1))
    for tm, pp, seed in [(7.9, -0.6, 1), (10.75, 0.55, 2)]:
        add(Cue(tm, "gull", "gull calls, far", (lambda s=seed: (gull(rng(700 + s)), 0.0)), -17, p=pp, lpf=6000, send=0.25, group="gulls"))
    for tm, pp, big, nv in [(7.95, -0.25, 1.0, -15), (T.CAPTAIN + 0.9, 0.1, 0.9, -14), (11.2, -0.1, 1.1, -15), (T.ENG_CAPTAIN + 0.5, 0.2, 0.9, -16)]:
        add(Cue(tm, "ship_creak", "hull / deck timber creak as the ship rolls", (lambda r=rr(), big=big: (ship_creak(r, 0.8, big), 0.0)), nv,
                p=pp, send=0.12, group="ship_creak"))
    add(Cue(10.15, "rigging", "rigging rope creaks under the wind", lambda: (rope_creak(rng(1015), 0.8), 0.0), -16, p=0.4, send=0.12))
    add(Cue(T.ENG_CAPTAIN - 0.03, "spyglass", "cut to the English captain: brass spyglass snapped open (shhk-click)",
            lambda: (spyglass(rng(408)), 0.0), -9, p=0.15, send=0.08))

    # ------------------------------------------------ shot 5: "Canonazo va, canonazo viene"
    g0 = T.GUNS_ES[0]
    add(Cue(g0 - T.LEAD, "broadside_es", "THE GALLEON'S BROADSIDE on 'Canonazo': 4 guns at frames 446/447.5/449/450.5 (crack, blast, sub, echo)",
            lambda: (broadside(rng(446), [t - g0 for t in T.GUNS_ES], [-0.6, -0.5, -0.4, -0.3]), 0.0), 0, send=0.18))
    add(Cue(g0 + 0.03, "whistle_es", "cannonballs whistling across the gap (left -> right, 13 f)",
            lambda: (_whistles(rng(447), [t - g0 for t in T.GUNS_ES[::2]], T.BALL_F / T.FPS, -0.5, 0.5), 0.0), -12, send=0.1))
    s0 = T.SPL_ES[0]
    add(Cue(s0 - T.LEAD, "splash_es", "4 water columns by the English hull (frames 459-464 onsets)",
            lambda: (splash_volley(rng(459), [t - s0 for t in T.SPL_ES], [0.4, 0.5, 0.6, 0.45], 0.6), 0.0), -5, send=0.15))
    add(Cue(g0 + 0.2, "recoil_creak", "the galleon rocks from the recoil: timber creak", lambda: (ship_creak(rng(452), 0.9, 1.2), 0.0), -13,
            p=-0.4, send=0.12))
    e0 = T.GUNS_EN[0]
    add(Cue(e0 - T.LEAD, "broadside_en", f"THE ENGLISH REPLY on 'canonazo' (frames {T.ENG_FIRE_FRAME}-{T.ENG_FIRE_FRAME + 4.5:g})",
            lambda: (broadside(rng(468), [t - e0 for t in T.GUNS_EN], [0.6, 0.5, 0.4, 0.3], far=0.3), 0.0), -4, send=0.2))
    add(Cue(e0 + 0.03, "whistle_en", "English balls whistling back (right -> left)",
            lambda: (_whistles(rng(469), [t - e0 for t in T.GUNS_EN[::2]], T.BALL_F / T.FPS, 0.5, -0.5), 0.0), -12, send=0.1))
    s1 = T.SPL_EN[0]
    add(Cue(s1 - T.LEAD, "splash_en", "4 water columns by the galleon on 'viene' (kick 481)",
            lambda: (splash_volley(rng(481), [t - s1 for t in T.SPL_EN], [-0.45, -0.55, -0.35, -0.5], 0.65), 0.0), -6, send=0.15))

    # ------------------------------------------------ shot 6: the sinking (no explosion)
    cut6 = T.DUSK
    add(Cue(T.REPENTE - T.LEAD, "hull_crunch", "'de repente' (kick 500): the hull gives way - splintering crack + timber thud (no blast)",
            lambda: (hull_crunch(rng(500)), 0.0), -5, send=0.15, cut=cut6))
    add(Cue(T.SINK0, "hull_groan", "the hull groans as it lists (long low timber groan)", lambda: (hull_groan(rng(501), 1.5, 1.0), 0.0), -6,
            p=-0.05, send=0.18, cut=cut6, group="groans"))
    add(Cue(17.55, "hull_groan", "second, deeper groan: swells before 'se hundio', eases under the word, tails after",
            lambda: (hull_groan(rng(531), 1.25, 0.85, [(0, 0), (0.3, 1), (0.48, 0.5), (0.72, 0.35), (0.85, 0.5), (1, 0)]), 0.0), -8,
            p=0.05, send=0.18, cut=cut6, group="groans"))
    add(Cue(17.1, "plank_pops", "planks popping under the strain", lambda: (plank_pops(rng(513), [0.0, 0.31, 0.82, 1.2]), 0.0), -14,
            p=0.15, send=0.15, cut=cut6))
    add(Cue(16.85, "water_rush", "water rushing into the hull, gurgling, growing", lambda: (water_rush(rng(505), T.DUSK - 16.85 + 0.05), 0.0),
            -12, send=0.12, cut=cut6))
    for k, tm in enumerate(T.SAILOR_SPLASH):
        if tm >= T.DUSK - 0.05:
            continue                                   # lands on / after the cut to the rowboat: not heard
        pp = -0.45 + 0.18 * k + (0.08 if k % 2 else -0.08)
        add(Cue(tm - T.LEAD, "sailor_splash", f"sailor {k + 1} hits the water (jumped at {T.JUMPS[k]:.2f})", (lambda r=rr(): (splash(r, 0.28), 0.0)),
                -15 if k == 2 else -11, p=pp, send=0.15, cut=cut6, group="sailor_splash"))
    for k, (tm, nv) in enumerate(zip(T.HULL_SPLASH, (-9, -12, -2))):
        add(Cue(tm - T.LEAD, "hull_splash", f"big splash around the hull {k + 1}/3" + (" - the BIG one right after 'hundio' (18.18-18.44)" if k == 2 else ""),
                (lambda r=rr(), big=(k == 2): (_bigsplash(r, big), 0.0)), nv, p=-0.35 + 0.35 * k, send=0.15, cut=cut6, group="hull_splash"))
    add(Cue(18.45, "glugs", "the hull swallowed: big air bubbles 'blub-blub-blub'", lambda: (glugs(rng(554), 0.5, 6, (85, 200)), 0.0), -9,
            send=0.15, cut=cut6))

    # ------------------------------------------------ shot 7: dusk, the rowboat
    for k, tm in enumerate(T.BOAT_CREAKS):
        add(Cue(tm, "rowboat_creak", "slow wooden creak of the rowboat rocking", (lambda r=rr(): (G.creak(0.75, r, 45, 85, G.WOOD, [(0, 0), (0.4, 1), (0.8, 0.7), (1, 0)], 0.18, 0.03, 0.85), 0.0)),
                -15, p=0.1 if k else -0.1, send=0.15, group="rowboat_creak"))
    for tm, pp in [(20.55, -0.5), (21.35, 0.6)]:
        add(Cue(tm, "barrel_knock", "floating barrel bumping debris (hollow knock)", (lambda r=rr(): (barrel_knock(r), 0.0)), -17, p=pp,
                send=0.2, group="barrel_knock"))

    # ------------------------------------------------ shot 8: searching for 300 years, the helmet diver
    add(Cue(T.SEARCH0, "timelapse", "years racing by: fast wind gusts + a chain of whooshes (clouds racing)",
            lambda: (timelapse(rng(661), T.UNDER8 - T.SEARCH0), 0.0), -12, send=0.1, cut=T.UNDER8))
    add(Cue(22.45, "gull", "gull calls, far", lambda: (gull(rng(703), 2), 0.0), -18, p=0.5, lpf=6000, send=0.25, group="gulls", cut=T.UNDER8))
    for tm in (23.62, 24.72):
        add(Cue(tm, "diver_bubbles", "exhaust bubbles burst from the diver's helmet (muffled)", (lambda r=rr(): (diver_burst(r), 0.0)), -13,
                p=0.05, send=0.25, bus="water", group="diver_bubbles"))
    add(Cue(T.SHRUG - T.LEAD, "shrug", "the diver shrugs (frame 731): two muffled bubble 'bloops' falling - 'dunno'",
            lambda: (shrug(rng(731)), 0.0), -8, send=0.2, bus="water"))

    # ------------------------------------------------ shot 9: the support ship, the ROV at 600 m
    add(Cue(25.55, "winch", "A-frame winch: brake clunk, motor spins up, cable creaks (the ROV on its crane)",
            lambda: (winch(rng(766), T.DEEP9 - 25.55 + 0.2), 0.0), -13, p=0.3, send=0.1, cut=T.DEEP9))
    add(Cue(25.75, "gull", "gull calls, far", lambda: (gull(rng(705), 2), 0.0), -18, p=-0.5, lpf=6000, send=0.25, group="gulls", cut=T.DEEP9))
    for k, tm in enumerate((T.DEEP9 - 0.02, T.DEEP9 + 0.07)):
        add(Cue(tm, "lamp_click", f"ROV lamp {k + 1} switches on (relay click + hum)", (lambda r=rr(): (lamp_click(r), 0.0)), -11,
                p=-0.3 if k == 0 else 0.3, send=0.2, bus="water", group="lamp_click"))
    add(Cue(T.DEEP9, "thruster", "ROV thrusters: electric whine + propeller wash, muffled (descends 27.43-29.83)",
            lambda: (thruster(rng(823), T.DOCK0 - T.DEEP9), 0.0), -14, p=0.1, send=0.15, bus="water", cut=T.DOCK0))
    add(Cue(27.95, "sonar_ping", "sonar ping in the pause after 'lo tenia,' (with a return echo)", lambda: (sonar_ping(rng(838), 1480), 0.0),
            -10, send=0.35, bus="water", cut=T.DOCK0))
    add(Cue(28.95, "sonar_ping", "softer second ping as the light finds the wreck", lambda: (sonar_ping(rng(868), 1480, 0.3), 0.0), -16,
            send=0.4, bus="water", cut=T.DOCK0))

    # ------------------------------------------------ shots 10-11: the tug-of-war on the dock
    def scrape_gen():
        x = tug_scrape(rng(899), T.DOCK0, T.DIP)
        tv = T.DOCK0 + np.arange(x.shape[1]) / SR
        g = np.interp(tv, [T.DOCK0, T.SHOT11 - 0.01, T.SHOT11, T.TUG_END, T.DIP], [0.0, 0.0, -3.0, -3.0, -14.0])
        return fades(x * dbg(g)[None, :], 0.012, 0.02), 0.0
    add(Cue(T.DOCK0, "tug_scrape", "the chest scraping back and forth on the planks (level follows its speed, panned with it)",
            scrape_gen, -12, send=0.08))
    for k, (tm, d) in enumerate(T.tug_reversals()):
        if tm > T.GLIDE1:
            continue
        ex = 0.0 if tm < T.SHOT11 else (-3.0 if tm < T.TUG_END else -8.0)
        side = "Spain (right)" if d > 0 else "Colombia (left)"
        add(Cue(tm - 0.02, "rope_creak", f"jerk {k + 1}: the rope to {side} snaps taut (creak)", (lambda r=rr(): (rope_creak(r, 1.0), 0.0)),
                -11, p=0.45 * d, extra=ex, send=0.1, group="rope_creak"))
    for kk, pp in ((0, -0.4), (1, 0.4)):
        for m in range(12):
            tm = T.DOCK0 + (m - 0.4 * kk) / 1.1
            if T.DOCK0 + 0.05 < tm < T.TUG_END:
                ex = 0.0 if tm < T.SHOT11 else -3.0
                add(Cue(tm, "foot_scuff", "a puller's boot scuffs the planks (dust puff)", (lambda r=rr(): (G.stroll_step(r, 1.0), 0.0)), -19,
                        p=pp, extra=ex, send=0.08, group="foot_scuff"))
    for tm, pp, seed in [(30.15, 0.6, 3), (34.35, -0.55, 4)]:
        add(Cue(tm, "gull", "harbour gulls, far", (lambda s=seed: (gull(rng(710 + s)), 0.0)), -19, p=pp, lpf=6000, send=0.25, group="gulls"))
    add(Cue(T.GLIDE0, "glide_whoosh", "the camera glides down off the dock (1085-1105)",
            lambda: (G.whoosh(0.85, rng(1085), 0.5, 280, 1500, 0.9, 0.2, 0.12), 0.0), -10, send=0.1, cut=T.DIP))
    add(Cue(T.DIP - T.LEAD, "plunge", "the lens dips under the water (frame 1107): wet slap -> muffled bubble burst + low whoomp",
            lambda: (plunge(rng(1107)), 0.0), -5, send=0.25, bus="water"))
    add(Cue(T.SETTLE - 0.1, "wreck_groan", "settling on the lonely wreck: a deep muffled timber groan", lambda: (hull_groan(rng(1155), 1.6, 0.75), 0.0),
            -17, p=0.15, lpf=850, send=0.35, bus="water"))
    return C


# ================================================================ composite helpers
def _flash(r):
    dur = 0.75
    y = G.whoosh(dur, r, 0.33, 400, 3000, 0.9, 0.09, 0.2)
    t = tt(dur)
    boom = np.where(t > 0.33, np.exp(-(t - 0.33) / 0.15) * np.sin(TAU * 58 * (t - 0.33)), 0) * 0.8
    return widen(u(y) + 0.8 * u(boom), r, 12, 0.9), 0.33


def _whistles(r, starts, dur, p0, p1):
    out = np.zeros((2, ns(dur + max(starts) + 0.1)))
    for k, s in enumerate(starts):
        place(out, ball_whistle(r, dur, p0, p1) * (1.0 if k == 0 else 0.7), s)
    return out


def _bigsplash(r, big):
    if big:
        x = G.splash_big(r)
        return u(x) + 0.5 * u(splash(r, 1.0))
    return splash(r, 0.85)


# ================================================================ render
def render(v_ref, on_event=None):
    """v_ref = integrated loudness of the voice stem (stereo). Returns (stereo stem, cue list with measured levels)."""
    C = cues()
    out = np.zeros((2, N))
    sends = {"air": np.zeros(N), "water": np.zeros(N)}
    for c in C:
        x, anchor = c.gen()
        x = np.asarray(x, float)
        x = pan(x, c.p) if x.ndim == 1 else x
        t0 = c.t - anchor
        if c.cut is not None:
            k = ns(c.cut - t0)
            if 0 < k < x.shape[1]:
                x = fades(x[:, :k], 0.0, 0.02)
        if c.lpf:
            x = lp(x, c.lpf, 2)
        tgt = v_ref + c.applied
        cur = momentary_max(x) if c.kind == "event" else integrated(x)
        if np.isfinite(cur):
            x = x * dbg(tgt - cur)
        c.measured = momentary_max(x) - v_ref if c.kind == "event" else integrated(x) - v_ref
        place(out, x, t0)
        if on_event:
            on_event(c, x, t0)
        if c.send > 0:
            G._place_mono(sends[c.bus], c.send * x.mean(0), t0)
    air = make_ir(0.8, 31, pre=0.012, hf=2.0, early=[(0.07, 0.3, -0.4), (0.15, 0.2, 0.5)])
    water = make_ir(1.7, 32, pre=0.02, hf=3.0, density_lp=1800)
    tv = np.arange(N) / SR
    under = np.array([T.under_at(x) for x in np.arange(0, T.DUR, 0.001)], float)
    m_under = np.interp(tv, np.arange(len(under)) * 0.001, under)
    from scipy import ndimage
    m_under = ndimage.uniform_filter1d(m_under, ns(0.02), mode="nearest")
    out += 0.5 * convolve_st(sends["air"], air) * (1 - m_under)[None, :]
    out += 0.6 * convolve_st(sends["water"], water) * m_under[None, :]
    out = hp(out, 25, 2)
    end = ns(T.DUR - 0.05)
    out[:, end:] *= np.linspace(1, 0, N - end)[None, :] ** 2
    return out, C


if __name__ == "__main__":
    import time
    t0 = time.time()
    st_, C = render(-20.0)
    print(f"{len(C)} cues, {time.time() - t0:.1f} s, peak {20 * np.log10(np.abs(st_).max()):.1f} dBFS, I {integrated(st_):.1f}")
