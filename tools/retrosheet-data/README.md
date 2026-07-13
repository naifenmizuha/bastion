# Retrosheet Athletics 2025 SQL seed

This standalone script downloads Retrosheet's 2025 CSV release and generates a
single deterministic SQL seed for the Athletics (`ATH`) regular season. It does
not import or invoke TeamOps code.

```sh
just prepare-athletics-2025
```

The default output is `out/athletics-2025.sql`. It contains teams, Athletics
players, games, both starting lineups, and normalized game events. It deliberately
does not contain training reports, game analyses, or derived-memory data.

Apply the seed only to a fresh database after TeamOps has created its schema:

```sh
just build
./out/teamops --db out/athletics-2025.db team list >/dev/null
sqlite3 out/athletics-2025.db < out/athletics-2025.sql
```

The SQL has a guard that rejects initialized or non-empty game databases.

## Retrosheet notice

The information used here was obtained free of charge from and is copyrighted
by Retrosheet. Interested parties may contact Retrosheet at 20 Sunset Rd.,
Newark, DE 19711.
