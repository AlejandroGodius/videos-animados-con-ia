# Final mix of "El galeon San Jose": the voice (gain only) + original score (ducked under speech keyed from words.json,
# per-section level automation relative to the voice) + synthesized SFX stem. Master gain to -14 LUFS integrated, own
# 4x-oversampled look-ahead limiter for <= -1 dBTP, exactly 42.000 s = 2,016,000 samples / 48 kHz / stereo / 24-bit.
# Writes salida/<name>/audio/mix.wav + stem_voice/music/sfx.wav (at mix gain, pre-limiter) + cues.md (every SFX event,
# music map, loudness report with an ffmpeg ebur128 cross-check). Rendered stems are cached in _cache/ keyed by a hash
# of the source files, so a re-mix after a level change takes seconds and a code change never reuses a stale render.
import os
import time
import json
import hashlib
import subprocess
import numpy as np
from scipy import ndimage, signal
from dsp import (SR, ns, st, dbg, read_wav, write_wav, integrated, momentary, short_term, lra, true_peak, fades)
import timeline as T

HERE = os.path.dirname(os.path.abspath(__file__))
NAME = os.path.basename(HERE)                                   # short name = this folder's name (audio/<name>/)
PROJ = os.path.dirname(os.path.dirname(HERE))                   # project root
VOICE = os.path.join(PROJ, "public", NAME, "voice.wav")         # clean voice (herramientas/voz.py)
WORDS = os.path.join(PROJ, "cortos", NAME, "words.json")        # word timings (herramientas/voz.py)
OUT = os.path.join(PROJ, "salida", NAME, "audio")               # mix.wav + stems + cues.md
CACHE = os.path.join(HERE, "_cache")
N = ns(T.DUR)                    # 2,016,000 samples = 42.000 s
TARGET_LUFS = -14.0
CEIL_DBTP = -1.2                 # limiter ceiling (spec: true peak <= -1 dBTP)
DUCK_DB = -3.0                   # music dip while the voice speaks (key = words.json, not the audio)

# music level per section, LU relative to the voice in that section (after ducking): the "+3 dB music" standard
# (bed ~-10 instead of the old -13); the sad dusk and the searching sit a little softer, and in the battle and the sinking the effects carry the shot
MUSIC_TARGET = {"deep": -10.0, "sail": -9.5, "threat": -10.0, "battle": -11.0, "sink": -11.0, "sad": -11.0, "search": -10.5,
                "find": -10.0, "dock": -10.0, "dock2": -11.0, "end": -10.0}

# music rides (start, end, dB): keep quiet words on top, mostly where a musical arrival lands on a cut
DIPS = [(4.10, 4.50, -3.0),      # "y su" right after the flash chord
        (6.70, 7.10, -3.5),      # "...del mar."
        (7.24, 7.56, -2.5),      # "Se" on the D major arrival at the cut to the surface
        (11.20, 11.68, -2.5),    # "de Indias,"
        (13.95, 14.55, -3.0),    # "...barcos ingleses." over the gathering drums
        (16.45, 16.82, -2.5),    # "y de" under the roll into "de repente"
        (21.05, 21.62, -2.0),    # "...sobrevivieron."
        (28.10, 28.32, -2.0),    # "a" (600 metros) where the motif enters
        (29.20, 29.76, -2.5),    # "...profundidad." over the swell into the dock
        (29.94, 30.28, -2.5),    # "Y" on the dock arrival
        (39.40, 39.86, -2.0)]    # "...todos." just before the final chord
# SFX rides (start, end, dB): only where the picture's own sounds sit on a quiet word
SFX_DIPS = [(17.98, 18.47, -3.0)]   # "se hundio." inside the sinking (groans + rushing water)

_s = lambda i: T.shot_t(i)
REPORT = [("chest (1)", *_s(1)), ("wreck (2)", *_s(2)), ("galleon (3)", *_s(3)), ("English (4)", *_s(4)), ("battle (5)", *_s(5)),
          ("sinking (6)", *_s(6)), ("rowboat (7)", *_s(7)), ("search+diver (8)", *_s(8)), ("ROV (9)", *_s(9)), ("tug (10)", *_s(10)),
          ("tug->wreck (11)", _s(11)[0], T.DUR)]


def log(*a):
    print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)


def src_hash(files, extra=""):
    h = hashlib.md5(extra.encode())
    for f in files:
        h.update(open(os.path.join(HERE, f), "rb").read())
    return h.hexdigest()[:10]


def cached(name, key, fn):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, f"{name}_{key}.npy")
    if os.path.exists(p):
        log("cache hit", name, key)
        return np.load(p).astype(np.float64), True
    x = fn()
    np.save(p, np.asarray(x, np.float32))
    return x, False


# ================================================================ voice
def load_voice():
    x, sr = read_wav(VOICE)
    assert sr == SR, sr
    v = x[0] if x.shape[0] == 1 else x.mean(0)
    out = np.zeros(N)
    out[: min(N, len(v))] = v[:N]
    return st(out), len(v)


def speech_spans(words, merge=0.3):
    sp = []
    for w in words:
        s, e = w["s"], w["e"]
        if sp and s - sp[-1][1] < merge:
            sp[-1][1] = max(sp[-1][1], e)
        else:
            sp.append([s, e])
    return sp


def duck_db(spans, depth=DUCK_DB, pre=0.08, post=0.12, att=0.07, rel=0.45):
    ctrl = 1000
    nc = int(T.DUR * ctrl) + 2
    va = np.zeros(nc)
    for s, e in spans:
        va[max(0, int((s - pre) * ctrl)): int((e + post) * ctrl)] = 1.0
    ka, kr = 1 - np.exp(-1 / (att * ctrl)), 1 - np.exp(-1 / (rel * ctrl))
    env = np.zeros(nc)
    e = 0.0
    for i in range(nc):
        tgt = va[i]
        e += (tgt - e) * (ka if tgt > e else kr)
        env[i] = e
    return np.interp(np.arange(N) / SR, np.arange(nc) / ctrl, depth * env)


# ================================================================ music level automation
def section_db(m_ducked, v):
    import music
    gains = {}
    curve = np.zeros(N)
    t = np.arange(N) / SR
    for name, a, b in music.SECTIONS:
        seg = slice(ns(a), ns(b))
        Lm, Lv = integrated(m_ducked[:, seg]), integrated(v[:, seg])
        gains[name] = (Lv + MUSIC_TARGET[name] - Lm) if (np.isfinite(Lm) and np.isfinite(Lv)) else 0.0
        curve[t >= a] = gains[name]
    curve = ndimage.uniform_filter1d(curve, ns(0.3), mode="nearest")
    for a, b, db in DIPS:
        d = np.zeros(N)
        d[ns(a): ns(b)] = db
        curve += ndimage.uniform_filter1d(d, ns(0.08), mode="nearest")
    return curve, gains


# ================================================================ limiter
def limiter(x, ceil_db=CEIL_DBTP, look=0.003, rel=0.08):
    """4x-oversampled peak detection, look-ahead min filter, release one-pole, centred smoothing -> gain curve"""
    c = dbg(ceil_db)
    n = x.shape[1]
    up = np.abs(signal.resample_poly(x, 4, 1, axis=-1)).max(0)
    pk = np.pad(up, (0, max(0, 4 * n - len(up))))[: 4 * n].reshape(n, 4).max(1)
    gr = np.minimum(1.0, c / np.maximum(pk, 1e-12))
    La = max(1, ns(look))
    g1 = ndimage.minimum_filter1d(gr, 2 * La + 1, mode="nearest")
    g2 = g1.copy()
    idx = np.flatnonzero(g1 < 1.0)
    if len(idx):
        kr = 1 - np.exp(-1 / (rel * SR))
        gap = ns(rel * 8)
        brk = np.flatnonzero(np.diff(idx) > gap)
        starts = np.concatenate([[idx[0]], idx[brk + 1]])
        ends = np.concatenate([idx[brk], [idx[-1]]])
        for a, b_ in zip(starts, ends):
            e = min(n, b_ + gap)
            seg = g1[a:e]
            out = np.empty(len(seg))
            g = 1.0
            for k in range(len(seg)):
                g = min(seg[k], g + (1 - g) * kr)
                out[k] = g
            g2[a:e] = out
    g3 = ndimage.uniform_filter1d(g2, 2 * La + 1, mode="nearest")
    g3 = np.minimum(g3, 1.0)
    return x * g3[None, :], g3


# ================================================================ report helpers
def lufs(x):
    v = integrated(x)
    return v if np.isfinite(v) else -99.0


def section_table(v, m, s, words):
    Mv, Mb = momentary(v), momentary(m + s)
    tc = np.arange(len(Mv)) * 0.01 + 0.2
    speak = np.zeros(len(tc), bool)
    for w in words:
        speak |= (tc >= w["s"] + 0.03) & (tc <= w["e"] - 0.03)
    speak &= Mv > lufs(v) - 10
    rows = []
    for name, a, b in REPORT:
        seg = slice(ns(a), ns(b))
        Lv, Lm, Ls, Lb = lufs(v[:, seg]), lufs(m[:, seg]), lufs(s[:, seg]), lufs(m[:, seg] + s[:, seg])
        k = speak & (tc >= a) & (tc < b) & np.isfinite(Mb) & (Mb > -70)
        p10 = float(np.percentile(Mv[k] - Mb[k], 10)) if k.sum() > 5 else float("nan")
        med = float(np.median(Mv[k] - Mb[k])) if k.sum() > 5 else float("nan")
        rows.append((name, a, b, Lv, Lm, Ls, Lb, Lv - Lb, p10, med))
    return rows


def worst_words(v, m, s, words, k=8):
    """per spoken word: voice momentary minus bed momentary at the word's loudest 400 ms window (lowest first)"""
    Mv, Mb = momentary(v), momentary(m + s)
    out = []
    for w in words:
        i0 = max(0, int((w["s"] - 0.2) / 0.01))
        i1 = min(len(Mv), max(i0 + 1, int((w["e"] - 0.2) / 0.01)))
        if i0 < len(Mv):
            i = i0 + int(np.argmax(Mv[i0:i1]))
            out.append((Mv[i] - Mb[i], w["w"], w["s"]))
    return sorted(out)[:k]


def ffmpeg_ebur(path):
    try:
        r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                           capture_output=True, text=True, timeout=300)
        txt = r.stderr
        i = txt.rfind("Summary:")
        if i < 0:
            return txt[-1500:]
        out = []
        for line in txt[i:].splitlines():
            out.append(line.rstrip())
            if line.strip().startswith("Peak:"):
                break
        return chr(10).join(l for l in out if l)
    except Exception as e:  # noqa
        return f"ffmpeg check failed: {e}"


def ffprobe_samples(path):
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
                            "stream=sample_rate,channels,bits_per_raw_sample,bits_per_sample,codec_name,duration_ts,duration",
                            "-of", "default=nw=1", path], capture_output=True, text=True, timeout=60)
        return r.stdout.strip().replace("\n", ", ")
    except Exception as e:  # noqa
        return f"ffprobe failed: {e}"


# ================================================================ main
def main():
    t_start = time.time()
    os.makedirs(OUT, exist_ok=True)
    words = T.words(WORDS)
    spans = speech_spans(words)
    v, n_voice = load_voice()
    v_ref = integrated(v)
    log(f"voice: {n_voice} samples ({n_voice / SR:.3f} s), {v_ref:.2f} LUFS (as stereo), TP {true_peak(v):.2f} dBTP")

    # ---------------- music
    import music
    b = music.build()
    mkey = src_hash(["dsp.py", "instruments.py", "timeline.py", "music.py"])
    m_raw, _ = cached("music_raw", mkey, lambda: music.render(b, ref=-20.0)[0])
    log("music rendered", f"{lufs(m_raw):.2f} LUFS raw")
    dk = duck_db(spans)
    m_d = m_raw * dbg(dk)[None, :]
    sec_curve, sec_gains = section_db(m_d, v)
    m = m_d * dbg(sec_curve)[None, :]

    # ---------------- sfx
    import sfx
    skey = src_hash(["dsp.py", "sfx_gen.py", "timeline.py", "sfx.py"], f"{v_ref:.3f}")
    holder = {}

    def _s():
        out, C = sfx.render(v_ref)
        holder["C"] = C
        return out
    s_st, hit = cached("sfx", skey, _s)
    mpath = os.path.join(CACHE, f"sfx_{skey}.json")
    if hit:
        C = sfx.cues()
        meas = json.load(open(mpath)) if os.path.exists(mpath) else []
        for c, mv in zip(C, meas + [None] * len(C)):
            c.measured = mv
    else:
        C = holder["C"]
        json.dump([c.measured for c in C], open(mpath, "w"))
    sd = np.zeros(N)
    for a, b_, db in SFX_DIPS:
        d = np.zeros(N)
        d[ns(a): ns(b_)] = db
        sd += ndimage.uniform_filter1d(d, ns(0.08), mode="nearest")
    s_st = s_st * dbg(sd)[None, :]
    log("sfx rendered", f"{lufs(s_st):.2f} LUFS, {len(C)} cues")

    # ---------------- master
    mix0 = v + m + s_st
    G = TARGET_LUFS - lufs(mix0)
    for it in range(6):
        y, g3 = limiter(mix0 * dbg(G))
        L = lufs(y)
        log(f"master iter {it}: gain {G:+.2f} dB -> {L:.2f} LUFS, TP {true_peak(y):.2f} dBTP, max GR {-20 * np.log10(g3.min()):.2f} dB")
        if abs(L - TARGET_LUFS) < 0.02:
            break
        G += TARGET_LUFS - L
    y = fades(y, 0.0, 0.03)
    assert y.shape == (2, N), y.shape
    gv, gm, gs = v * dbg(G), m * dbg(G), s_st * dbg(G)
    mix_path = os.path.join(OUT, "mix.wav")
    write_wav(mix_path, y)
    write_wav(os.path.join(OUT, "stem_voice.wav"), gv)
    write_wav(os.path.join(OUT, "stem_music.wav"), gm)
    write_wav(os.path.join(OUT, "stem_sfx.wav"), gs)
    log("wrote mix + stems to", OUT)

    # ---------------- measure
    I_, TP, LRA = lufs(y), true_peak(y), lra(y)
    Mmax, Smax = float(np.max(momentary(y))), float(np.max(short_term(y)))
    grdb = -20 * np.log10(g3)
    gr_stats = dict(max=float(grdb.max()), pct_over_0_5=float((grdb > 0.5).mean() * 100), pct_over_0_1=float((grdb > 0.1).mean() * 100))
    peaks = {k: 20 * np.log10(np.abs(x).max() + 1e-12) for k, x in (("voice", gv), ("music", gm), ("sfx", gs))}
    rows = section_table(gv, gm, gs, words)
    ww = worst_words(gv, gm, gs, words)
    eb = ffmpeg_ebur(mix_path)
    probe = ffprobe_samples(mix_path)
    stats = dict(I=I_, TP=TP, LRA=LRA, Mmax=Mmax, Smax=Smax, G=G, gr=gr_stats, peaks=peaks, v_ref=v_ref,
                 voice_I=lufs(gv), music_I=lufs(gm), sfx_I=lufs(gs), sec_gains=sec_gains, n=y.shape[1], probe=probe)
    log(json.dumps({k: (round(v_, 2) if isinstance(v_, float) else v_) for k, v_ in stats.items() if k not in ("gr", "peaks", "sec_gains")}))
    log("GR", {k: round(v_, 2) for k, v_ in gr_stats.items()}, "stem peaks dBFS", {k: round(p, 2) for k, p in peaks.items()})
    log("section gains", {k: round(v_, 1) for k, v_ in sec_gains.items()})
    for r in rows:
        log(f"{r[0]:<17} voice {r[3]:6.1f}  music {r[4]:6.1f}  sfx {r[5]:6.1f}  bed {r[6]:6.1f}  margin {r[7]:5.1f}  speech med {r[9]:5.1f} p10 {r[8]:5.1f}")
    log("tightest words (voice - bed at each word's loudest window):", ", ".join(f"{w}@{s:.2f} {d:+.1f}" for d, w, s in ww))
    print(eb)
    print(probe)
    write_cues(C, b, stats, rows, ww, eb, v_ref, G)
    log(f"done in {time.time() - t_start:.0f} s")


def write_cues(C, b, st_, rows, ww, eb, v_ref, G):
    import music
    vI = v_ref + G
    L = []
    w = L.append
    w("# El galeon San Jose (1708) - soundtrack cue sheet")
    w("")
    w("All sound is original: synthesized in numpy/scipy (`audio/galeon/`: `sfx_gen.py` + `instruments.py` + `dsp.py` copied from the "
      "cartoon-3d-short template unchanged; `sfx.py` / `music.py` / `timeline.py` / `mix.py` written for this short).")
    w(f"Voice = `public/{NAME}/voice.wav`, gain only (no EQ, no compression, no pitch). Timeline mirrored from `src/videos/galeon/story.ts` + `cast.ts` "
      "(30 fps, 1260 frames, hard cuts).")
    w("")
    w(f"## Files (`salida/{NAME}/audio/`)")
    w("| file | content |")
    w("|---|---|")
    w(f"| `mix.wav` | final mix, 48 kHz, stereo, 24-bit, {st_['n']:,} samples = {st_['n'] / SR:.3f} s |")
    w("| `stem_voice.wav` / `stem_music.wav` / `stem_sfx.wav` | stems at mix gain (they sum to the mix before the master limiter) |")
    w("")
    w("## Master loudness (own BS.1770-4 meter)")
    w(f"- Integrated **{st_['I']:.1f} LUFS**, true peak **{st_['TP']:.1f} dBTP**, LRA {st_['LRA']:.1f} LU, "
      f"max momentary {st_['Mmax']:.1f} LUFS, max short-term {st_['Smax']:.1f} LUFS")
    w(f"- Stems: voice {st_['voice_I']:.1f} LUFS, music {st_['music_I']:.1f} LUFS, sfx {st_['sfx_I']:.1f} LUFS "
      f"(voice gain {G:+.2f} dB, same gain on every stem)")
    gr = st_["gr"]
    w(f"- Master limiter (4x oversampled look-ahead, ceiling {CEIL_DBTP} dBTP): max gain reduction {gr['max']:.2f} dB, "
      f"active (>0.1 dB) on {gr['pct_over_0_1']:.2f} % of samples, >0.5 dB on {gr['pct_over_0_5']:.2f} %")
    w(f"- ffprobe: {st_['probe']}")
    w("")
    w("ffmpeg ebur128 cross-check:")
    w("```")
    w(eb)
    w("```")
    w("")
    w("## Voice on top: per-shot loudness (LUFS, integrated per stem, at mix gain)")
    w("bed = music + sfx. margin = voice - bed (integrated over the shot). speech median / p10 = median and 10th percentile of "
      "the 400 ms momentary margin (voice - bed) over windows centred on spoken words.")
    w("")
    w("| shot | time s | voice | music | sfx | bed | margin LU | speech median LU | speech p10 LU |")
    w("|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        f = lambda x: "-" if x <= -98 else f"{x:.1f}"
        w(f"| {r[0]} | {r[1]:.2f}-{r[2]:.2f} | {f(r[3])} | {f(r[4])} | {f(r[5])} | {f(r[6])} | {r[7]:.1f} | {r[9]:.1f} | {r[8]:.1f} |")
    w("")
    w("Tightest words (voice minus bed, 400 ms momentary at each word's loudest window): " + ", ".join(f"'{x}' {s:.2f} s {d:+.1f} LU" for d, x, s in ww) + ".")
    w("")
    w("## Music map (original score, D minor / D major)")
    w("Music target per section, LU under the voice (after a -3 dB speech duck keyed from words.json): " +
      ", ".join(f"{k} {v:+.1f}" for k, v in MUSIC_TARGET.items()) + ". Applied section gains (dB): " +
      ", ".join(f"{k} {v:+.1f}" for k, v in st_["sec_gains"].items()) + ".")
    w("")
    w("Sections: " + ", ".join(f"{n} {a:.2f}-{b_:.2f}" for n, a, b_ in music.SECTIONS) + ".")
    w("")
    w("Rides (music only, dB): " + ", ".join(f"{a:.2f}-{b_:.2f} s {db:+.1f}" for a, b_, db in DIPS) +
      " - so quiet words stay on top. SFX rides: " + ", ".join(f"{a:.2f}-{b_:.2f} s {db:+.1f}" for a, b_, db in SFX_DIPS) + ".")
    w("")
    w("| time s | frame | music |")
    w("|---|---|---|")
    for t, d in sorted(b.cues):
        w(f"| {t:.2f} | {int(round(t * T.FPS))} | {d} |")
    w("")
    w("## SFX events")
    w(f"Level convention: every EVENT has a naive level (LU vs the voice stem, as the event's max momentary loudness); "
      f"applied = naive - 6 dB (standard mix rule) + distance offsets. BEDS are integrated loudness, not reduced. "
      f"'mix LUFS' = the event's max momentary loudness in the final mix (voice stem = {vI:.1f} LUFS integrated). "
      f"Under-water cues are low-passed and go to a dark 1.7 s 'water' reverb; surface cues to a short 'air' reverb; each return "
      f"is gated to the shots of its own place. Impacts land 1 frame before their picture frame.")
    w("")
    w(f"Note: the English broadside is laid on frame {T.ENG_FIRE_FRAME} as briefed; `cast.ts` currently fires it at kickFrames[1] "
      f"= frame 456 (set `ENG_FIRE_FRAME` in timeline.py and re-run mix.py if the picture keeps 456).")
    w("")
    w("| # | time s | frame | cue | what | naive LU | applied LU | mix LUFS | pan |")
    w("|---|---|---|---|---|---|---|---|---|")
    for i, c in enumerate(sorted(C, key=lambda c: (c.t, c.name))):
        kind = " (bed, integrated)" if c.kind == "bed" else ""
        meas = c.measured if c.measured is not None else c.applied
        w(f"| {i + 1} | {c.t:.3f} | {c.t * T.FPS:.1f} | {c.name}{kind} | {c.desc} | {c.naive:+.0f} | {c.applied:+.1f} | {vI + meas:.1f} | {c.p:+.2f} |")
    w("")
    open(os.path.join(OUT, "cues.md"), "w", encoding="utf-8").write("\n".join(L))


if __name__ == "__main__":
    main()
