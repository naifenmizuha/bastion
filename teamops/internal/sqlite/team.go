package sqlite

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"teamops/internal/domain/team"
)

const legacyOwnTeamName = "__bastion_pending_own_team__"

func (s *Store) IsInitialized() (bool, error) {
	var exists bool
	err := s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM app_config WHERE id = 1 AND initialized_at IS NOT NULL)`).Scan(&exists)
	return exists, err
}

func (s *Store) InitializeOwnTeam(name string) (team.Team, error) {
	var id int64
	err := s.withTx(func(tx *sql.Tx) error {
		var initialized sql.NullString
		err := tx.QueryRow(`SELECT initialized_at FROM app_config WHERE id = 1`).Scan(&initialized)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if initialized.Valid {
			return errors.New("own team is already initialized")
		}
		var duplicate bool
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM teams WHERE name = ? AND name <> ?)`, name, legacyOwnTeamName).Scan(&duplicate); err != nil {
			return err
		}
		if duplicate {
			return fmt.Errorf("team already exists: %s", name)
		}
		now := nowTimestamp()
		err = tx.QueryRow(`SELECT id FROM teams WHERE name = ?`, legacyOwnTeamName).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			res, err := tx.Exec(`INSERT INTO teams(name, created_at, updated_at) VALUES(?,?,?)`, name, now, now)
			if err != nil {
				return err
			}
			id, err = res.LastInsertId()
			if err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else if _, err := tx.Exec(`UPDATE teams SET name=?, updated_at=? WHERE id=?`, name, now, id); err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO app_config(id, own_team_id, initialized_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET own_team_id=excluded.own_team_id, initialized_at=excluded.initialized_at`, id, now)
		return err
	})
	if err != nil {
		return team.Team{}, err
	}
	return s.GetTeam(name)
}

func (s *Store) AddTeam(name string) (team.Team, error) {
	ok, err := s.IsInitialized()
	if err != nil {
		return team.Team{}, err
	}
	if !ok {
		return team.Team{}, errors.New("own team is not initialized; run team init first")
	}
	now := nowTimestamp()
	_, err = s.db.Exec(`INSERT INTO teams(name, created_at, updated_at) VALUES(?,?,?)`, name, now, now)
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return team.Team{}, fmt.Errorf("team already exists: %s", name)
	}
	if err != nil {
		return team.Team{}, err
	}
	return s.GetTeam(name)
}

func (s *Store) GetTeam(name string) (team.Team, error) {
	var t team.Team
	var own bool
	err := s.db.QueryRow(`SELECT t.id,t.name,t.created_at,t.updated_at,(t.id=COALESCE(c.own_team_id,-1)) FROM teams t LEFT JOIN app_config c ON c.id=1 WHERE t.name=?`, name).Scan(&t.ID, &t.Name, &t.CreatedAt, &t.UpdatedAt, &own)
	if errors.Is(err, sql.ErrNoRows) {
		return team.Team{}, fmt.Errorf("team not found: %s", name)
	}
	if err != nil {
		return team.Team{}, err
	}
	if own {
		t.Scope = team.ScopeOwn
	} else {
		t.Scope = team.ScopeOpponent
	}
	return t, nil
}

func (s *Store) ListTeams() ([]team.Team, error) {
	rows, err := s.db.Query(`SELECT t.id,t.name,t.created_at,t.updated_at,(t.id=COALESCE(c.own_team_id,-1)) FROM teams t LEFT JOIN app_config c ON c.id=1 WHERE t.name<>? ORDER BY (t.id=COALESCE(c.own_team_id,-1)) DESC,t.name`, legacyOwnTeamName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []team.Team
	for rows.Next() {
		var t team.Team
		var own bool
		if err := rows.Scan(&t.ID, &t.Name, &t.CreatedAt, &t.UpdatedAt, &own); err != nil {
			return nil, err
		}
		if own {
			t.Scope = team.ScopeOwn
		} else {
			t.Scope = team.ScopeOpponent
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) ownTeamID() (int64, error) {
	var id int64
	err := s.db.QueryRow(`SELECT own_team_id FROM app_config WHERE id=1`).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, errors.New("own team is not initialized; run team init first")
	}
	return id, err
}
func (s *Store) resolveTeamID(name string) (int64, error) {
	if strings.TrimSpace(name) == "" {
		return s.ownTeamID()
	}
	t, err := s.GetTeam(strings.TrimSpace(name))
	return t.ID, err
}

func (s *Store) ResolvePersonTeam(name, teamName string) (int64, bool, error) {
	id, err := s.resolveTeamID(teamName)
	if err != nil {
		return 0, false, err
	}
	var exists bool
	if err := s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM players WHERE team_id=? AND name=?)`, id, name).Scan(&exists); err != nil {
		return 0, false, err
	}
	if !exists {
		return 0, false, fmt.Errorf("player not found: %s", name)
	}
	ownID, err := s.ownTeamID()
	return id, id == ownID, err
}
