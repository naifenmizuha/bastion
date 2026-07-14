from __future__ import annotations

import csv
import importlib.util
import io
import os
import sqlite3
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("prepare_athletics_2025.py")
SPEC = importlib.util.spec_from_file_location("prepare_athletics_2025", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def csv_bytes(fieldnames: list[str], values: list[dict[str, str]]) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fieldnames, lineterminator="\n")
    writer.writeheader()
    writer.writerows(values)
    return stream.getvalue().encode()


class PrepareAthletics2025Test(unittest.TestCase):
    def make_source(self, path: Path, missing_pitcher: bool = False) -> None:
        game_fields = ["gid", "visteam", "hometeam", "date", "starttime", "season", "gametype", "htbf", "vruns", "hruns"]
        stat_fields = ["gid", "team", "stattype"] + [f"start_l{i}" for i in range(1, 11)] + [f"start_f{i}" for i in range(1, 11)]
        player_fields = ["id", "first", "last", "bat", "throw", "team", "season", "g_p", "g_c", "g_1b", "g_2b", "g_3b", "g_ss", "g_lf", "g_cf", "g_rf", "g_of"]
        play_fields = [
            "gid", "event", "inning", "top_bot", "batteam", "pitteam", "batter", "pitcher", "pitches", "pn", "pa",
            "single", "double", "triple", "hr", "walk", "hbp", "k", "roe", "fc", "sh", "sf", "ground", "fly", "line",
            "gdp", "othdp", "tp", "pivot",
            "outs_pre", "outs_post", "br1_pre", "br2_pre", "br3_pre", "br1_post", "br2_post", "br3_post",
            "run_b", "run1", "run2", "run3", "ur_b", "ur1", "ur2", "ur3", "rbi_b", "rbi1", "rbi2", "rbi3",
            "prun_b", "prun1", "prun2", "prun3",
            "sb2", "sb3", "sbh", "cs2", "cs3", "csh", "wp", "pb", "bk", "pko1", "pko2", "pko3", "bip",
            "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9",
            "po1", "po2", "po3", "po4", "po5", "po6", "po7", "po8", "po9",
            "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9",
            "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "e9",
        ]
        games = [
            {"gid": "SEA202503270", "visteam": "ATH", "hometeam": "SEA", "date": "20250327", "starttime": "1905", "season": "2025", "gametype": "regular", "vruns": "2", "hruns": "1"},
            {"gid": "SEA202503280", "visteam": "ATH", "hometeam": "SEA", "date": "20250328", "season": "2025", "gametype": "exhibition"},
        ]
        teamstats = [
            {"gid": "SEA202503270", "team": "ATH", "stattype": "value", "start_l1": "ath001", "start_f1": "ath001"},
            {"gid": "SEA202503270", "team": "SEA", "stattype": "value", "start_l1": "sea001", "start_f2": "sea001"},
        ]
        players = [
            {"id": "ath001", "first": "Ath", "last": "Batter", "bat": "L", "throw": "R", "team": "ATH", "season": "2025", "g_p": "1"},
            {"id": "sea001", "first": "Sea", "last": "Catcher", "bat": "R", "throw": "R", "team": "SEA", "season": "2025", "g_c": "1"},
        ]
        if missing_pitcher:
            pitcher = "missing"
        else:
            pitcher = "sea001"
        plays = [{
            "gid": "SEA202503270", "event": "S7", "inning": "1", "top_bot": "0", "batteam": "ATH", "pitteam": "SEA",
            "batter": "ath001", "pitcher": pitcher, "pitches": "BX", "pn": "1", "pa": "1", "single": "1",
            "outs_pre": "0", "outs_post": "0", "br1_post": "ath001", "f2": "sea001",
        }]
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("gameinfo.csv", csv_bytes(game_fields, games))
            archive.writestr("teamstats.csv", csv_bytes(stat_fields, teamstats))
            archive.writestr("plays.csv", csv_bytes(play_fields, plays))
            archive.writestr("allplayers.csv", csv_bytes(player_fields, players))

    def test_generates_guarded_teamops_seed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.zip"
            self.make_source(source)
            sql, counts = MODULE.generate_sql(source)
        self.assertEqual(counts, {"games": 1, "players": 2, "lineups": 2, "events": 1})
        self.assertIn("CREATE TEMP TABLE _athletics_seed_guard", sql)
        self.assertIn("INSERT INTO teams(name,created_at,updated_at) VALUES('Sacramento Athletics'", sql)
        self.assertIn("INSERT INTO app_config", sql)
        self.assertIn("INSERT INTO players", sql)
        self.assertIn("player_key", sql)
        self.assertNotIn("'ath001'", sql)
        self.assertNotIn("'sea001'", sql)
        self.assertIn("'2025-03-27','19:05','Seattle Mariners'", sql)
        self.assertIn("INSERT INTO game_events", sql)
        self.assertNotIn("game_analyses", sql)
        self.assertTrue(sql.endswith("COMMIT;\n"))

    def test_normalizes_three_and_four_digit_times(self) -> None:
        self.assertEqual(MODULE.time_text("638"), "06:38")
        self.assertEqual(MODULE.time_text("105"), "01:05")
        self.assertEqual(MODULE.time_text("1905"), "19:05")
        self.assertEqual(MODULE.time_text("06:38"), "06:38")
        with self.assertRaisesRegex(ValueError, "invalid start time"):
            MODULE.time_text("2460")

    def test_rejects_unknown_referenced_player(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.zip"
            self.make_source(source, missing_pitcher=True)
            with self.assertRaisesRegex(ValueError, "missing allplayers row"):
                MODULE.generate_sql(source)

    @unittest.skipUnless(os.environ.get("TEAMOPS_BINARY"), "TEAMOPS_BINARY is not set")
    def test_initialization_sql_applies_directly_to_new_database(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.zip"
            database = root / "teamops.db"
            self.make_source(source)
            schema, version = MODULE.export_schema_statements(Path(os.environ["TEAMOPS_BINARY"]))
            seed, counts = MODULE.generate_sql(source, schema, version)
            self.assertIn("CREATE TABLE players", seed)
            self.assertIn("CREATE TABLE teams", seed)
            connection = sqlite3.connect(database)
            try:
                connection.executescript(seed)
                own_team = connection.execute(
                    "SELECT t.name FROM app_config c JOIN teams t ON t.id=c.own_team_id WHERE c.id=1 AND c.initialized_at IS NOT NULL"
                ).fetchone()
                self.assertEqual(own_team, ("Sacramento Athletics",))
                self.assertEqual(connection.execute("SELECT count(*) FROM games").fetchone()[0], counts["games"])
                self.assertEqual(connection.execute("SELECT count(*) FROM game_lineups").fetchone()[0], counts["lineups"])
                self.assertEqual(connection.execute("SELECT count(*) FROM game_events").fetchone()[0], counts["events"])
                self.assertEqual(connection.execute("SELECT count(*) FROM game_analyses").fetchone()[0], 0)
                self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone(), ("ok",))
            finally:
                connection.close()


if __name__ == "__main__":
    unittest.main()
