"""VOLLEY CONTROL: transforms public FIPAV calendar responses into club games.

No historical sample games are inserted by this module. The source must be fetched
from FIPAV when the dashboard operator triggers a sync.
"""
from datetime import datetime
import requests

FIPAV_CALENDAR_API = "https://data.fipavonline.it/api/v2/calendar/0/{}"
SEASON = "2026-2027"
FIPAV_TEAMS = [
    {"team_name": "PVI STUDIO OTTOLINA", "team_id": "229693", "category": "U15 Femminile", "group_id": "63945"},
    {"team_name": "PVI PINUCCÈ", "team_id": "229990", "category": "U17 Femminile", "group_id": "63942"},
]
PGS_TEAM = {"team_name": "PVI ARDOR 2K GIUSSANO", "category": "U11", "source": "PGS Milano", "season": SEASON}
RESULT_FIELDS = {"played", "home_sets", "away_sets", "sets"}
DISPLAY_FIELDS = {
    "date": "Data (AAAA-MM-GG)", "time": "Ora (HH:MM)",
    "category": "Categoria", "home_team": "Squadra casa", "away_team": "Squadra ospite",
    "game_number": "Numero gara", "venue": "Palestra", "address": "Indirizzo",
    "played": "Partita disputata (true/false)", "home_sets": "Set vinti casa",
    "away_sets": "Set vinti ospite", "notes": "Note organizzatore",
    "required_referees": "Numero arbitri richiesti", "required_scorers": "Numero refertisti richiesti",
}


def clean(value):
    return str(value or "").strip()


def parse_date(value):
    value = clean(value)
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    raise ValueError(f"Data FIPAV non riconosciuta: {value!r}")


def parse_time(value):
    value = clean(value).replace(".", ":")
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt).strftime("%H:%M")
        except ValueError:
            pass
    raise ValueError(f"Orario FIPAV non riconosciuto: {value!r}")


def split_venue(value):
    raw = clean(value)
    parts = [p.strip() for p in raw.split(" - ") if p.strip()]
    if len(parts) >= 2:
        return parts[0], " - ".join(parts[1:])
    return raw or "Palestra non indicata", ""


def normalize_fipav(payload, team):
    """Return only actual matches for team ID. Match ID and visible ng differ."""
    data = payload.get("data", payload)
    if not isinstance(data, dict) or not isinstance(data.get("matches"), list):
        raise ValueError("Il calendario FIPAV non contiene 'data.matches' validi.")
    result = []
    seen = set()
    for entry in data["matches"]:
        t1, t2 = entry.get("team1") or {}, entry.get("team2") or {}
        home = clean(t1.get("id")) == clean(team["team_id"])
        away = clean(t2.get("id")) == clean(team["team_id"])
        if not (home or away):
            continue
        match_id = clean(entry.get("id"))
        if not match_id:
            raise ValueError("Gara della nostra squadra senza identificativo FIPAV.")
        key = f"FIPAV:{SEASON}:{team['group_id']}:{match_id}"
        if key in seen:
            raise ValueError(f"Gara duplicata nel feed FIPAV: {key}")
        seen.add(key)
        venue, address = split_venue(entry.get("stadium"))
        pts1, pts2 = entry.get("pt_a") or [], entry.get("pt_b") or []
        sets = [{"home": int(a), "away": int(b)} for a, b in zip(pts1, pts2)]
        result.append({
            "game_key": key, "source": "FIPAV", "season": SEASON,
            "group_id": clean(team["group_id"]), "official_id": match_id,
            "game_number": clean(entry.get("ng")),
            "category": team["category"], "our_team_id": clean(team["team_id"]),
            "our_team_name": team["team_name"], "is_home": home,
            "home_team": clean(t1.get("title")), "away_team": clean(t2.get("title")),
            "date": parse_date(entry.get("date")), "time": parse_time(entry.get("time")),
            "venue": venue, "address": address,
            "played": bool(entry.get("played")),
            "home_sets": entry.get("team1-setwin"), "away_sets": entry.get("team2-setwin"),
            "sets": sets, "notes": "",
            "required_referees": 1 if home else 0,
            "required_scorers": 1 if home else 0,
        })
    return result


def download_fipav(team, session=None):
    url = FIPAV_CALENDAR_API.format(team["group_id"])
    requester = session or requests
    response = requester.get(url, timeout=25, headers={"Accept": "application/json", "User-Agent": "VolleyControl/0.4"})
    response.raise_for_status()
    return normalize_fipav(response.json(), team)


def coverage(game, refs=(), scorers=()):
    if not game["is_home"] and int(game.get("required_referees", 0)) == 0 and int(game.get("required_scorers", 0)) == 0:
        return "Trasferta"
    missing_refs = max(0, int(game.get("required_referees", 0)) - len(refs))
    missing_scorers = max(0, int(game.get("required_scorers", 0)) - len(scorers))
    if missing_refs and missing_scorers:
        return "Arbitro e refertista mancanti"
    if missing_refs:
        return "Arbitro mancante"
    if missing_scorers:
        return "Refertista mancante"
    return "Completa"


def week_start(date_value):
    from datetime import date, timedelta
    d = date.fromisoformat(date_value) if isinstance(date_value, str) else date_value
    return d - timedelta(days=d.weekday())


def week_label(start):
    from datetime import timedelta
    end = start + timedelta(days=6)
    return f"GARE {start:%d/%m} – {end:%d/%m}"