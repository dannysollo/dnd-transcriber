"""
stats_pdf.py
The campaign Stats page as a typeset PDF, in the journal look (DESIGN.md).

Built as HTML/CSS with inline SVG and rendered by WeasyPrint: a leather front
cover with the gilt title block, then journal-paper pages with the totals,
records, player profiles (with share-of-talk trend lines) and the bar charts.
Charts are direct-labeled because paper has no hover.
"""
from datetime import datetime
from html import escape
from pathlib import Path

FONTS = Path(__file__).parent / "fonts"
SPEECH_WPM = 160

D20 = ('<svg viewBox="0 0 48 48" width="{s}" height="{s}" fill="none" stroke="#D8BC85" stroke-width="{w}" '
       'stroke-linejoin="round" stroke-linecap="round"><path d="M24 3 42.2 13.5 42.2 34.5 24 45 5.8 34.5 5.8 13.5Z"/>'
       '<path d="M24 13 35 32 13 32Z"/><path d="M24 3 24 13M5.8 13.5 24 13 42.2 13.5M5.8 13.5 13 32 5.8 34.5M42.2 13.5 35 32 42.2 34.5M13 32 24 45 35 32"/></svg>')
GILT_RULE = ('<svg viewBox="0 0 220 12" width="200" height="11"><g stroke="#D8BC85" stroke-width="1" fill="none">'
             '<path d="M0 4.5h96M0 7.5h96M124 4.5h96M124 7.5h96"/><path d="M110 1.5 116 6l-6 4.5L104 6Z" fill="#D8BC85"/></g></svg>')


def _dur(seconds: float) -> str:
    h, m = int(seconds // 3600), round((seconds % 3600) / 60)
    if h == 0:
        return f"{m} min"
    return f"{h} h" if m == 0 else f"{h} h {m} min"


def _pct(share: float) -> str:
    return f"{round(share * 100)}%"


def _list(xs: list[str]) -> str:
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1] if xs else ""


def _bars(rows: list[tuple[str, float, str]]) -> str:
    """Horizontal single-hue bars; label left, value at the tip."""
    top = max((v for _, v, _ in rows), default=1) or 1
    out = ['<div class="bars">']
    for label, value, display in rows:
        pct = max(0.5, value / top * 100)
        out.append(
            f'<div class="bar-row"><div class="bar-label">{escape(label)}</div>'
            f'<div class="bar-track"><div class="bar" style="width:calc((100% - 34mm) * {pct / 100:.4f})"></div>'
            f'<span class="bar-value">{escape(display)}</span></div></div>'
        )
    out.append("</div>")
    return "".join(out)


def _trend(points: list[float | None], max_share: float) -> str:
    W, H, P = 300, 56, 7
    n = len(points)
    x = lambda i: W / 2 if n <= 1 else P + i * (W - 2 * P) / (n - 1)
    y = lambda v: H - P - min(v, max_share) / (max_share or 1) * (H - 2 * P)
    d, pen, dots = "", False, []
    for i, v in enumerate(points):
        if v is None:
            pen = False
            continue
        d += f"{'L' if pen else 'M'}{x(i):.1f} {y(v):.1f} "
        pen = True
        dots.append(f'<circle cx="{x(i):.1f}" cy="{y(v):.1f}" r="3.2" fill="#9E2B25" stroke="#F5F0E6" stroke-width="1.6"/>')
    return (f'<svg viewBox="0 0 {W} {H}" width="62mm" height="12mm">'
            f'<line x1="0" x2="{W}" y1="{H - P}" y2="{H - P}" stroke="#BFAF93" stroke-width="0.8"/>'
            f'<path d="{d}" fill="none" stroke="#9E2B25" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>'
            f'{"".join(dots)}</svg>')


def _clock(seconds: int) -> str:
    return f"{seconds // 3600}:{seconds % 3600 // 60:02d}"


def _pace(rows: list[dict]) -> str:
    """Words a minute per half hour, full width, with the busiest and quietest named."""
    W, H, P = 600, 70, 7
    vals = [r["wpm"] for r in rows]
    top = max(vals) * 1.1 or 1
    n = len(vals)
    x = lambda i: P + i * (W - 2 * P) / (n - 1)
    y = lambda v: H - P - v / top * (H - 2 * P)
    d = " ".join(f"{'L' if i else 'M'}{x(i):.1f} {y(v):.1f}" for i, v in enumerate(vals))
    dots = "".join(f'<circle cx="{x(i):.1f}" cy="{y(v):.1f}" r="3.2" fill="#9E2B25" stroke="#F5F0E6" stroke-width="1.6"/>' for i, v in enumerate(vals))
    hi = max(rows, key=lambda r: r["wpm"])
    lo = min(rows, key=lambda r: r["wpm"])
    span = lambda r: f"{_clock(r['start'])}–{_clock(r['start'] + 1800)}"
    return (f'<p class="note">Busiest at {span(hi)} ({hi["wpm"]} words a minute), quietest at {span(lo)} ({lo["wpm"]}).</p>'
            f'<svg viewBox="0 0 {W} {H}" width="170mm" height="{170 * H / W:.1f}mm">'
            f'<line x1="0" x2="{W}" y1="{H - P}" y2="{H - P}" stroke="#BFAF93" stroke-width="0.8"/>'
            f'<path d="{d}" fill="none" stroke="#9E2B25" stroke-width="1.8" stroke-linejoin="round"/>{dots}</svg>'
            f'<div class="axis"><span>{_clock(rows[0]["start"])}</span><span>{_clock(rows[-1]["start"] + 1800)}</span></div>')


def _attendance(profiles: list[dict], sessions: int) -> str:
    head = "".join(f"<th>{i + 1}</th>" for i in range(sessions))
    rows = []
    for p in profiles:
        cells = "".join(f'<td><span class="{"gap" if s["share"] is None else "mark"}"></span></td>' for s in p["share_by_session"])
        missed = sum(1 for s in p["share_by_session"] if s["share"] is None)
        rows.append(f'<tr><th class="who">{escape(p["person"])}</th>{cells}<td>{missed}</td></tr>')
    return f'<table class="attendance"><tr><th></th>{head}<th>Missed</th></tr>{"".join(rows)}</table>'


def _latest(profile: dict) -> str:
    last = next((s["share"] for s in reversed(profile["share_by_session"]) if s["share"] is not None), None)
    return f", latest {_pct(last)}" if last is not None else ""


def _records(r: dict) -> list[tuple[str, str, str, str | None]]:
    out = []
    if (x := r.get("longest_monologue")):
        out.append(("Longest unbroken dialogue", f"{_dur(x['seconds'])} from {x['person']}",
                    f"{x['words']:,} words without a break, {x['session']} at {x['ts']}", x.get("excerpt")))
    if (x := r.get("longest_overall_speech")) and x["words"] > (r.get("longest_monologue") or {}).get("words", 0):
        how = f"through {x['interjections']} short interjection{'s' if x['interjections'] != 1 else ''}" if x["interjections"] else "through short pauses"
        out.append(("Longest overall speech", f"{_dur(x['seconds'])} from {x['person']}",
                    f"{x['words']:,} words {how}, {x['session']} at {x['ts']}", x.get("excerpt")))
    if (x := r.get("biggest_night")):
        out.append(("Biggest night", f"{x['person']}, {_dur(x['seconds'])}", f"{x['words']:,} words in {x['session']}", None))
    if (x := r.get("chattiest_session")):
        out.append(("Chattiest session", f"{x['words_per_minute']} words a minute", x["session"], None))
    if (x := r.get("liveliest_exchange")):
        out.append(("Liveliest exchange", f"{x['turns']} turns in one minute",
                    f"{x['speakers']} people talking over each other, {x['session']} at {x['ts']}", None))
    if (x := r.get("longest_silence")):
        out.append(("Longest silence", f"{x['seconds']} seconds", f"broken by {x['broken_by']}, {x['session']} at {x['ts']}", None))
    if (x := r.get("quiet_ones_best_night")):
        out.append(("The quiet one's best night", f"{x['person']}, {_pct(x['share'])} of the talk",
                    f"usually {_pct(x['usual_share'])}; in {x['session']}", None))
    if (x := r.get("most_curious")):
        out.append(("Most curious", x["person"], f"{x['questions']:,} questions asked", None))
    if (x := r.get("funniest_night")):
        out.append(("Funniest night", x["session"], f"{x['laughs']} laughs written into the transcript", None))
    if (x := r.get("name_dropper")):
        out.append(("Name-dropper", x["person"], f"{x['names']} different names from the wiki, the most of any player", None))
    if (x := r.get("crunchiest_night")):
        out.append(("Crunchiest night", x["session"], f"{_pct(x['share'])} of the talk about rules and dice, against {_pct(x['average_share'])} on average", None))
    if (x := r.get("rules_lawyer")):
        out.append(("Rules lawyer", x["person"], f"{_pct(x['share'])} of their talk is about rules and dice, the most of any player", None))
    if (x := r.get("nat20s")):
        out.append(("Nat 20s", f"{x['total']} called out", f"{x['person']} called the most, {x['count']}", None))
    if (x := r.get("most_quoted")):
        out.append(("Most quoted", x["person"], f"{x['quoted']} line{'s' if x['quoted'] != 1 else ''} saved to Quotes", None))
    return out


CSS = """
@font-face { font-family: 'Journal'; src: url('{normal}') format('woff2'); font-weight: 400 800; }
@font-face { font-family: 'Journal'; src: url('{italic}') format('woff2'); font-weight: 400 800; font-style: italic; }
@page { size: A4; margin: 22mm 20mm 20mm; background: #F5F0E6;
  @top-left { content: string(campaign); font: 9.5pt 'Journal'; font-variant: small-caps; letter-spacing: .06em; color: #716250; }
  @top-right { content: "statistics"; font: 9.5pt 'Journal'; font-variant: small-caps; letter-spacing: .06em; color: #716250; }
  @bottom-center { content: counter(page); font: 10pt 'Journal'; color: #716250; }
}
@page cover { margin: 0; background: #2A1E17; @top-left { content: none; } @top-right { content: none; } @bottom-center { content: none; } }
html { font-family: 'Journal', Garamond, serif; font-size: 11pt; color: #2B2622; line-height: 1.5; font-variant-numeric: lining-nums; }
body { margin: 0; }
.cover { page: cover; height: 297mm; padding: 14mm; box-sizing: border-box; }
.frame { height: 100%; box-sizing: border-box; border: 0.35mm solid #D8BC85; outline: 0.25mm solid rgba(216,188,133,.55); outline-offset: 2.2mm;
  display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #E7D5B3; }
.cover h1 { string-set: campaign content(); font-size: 40pt; font-weight: 500; line-height: 1.05; color: #D8BC85; margin: 8mm 12mm 3mm; }
.cover .kind { font-size: 15pt; font-variant: small-caps; letter-spacing: .12em; color: #A89170; margin-bottom: 5mm; }
.cover .facts { font-size: 13pt; margin-top: 6mm; }
.cover .compiled { font-size: 10.5pt; color: #A89170; margin-top: 3mm; }
.cover .mark { white-space: nowrap; margin-top: 18mm; font-size: 11pt; font-variant: small-caps; letter-spacing: .1em; color: #A89170; display: flex; align-items: center; gap: 2.5mm; }
h2 { font-size: 15pt; font-weight: 600; font-variant: small-caps; letter-spacing: .05em; color: #9E2B25; border-bottom: 0.25mm solid #D8CCB6;
  padding-bottom: 1mm; margin: 9mm 0 3mm; break-after: avoid; }
h2:first-child { margin-top: 0; }
.lead { font-size: 14pt; line-height: 1.45; margin: 0 0 2mm; }
.note { font-size: 9.5pt; color: #716250; margin: 0 0 3mm; break-after: avoid; }
.keep { break-inside: avoid; }
.records { display: grid; grid-template-columns: 1fr 1fr; column-gap: 9mm; }
.record { border-bottom: 0.25mm solid #D8CCB6; padding: 2.5mm 0 2mm; break-inside: avoid; }
.record .label { font-size: 10pt; font-variant: small-caps; letter-spacing: .05em; color: #9E2B25; font-weight: 600; }
.record .value { font-size: 14pt; line-height: 1.2; }
.record .detail { font-size: 9.5pt; color: #5E5347; }
.record .excerpt { font-size: 10pt; margin-top: 1mm; }
.bars { margin-top: 2mm; }
.bar-row { display: grid; grid-template-columns: 44mm 1fr; column-gap: 4mm; align-items: center; margin-bottom: 1.8mm; break-inside: avoid; }
.bar-label { text-align: right; font-size: 10.5pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar-track { display: flex; align-items: center; gap: 2.5mm; border-left: 0.25mm solid #BFAF93; }
.bar { height: 3.2mm; background: #9E2B25; border-radius: 0 1mm 1mm 0; }
.bar-value { font-size: 10pt; color: #5E5347; white-space: nowrap; }
.profile { display: grid; grid-template-columns: 1fr 64mm; column-gap: 7mm; border-bottom: 0.25mm solid #D8CCB6; padding: 3mm 0 2.5mm; break-inside: avoid; }
.profile .name { font-size: 14pt; }
.profile .chars { font-size: 11pt; font-variant: small-caps; letter-spacing: .05em; color: #9E2B25; font-weight: 600; margin-left: 2.5mm; }
.profile p { margin: .6mm 0; font-size: 10pt; color: #5E5347; }
.profile b { color: #2B2622; font-weight: 600; }
.trend-cap { font-size: 8.5pt; color: #716250; }
.axis { display: flex; justify-content: space-between; width: 170mm; font-size: 8.5pt; color: #716250; }
.attendance { border-collapse: collapse; font-size: 9.5pt; margin-top: 2mm; }
.attendance th, .attendance td { padding: .8mm 1.4mm; text-align: center; border-bottom: 0.25mm solid #D8CCB6; font-weight: 400; }
.attendance th.who { text-align: right; padding-right: 3mm; white-space: nowrap; }
.attendance .mark, .attendance .gap { display: inline-block; width: 2.6mm; height: 2.6mm; border-radius: .4mm; }
.attendance .mark { background: #9E2B25; }
.attendance .gap { border: 0.25mm solid #BFAF93; }
.trend-end { font-family: 'Journal'; font-size: 11px; fill: #716250; }
"""


def render_stats_pdf(data: dict, campaign_name: str) -> bytes:
    from weasyprint import HTML

    per = data.get("per_session", [])
    dates = sorted(s["created_at"][:10] for s in per if s.get("created_at"))
    fmt = lambda d: datetime.fromisoformat(d).strftime("%B %-d, %Y")
    span = f"{fmt(dates[0])} to {fmt(dates[-1])}" if len(dates) > 1 else (fmt(dates[0]) if dates else "")
    longest = max(per, key=lambda s: s["duration_seconds"]) if per else None

    parts = [f"<style>{CSS.replace('{normal}', (FONTS / 'eb-garamond-wght-normal.woff2').as_uri()).replace('{italic}', (FONTS / 'eb-garamond-wght-italic.woff2').as_uri())}</style>"]
    parts.append(f"""
<section class="cover"><div class="frame">
  {D20.format(s=58, w=1.5)}
  <h1>{escape(campaign_name)}</h1>
  <div class="kind">campaign statistics</div>
  {GILT_RULE}
  <div class="facts">{data['sessions']} session{'s' if data['sessions'] != 1 else ''}, {_dur(data['duration_seconds'])} at the table</div>
  <div class="compiled">{escape(span)}</div>
  <div class="mark">{D20.format(s=14, w=2.4)} compiled by Co-DM, {datetime.now().strftime('%B %-d, %Y')}</div>
</div></section>""")

    parts.append("<h2>At the table</h2>")
    wpm = f" ({round(data['words_per_minute'])} a minute)" if data.get("words_per_minute") else ""
    lead = (f"{data['sessions']} session{'s' if data['sessions'] != 1 else ''} recorded, {_dur(data['duration_seconds'])} "
            f"at the table and {data['words']:,} words spoken{wpm}.")
    if longest:
        lead += f" The longest was {escape(longest['name'])}, at {_dur(longest['duration_seconds'])}."
    parts.append(f'<p class="lead">{lead}</p><p class="note">Talk time is estimated from words spoken, at about {SPEECH_WPM} words a minute. Speeches in each session\'s first 10 minutes (usually the recap) don\'t count as records.</p>')

    recs = _records(data.get("records", {}))
    if recs:
        parts.append('<h2>Records</h2><div class="records">')
        for label, value, detail, excerpt in recs:
            ex = f'<div class="excerpt">“{escape(excerpt)}”</div>' if excerpt else ""
            parts.append(f'<div class="record"><div class="label">{escape(label)}</div><div class="value">{escape(value)}</div>'
                         f'<div class="detail">{escape(detail)}</div>{ex}</div>')
        parts.append("</div>")

    people = data.get("people", [])
    if people:
        parts.append("<h2>Who talks most</h2>")
        parts.append(_bars([(p["person"] + (f" ({', '.join(p['characters'])})" if p["characters"] else ""), p["seconds"],
                             f"{_dur(p['seconds'])}, {_pct(p['share'])}") for p in people]))

    if people:
        parts.append('<h2>Words spoken</h2><p class="note">Words a minute is each person\'s words over every session they were at, so it shows how much they contribute, not how fast they talk.</p>')
        parts.append(_bars([(p["person"], p["words"], f"{p['words']:,}, {round(p.get('words_per_minute') or 0)} a minute") for p in people]))

    profiles = data.get("profiles", [])
    if profiles:
        max_share = max([0.05] + [s["share"] or 0 for p in profiles for s in p["share_by_session"]])
        head = '<h2>Players</h2><p class="note">Share of the table\'s talk, session by session, on the same scale for everyone.</p>'
        for i, p in enumerate(profiles):
            chars = f'<span class="chars">{escape(", ".join(p["characters"]))}</span>' if p["characters"] else ""
            extra = []
            if p["laughs"]:
                extra.append(f"laughed out loud <b>{p['laughs']}</b> times")
            if p["quoted"]:
                extra.append(f"quoted <b>{p['quoted']}</b> time{'s' if p['quoted'] != 1 else ''}")
            quirks = f"Asked <b>{p['questions']:,}</b> questions, exclaimed <b>{p['exclamations']:,}</b> times" + (", " + ", ".join(extra) if extra else "") + "."
            rules = f"<p><b>{_pct(p['rules_share'])}</b> of their talk is about rules and dice.</p>" if p.get("rules_share", 0) >= 0.005 else ""
            names = f"<p>Talks most about {escape(_list([n['name'] for n in p['favorite_names']]))}.</p>" if p["favorite_names"] else ""
            sig = f"<p>Signature words: {escape(_list(['“' + w['word'] + '”' for w in p['signature_words']]))}.</p>" if p["signature_words"] else ""
            block = f"""<div class="profile"><div>
  <div class="name">{escape(p['person'])}{chars}</div>
  <p><b>{p['sessions']}</b> session{'s' if p['sessions'] != 1 else ''}, <b>{_dur(p['seconds'])}</b> of talk, usually <b>{_pct(p['average_share'])}</b> of a session.</p>
  <p>{quirks}</p>{rules}{names}{sig}
</div><div><div class="trend-cap">Share of talk per session{_latest(p)}</div>{_trend([s['share'] for s in p['share_by_session']], max_share)}</div></div>"""
            # The section heading travels with the first profile, never alone at a page foot.
            parts.append(f'<div class="keep">{head}{block}</div>' if i == 0 else block)

    if len(per) > 1 and profiles:
        if any(s["share"] is None for p in profiles for s in p["share_by_session"]):
            parts.append('<div class="keep"><h2>Attendance</h2><p class="note">Sessions numbered in the order they were added.</p>'
                         + _attendance(profiles, len(per)) + "</div>")
        else:
            parts.append('<h2>Attendance</h2><p class="note">Everyone has been at every session.</p>')

    pace = data.get("pace", [])
    if len(pace) > 1:
        parts.append('<div class="keep"><h2>Pace through the night</h2>'
                     '<p class="note">Words a minute in each half hour, averaged over every session that ran that long.</p>'
                     + _pace(pace) + "</div>")

    pairs = data.get("exchanges", [])
    if pairs:
        parts.append('<h2>Who talks to whom</h2><p class="note">How often the conversation passed directly between two people.</p>')
        parts.append(_bars([(f"{e['a']} and {e['b']}", e["count"], f"{e['count']:,}") for e in pairs]))

    if per:
        parts.append('<h2>Session length</h2><p class="note">In the order sessions were added.</p>')
        parts.append(_bars([(s["name"], s["duration_seconds"], _dur(s["duration_seconds"])) for s in per]))

    rules_rows = data.get("rules_by_session", [])
    if len(rules_rows) > 1:
        parts.append('<h2>Rules and dice talk</h2><p class="note">Share of each session\'s talk about checks, saves, damage, spell slots and the like.</p>')
        parts.append(_bars([(r["session"], r["share"], _pct(r["share"])) for r in rules_rows]))

    trends = data.get("name_trends", [])
    if trends and len(per) > 1:
        top = max([1] + [c for t in trends for c in t["counts"]])
        head = '<h2>Names over time</h2><p class="note">Mentions per session, on the same scale for every name.</p>'
        for i, t in enumerate(trends):
            note = {"rising": ", coming up more lately", "fading": ", coming up less lately"}.get(t["trend"] or "", "")
            block = (f'<div class="profile"><div><div class="name">{escape(t["name"])}</div><p>{t["total"]:,} mentions{note}</p></div>'
                     f'<div>{_trend(t["counts"], top)}</div></div>')
            parts.append(f'<div class="keep">{head}{block}</div>' if i == 0 else block)

    mentions = data.get("mentions", [])
    if mentions:
        parts.append('<h2>Most mentioned</h2><p class="note">Names from the campaign wiki, not counting the players and their characters.</p>')
        parts.append(_bars([(m["name"], m["count"], f"{m['count']:,}") for m in mentions]))

    return HTML(string="".join(parts), base_url=str(FONTS)).write_pdf()
