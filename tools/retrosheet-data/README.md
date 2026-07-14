# Retrosheet Athletics 2025 initialization SQL

This standalone script downloads Retrosheet's 2025 CSV release and generates a
single deterministic initialization SQL file for the Athletics (`ATH`) regular
season. It invokes the current TeamOps binary while generating the file so the
embedded schema cannot drift from the application.

```sh
just prepare-athletics-2025
```

The default output is `out/athletics-2025.sql`. It contains the complete TeamOps
schema, teams, players, games, both starting lineups, and normalized game events.
It deliberately does not contain training reports, game analyses, or
derived-memory data.

Apply it directly to a new database:

```sh
sqlite3 out/athletics-2025.db < out/athletics-2025.sql
```

No separate `schema init` or `team list` command is required. Schema creation and
data import run in one transaction, and existing databases are rejected.

## Retrosheet notice

The information used here was obtained free of charge from and is copyrighted
by Retrosheet. Interested parties may contact Retrosheet at 20 Sunset Rd.,
Newark, DE 19711.
