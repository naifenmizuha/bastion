#!/usr/bin/env python3
"""Generate a TeamOps SQL seed from Retrosheet's 2025 Athletics data."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

SOURCE_URL = "https://www.retrosheet.org/downloads/2025/2025csvs.zip"
TEAM_ID = "ATH"
SEASON = "2025"
OWN_TEAM_NAME = "Sacramento Athletics"
SOURCE_FILES = ("allplayers.csv", "gameinfo.csv", "teamstats.csv", "plays.csv")
ATTRIBUTION = (
    "The information used here was obtained free of charge from and is copyrighted by "
    "Retrosheet. Interested parties may contact Retrosheet at 20 Sunset Rd., Newark, DE 19711."
)
TEAM_NAMES = {
    "ANA": "Los Angeles Angels", "ARI": "Arizona Diamondbacks", "ATH": OWN_TEAM_NAME,
    "ATL": "Atlanta Braves", "BAL": "Baltimore Orioles", "BOS": "Boston Red Sox",
    "CHA": "Chicago White Sox", "CHN": "Chicago Cubs", "CIN": "Cincinnati Reds",
    "CLE": "Cleveland Guardians", "COL": "Colorado Rockies", "DET": "Detroit Tigers",
    "HOU": "Houston Astros", "KCA": "Kansas City Royals", "LAN": "Los Angeles Dodgers",
    "MIA": "Miami Marlins", "MIL": "Milwaukee Brewers", "MIN": "Minnesota Twins",
    "NYA": "New York Yankees", "NYN": "New York Mets", "PHI": "Philadelphia Phillies",
    "PIT": "Pittsburgh Pirates", "SDN": "San Diego Padres", "SEA": "Seattle Mariners",
    "SFN": "San Francisco Giants", "SLN": "St. Louis Cardinals", "TBA": "Tampa Bay Rays",
    "TEX": "Texas Rangers", "TOR": "Toronto Blue Jays", "WAS": "Washington Nationals",
}
SEED_TIME = "2025-09-28T23:59:59Z"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("out/athletics-2025.sql"))
    parser.add_argument("--cache-dir", type=Path, default=Path("out/retrosheet/cache"))
    parser.add_argument("--teamops-binary", type=Path, default=Path("out/teamops"))
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--source", default=SOURCE_URL, help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(source: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".zip.tmp")
    temporary.unlink(missing_ok=True)
    request = urllib.request.Request(source, headers={"User-Agent": "bastion-data-prep/1"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open("wb") as output:
            if getattr(response, "status", 200) != 200:
                raise RuntimeError(f"download failed with HTTP {response.status}")
            shutil.copyfileobj(response, output)
        with zipfile.ZipFile(temporary) as archive:
            bad = archive.testzip()
            if bad:
                raise RuntimeError(f"downloaded ZIP failed CRC validation at {bad}")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def load_csv(archive: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    members = {Path(member).name.lower(): member for member in archive.namelist()}
    if name not in members:
        raise ValueError(f"source ZIP is missing {name}")
    with archive.open(members[name]) as raw:
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
        reader = csv.DictReader(text)
        if not reader.fieldnames:
            raise ValueError(f"{name} has no header")
        return [{key: (value or "").strip() for key, value in row.items() if key} for row in reader]


def regular(value: str) -> bool:
    normalized = value.lower().replace("-", "").replace("_", "").replace(" ", "")
    return normalized in {"regular", "regularseason"}


def sql(value: object | None) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def export_schema_statements(teamops_binary: Path) -> tuple[list[str], int]:
    binary = teamops_binary.resolve()
    if not binary.is_file():
        raise FileNotFoundError(f"teamops binary does not exist: {binary}")
    with tempfile.TemporaryDirectory() as directory:
        database = Path(directory) / "schema.db"
        subprocess.run(
            [str(binary), "--db", str(database), "schema", "init"],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        connection = sqlite3.connect(database)
        try:
            business_rows = connection.execute(
                "SELECT (SELECT count(*) FROM teams) + (SELECT count(*) FROM app_config)"
            ).fetchone()[0]
            if business_rows != 0:
                raise ValueError("schema init unexpectedly created business rows")
            version = connection.execute(
                "SELECT version FROM schema_meta WHERE id=1"
            ).fetchone()[0]
            rows = connection.execute(
                """
                SELECT sql FROM sqlite_master
                WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
                ORDER BY CASE type
                    WHEN 'table' THEN 0
                    WHEN 'index' THEN 1
                    WHEN 'trigger' THEN 2
                    ELSE 3
                END, name
                """
            ).fetchall()
        finally:
            connection.close()
    statements = [statement.rstrip().rstrip(";") + ";" for (statement,) in rows]
    statements.append(
        f"INSERT INTO schema_meta(id,version,updated_at) VALUES(1,{int(version)},{sql(SEED_TIME)});"
    )
    return statements, int(version)


def integer(row: dict[str, str], key: str) -> int:
    value = row.get(key, "")
    return int(value) if value else 0


def truthy(value: str) -> bool:
    return value.lower() in {"1", "y", "yes", "true", "t", "h"}


def player_name(row: dict[str, str]) -> str:
    return " ".join(part for part in (row.get("first", ""), row.get("last", "")) if part).strip()


def hand_bits(value: str) -> int:
    return {"L": 1, "R": 2, "B": 3}.get(value.upper(), 3)


def position_bits(row: dict[str, str]) -> int:
    bits = 0
    for column, bit in (("g_p", 1), ("g_c", 2), ("g_1b", 4), ("g_2b", 8),
                        ("g_3b", 16), ("g_ss", 32), ("g_lf", 64), ("g_cf", 64), ("g_rf", 64), ("g_of", 64)):
        if integer(row, column) > 0:
            bits |= bit
    return bits or 64


def date_text(value: str) -> str:
    return f"{value[:4]}-{value[4:6]}-{value[6:8]}" if len(value) == 8 and "-" not in value else value


def time_text(value: str) -> str | None:
    if not value:
        return None
    if ":" in value:
        parts = value.split(":")
        if len(parts) != 2 or not all(part.isdigit() for part in parts):
            raise ValueError(f"invalid start time {value!r}")
        hour, minute = map(int, parts)
    elif value.isdigit() and len(value) in {3, 4}:
        padded = value.zfill(4)
        hour, minute = int(padded[:2]), int(padded[2:])
    else:
        raise ValueError(f"invalid start time {value!r}")
    if hour > 23 or minute > 59:
        raise ValueError(f"invalid start time {value!r}")
    return f"{hour:02d}:{minute:02d}"


def referenced_players(teamstats: list[dict[str, str]], plays: list[dict[str, str]]) -> set[tuple[str, str]]:
    references: set[tuple[str, str]] = set()
    for row in teamstats:
        for column in [*(f"start_l{i}" for i in range(1, 11)), *(f"start_f{i}" for i in range(1, 11))]:
            if row.get(column):
                references.add((row["team"], row[column]))
    for row in plays:
        batting, fielding = row.get("batteam", ""), row.get("pitteam", "")
        for column in ("batter", "br1_pre", "br2_pre", "br3_pre", "br1_post", "br2_post", "br3_post", "run_b", "run1", "run2", "run3"):
            if row.get(column):
                references.add((batting, row[column]))
        for column in ("pitcher", "pivot", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "prun_b", "prun1", "prun2", "prun3"):
            if row.get(column):
                references.add((fielding, row[column]))
    return references


def own_bats_top(game: dict[str, str]) -> bool:
    home_first = truthy(game.get("htbf", ""))
    return (game["visteam"] == TEAM_ID and not home_first) or (game["hometeam"] == TEAM_ID and home_first)


def plate_result(play: dict[str, str]) -> int:
    tests = (
        ("single", 0), ("double", 1), ("triple", 2), ("hr", 3), ("walk", 4),
        ("hbp", 5), ("k", 6), ("roe", 9), ("fc", 10), ("sh", 11), ("sf", 11),
    )
    for key, result in tests:
        if integer(play, key):
            return result
    if integer(play, "ground"):
        return 7
    if integer(play, "fly") or integer(play, "line"):
        return 8
    return 12


def runner_reason(play: dict[str, str]) -> int:
    for columns, reason in (
        (("sb2", "sb3", "sbh"), 1), (("cs2", "cs3", "csh"), 2),
        (("wp",), 3), (("pb",), 4), (("bk",), 5), (("pko1", "pko2", "pko3"), 6),
        (("e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9"), 7), (("fc",), 8),
    ):
        if any(integer(play, column) for column in columns):
            return reason
    return 0 if integer(play, "pa") or integer(play, "bip") else 9


def event_rows(play: dict[str, str], game_id: int, names: dict[str, str]) -> list[tuple[object, ...]]:
    def name(player_id: str) -> str:
        if not player_id:
            return ""
        if player_id not in names:
            raise ValueError(f"missing allplayers row for referenced player {player_id}")
        return names[player_id]

    inning = integer(play, "inning")
    half = integer(play, "top_bot")
    play_no = integer(play, "pn") or None
    batting_own = play.get("batteam") == TEAM_ID
    batting_team = 0 if batting_own else 1
    fielding_team = 1 - batting_team
    sequence = 1
    result: list[tuple[object, ...]] = []
    batter = name(play.get("batter", ""))
    pitcher = name(play.get("pitcher", ""))
    outs_delta = max(0, integer(play, "outs_post") - integer(play, "outs_pre"))
    batter_out = 0
    if integer(play, "pa"):
        plate = plate_result(play)
        if plate in {6, 7, 8, 11, 12} and outs_delta:
            batter_out = 1
        result.append((game_id, inning, half, play_no, sequence, 0, batter, batting_team, plate,
                       pitcher, play.get("pitches") or play.get("count") or "?", None, None, None,
                       batter_out, 0, "", None, 1, play.get("event", "")))
        sequence += 1

    scored = {play.get(column, "") for column in ("run_b", "run1", "run2", "run3") if play.get(column)}
    run_specs = (("run_b", "ur_b", "rbi_b", "prun_b", 0), ("run1", "ur1", "rbi1", "prun1", 1),
                 ("run2", "ur2", "rbi2", "prun2", 2), ("run3", "ur3", "rbi3", "prun3", 3))
    reason = runner_reason(play)
    for run_column, unearned_column, rbi_column, responsible_column, base_from in run_specs:
        runner_id = play.get(run_column, "")
        if not runner_id:
            continue
        responsible_pitcher = name(play.get(responsible_column, "")) or pitcher
        result.append((game_id, inning, half, play_no, sequence, 1, name(runner_id), batting_team, 1,
                       responsible_pitcher, "", base_from, 4, reason, 0, 1,
                       batter if truthy(play.get(rbi_column, "")) else "", not truthy(play.get(unearned_column, "")),
                       1, play.get("event", "")))
        sequence += 1

    post_bases = {play.get(f"br{base}_post", ""): base for base in (1, 2, 3) if play.get(f"br{base}_post")}
    remaining_outs = max(0, outs_delta - batter_out)
    for base_from in (1, 2, 3):
        runner_id = play.get(f"br{base_from}_pre", "")
        if not runner_id or runner_id in scored:
            continue
        base_to = post_bases.get(runner_id)
        if base_to and base_to > base_from:
            result.append((game_id, inning, half, play_no, sequence, 1, name(runner_id), batting_team, 0,
                           pitcher, "", base_from, base_to, reason, 0, 0, "", None, 1, play.get("event", "")))
            sequence += 1
        elif not base_to and remaining_outs:
            result.append((game_id, inning, half, play_no, sequence, 1, name(runner_id), batting_team, 2,
                           pitcher, "", base_from, None, reason, 1, 0, "", None, 1, play.get("event", "")))
            sequence += 1
            remaining_outs -= 1

    for position in range(1, 10):
        fielder_id = play.get("pitcher", "") if position == 1 else play.get(f"f{position}", "")
        if not fielder_id:
            continue
        for column, field_result in ((f"po{position}", 0), (f"a{position}", 5 if position >= 7 else 1), (f"e{position}", 2)):
            value = integer(play, column)
            if value:
                result.append((game_id, inning, half, play_no, sequence, 2, name(fielder_id), fielding_team,
                               field_result, "", "", None, None, None, 0, 0, "", None, value, play.get("event", "")))
                sequence += 1
    if (integer(play, "gdp") or integer(play, "othdp") or integer(play, "tp")) and play.get("pivot"):
        result.append((game_id, inning, half, play_no, sequence, 2, name(play["pivot"]), fielding_team,
                       3, "", "", None, None, None, 0, 0, "", None, 1, play.get("event", "")))
        sequence += 1
    if integer(play, "pb") and play.get("f2"):
        result.append((game_id, inning, half, play_no, sequence, 2, name(play["f2"]), fielding_team,
                       4, "", "", None, None, None, 0, 0, "", None, 1, play.get("event", "")))
    return result


def generate_sql(
    source_zip: Path,
    schema_statements: list[str] | None = None,
    schema_version: int = 2,
) -> tuple[str, dict[str, int]]:
    with zipfile.ZipFile(source_zip) as archive:
        for required in SOURCE_FILES:
            if Path(required).name.lower() not in {Path(name).name.lower() for name in archive.namelist()}:
                raise ValueError(f"source ZIP is missing {required}")
        games = [row for row in load_csv(archive, "gameinfo.csv")
                 if row.get("season") == SEASON and TEAM_ID in {row.get("visteam"), row.get("hometeam")} and regular(row.get("gametype", ""))]
        if not games:
            raise ValueError(f"no {SEASON} {TEAM_ID} regular-season games found")
        games.sort(key=lambda row: (row.get("date", ""), row.get("gid", "")))
        gids = {row["gid"] for row in games}
        teamstats = [row for row in load_csv(archive, "teamstats.csv") if row.get("gid") in gids and row.get("stattype", "value") == "value"]
        plays = [row for row in load_csv(archive, "plays.csv") if row.get("gid") in gids]
        player_rows = [row for row in load_csv(archive, "allplayers.csv") if row.get("season") == SEASON]
    names = {row["id"]: player_name(row) for row in player_rows if row.get("id") and player_name(row)}
    profiles = {(row.get("team", ""), row["id"]): row for row in player_rows if row.get("id")}
    profiles_by_id = {row["id"]: row for row in player_rows if row.get("id")}
    references = referenced_players(teamstats, plays)
    missing = sorted(player_id for _, player_id in references if player_id not in names)
    if missing:
        raise ValueError(f"missing allplayers row for referenced player {missing[0]}")
    opponents = sorted(({game["visteam"] for game in games} | {game["hometeam"] for game in games}) - {TEAM_ID})
    unknown_teams = [team for team in opponents if team not in TEAM_NAMES]
    if unknown_teams:
        raise ValueError(f"unknown Retrosheet team IDs: {unknown_teams}")

    lines = [
        "-- Generated from Retrosheet 2025 CSV data; do not edit by hand.",
        f"-- Source: {SOURCE_URL}",
        f"-- Source SHA-256: {sha256(source_zip)}",
        f"-- Selection: season={SEASON}, team={TEAM_ID}, game_type=regular-season",
        f"-- {ATTRIBUTION}",
        "-- Standalone TeamOps database initialization; apply only to a new or empty SQLite file.",
        "PRAGMA foreign_keys=ON;",
        "BEGIN IMMEDIATE;",
    ]
    if schema_statements:
        lines.extend(["-- TeamOps schema generated from the current teamops binary.", *schema_statements])
    lines.extend([
        "CREATE TEMP TABLE _athletics_seed_guard(value INTEGER CHECK(value = 1));",
        f"INSERT INTO _athletics_seed_guard(value) SELECT CASE WHEN (SELECT version FROM schema_meta WHERE id=1)={schema_version} AND NOT EXISTS(SELECT 1 FROM app_config) AND NOT EXISTS(SELECT 1 FROM teams) AND NOT EXISTS(SELECT 1 FROM players) AND NOT EXISTS(SELECT 1 FROM games) AND NOT EXISTS(SELECT 1 FROM training_reports) AND NOT EXISTS(SELECT 1 FROM drill_recommendations) AND NOT EXISTS(SELECT 1 FROM lineups) THEN 1 ELSE 0 END;",
        f"INSERT INTO teams(name,created_at,updated_at) VALUES({sql(OWN_TEAM_NAME)},{sql(SEED_TIME)},{sql(SEED_TIME)});",
        f"INSERT INTO app_config(id,own_team_id,initialized_at) VALUES(1,(SELECT id FROM teams WHERE name={sql(OWN_TEAM_NAME)}),{sql(SEED_TIME)});",
    ])
    for team in opponents:
        lines.append(f"INSERT INTO teams(name,created_at,updated_at) VALUES({sql(TEAM_NAMES[team])},{sql(SEED_TIME)},{sql(SEED_TIME)});")
    for ordinal, (team, player_id) in enumerate(sorted(references), 1):
        row = profiles.get((team, player_id), profiles_by_id[player_id])
        opaque_key = "ply_" + hashlib.sha256(f"athletics-2025-player-{ordinal}".encode()).hexdigest()[:32]
        team_id_sql = "(SELECT own_team_id FROM app_config WHERE id=1)" if team == TEAM_ID else f"(SELECT id FROM teams WHERE name={sql(TEAM_NAMES[team])})"
        lines.append(
            "INSERT INTO players(player_key,team_id,name,number,bat_hands,throw_hands,positions,updated_at) VALUES("
            f"{sql(opaque_key)},{team_id_sql},{sql(names[player_id])},0,{hand_bits(row.get('bat',''))},"
            f"{hand_bits(row.get('throw',''))},{position_bits(row)},{sql(SEED_TIME)});"
        )

    game_ids = {game["gid"]: index for index, game in enumerate(games, 1)}
    for game in games:
        visitor_own = game["visteam"] == TEAM_ID
        opponent_id = game["hometeam"] if visitor_own else game["visteam"]
        own_score = integer(game, "vruns" if visitor_own else "hruns")
        opponent_score = integer(game, "hruns" if visitor_own else "vruns")
        raw = json.dumps({"source": "Retrosheet", "gid": game["gid"], "start_time_raw": game.get("starttime", "")}, separators=(",", ":"))
        lines.append(
            "INSERT INTO games(id,date,start_time,opponent,own_team_id,opponent_team_id,batting_side,own_score,opponent_score,is_final,raw,created_at,updated_at) VALUES("
            f"{game_ids[game['gid']]},{sql(date_text(game['date']))},{sql(time_text(game.get('starttime','')))},{sql(TEAM_NAMES[opponent_id])},"
            f"(SELECT own_team_id FROM app_config WHERE id=1),(SELECT id FROM teams WHERE name={sql(TEAM_NAMES[opponent_id])}),"
            f"{0 if own_bats_top(game) else 1},{own_score},{opponent_score},1,{sql(raw)},{sql(SEED_TIME)},{sql(SEED_TIME)});"
        )

    for stat in sorted(teamstats, key=lambda row: (game_ids[row["gid"]], row.get("team", ""))):
        positions = {stat.get(f"start_f{position}", ""): position for position in range(1, 10) if stat.get(f"start_f{position}")}
        for order in range(1, 10):
            player_id = stat.get(f"start_l{order}", "")
            if not player_id:
                continue
            if player_id not in names:
                raise ValueError(f"missing allplayers row for lineup player {player_id}")
            position = positions.get(player_id)
            team = 0 if stat["team"] == TEAM_ID else 1
            lines.append(
                "INSERT INTO game_lineups(game_id,team,player,batting_order,starting_position) VALUES("
                f"{game_ids[stat['gid']]},{team},{sql(names[player_id])},{order},{sql(position)});"
            )

    event_count = 0
    plays.sort(key=lambda row: (game_ids[row["gid"]], integer(row, "pn")))
    for play in plays:
        for event in event_rows(play, game_ids[play["gid"]], names):
            values = list(event)
            for optional_index in (9, 10, 16, 19):
                if values[optional_index] == "":
                    values[optional_index] = None
            lines.append(
                "INSERT INTO game_events(game_id,inning,half,play_no,sequence,event_kind,player,team,result,related_player,pitch_sequence,base_from,base_to,reason,outs_on_play,runs_scored,rbi_player,earned,value,description) VALUES("
                + ",".join(sql(value) for value in values) + ");"
            )
            event_count += 1
    lines.extend([
        "UPDATE game_lineups SET player_id=(SELECT p.id FROM players p JOIN games g ON g.id=game_lineups.game_id WHERE p.team_id=CASE game_lineups.team WHEN 0 THEN g.own_team_id ELSE g.opponent_team_id END AND p.name=game_lineups.player) WHERE player_id IS NULL;",
        "UPDATE game_events SET player_id=(SELECT p.id FROM players p JOIN games g ON g.id=game_events.game_id WHERE p.team_id=CASE game_events.team WHEN 0 THEN g.own_team_id ELSE g.opponent_team_id END AND p.name=game_events.player) WHERE player_id IS NULL;",
        "UPDATE game_events SET related_player_id=(SELECT p.id FROM players p JOIN games g ON g.id=game_events.game_id WHERE p.team_id=CASE game_events.team WHEN 0 THEN g.opponent_team_id ELSE g.own_team_id END AND p.name=game_events.related_player) WHERE related_player_id IS NULL AND related_player IS NOT NULL;",
        "UPDATE game_events SET rbi_player_id=(SELECT p.id FROM players p JOIN games g ON g.id=game_events.game_id WHERE p.team_id=CASE game_events.team WHEN 0 THEN g.own_team_id ELSE g.opponent_team_id END AND p.name=game_events.rbi_player) WHERE rbi_player_id IS NULL AND rbi_player IS NOT NULL;",
        "CREATE TEMP TABLE _athletics_seed_verify(value INTEGER CHECK(value = 1));",
        f"INSERT INTO _athletics_seed_verify(value) SELECT CASE WHEN (SELECT count(*) FROM games)={len(games)} AND (SELECT count(*) FROM game_lineups)={sum(1 for line in lines if line.startswith('INSERT INTO game_lineups'))} AND (SELECT count(*) FROM game_events)={event_count} AND NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check) AND (SELECT integrity_check FROM pragma_integrity_check)='ok' THEN 1 ELSE 0 END;",
        "DROP TABLE _athletics_seed_verify;",
        "DROP TABLE _athletics_seed_guard;", "COMMIT;", ""
    ])
    return "\n".join(lines), {
        "games": len(games), "players": len(references), "lineups": sum(1 for line in lines if line.startswith("INSERT INTO game_lineups")),
        "events": event_count,
    }


def prepare(args: argparse.Namespace) -> tuple[Path, dict[str, int]]:
    output = args.output.resolve()
    if output.exists() and not args.force:
        raise FileExistsError(f"output already exists: {output}; pass --force to replace it")
    cache = args.cache_dir.resolve() / "2025csvs.zip"
    if args.refresh or not cache.exists():
        download(args.source, cache)
    schema_statements, schema_version = export_schema_statements(args.teamops_binary)
    content, counts = generate_sql(cache, schema_statements, schema_version)
    if args.source == SOURCE_URL and counts["games"] != 162:
        raise ValueError(f"expected 162 Athletics regular-season games, found {counts['games']}")
    output.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(prefix=f".{output.name}-", dir=output.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
        os.replace(temporary_name, output)
    except Exception:
        Path(temporary_name).unlink(missing_ok=True)
        raise
    return output, counts


def main(argv: list[str] | None = None) -> int:
    try:
        output, counts = prepare(parse_args(argv or sys.argv[1:]))
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(json.dumps({"output": str(output), **counts}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
