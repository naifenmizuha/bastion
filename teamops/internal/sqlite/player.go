package sqlite

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"teamops/internal/domain/player"
)

func (s *Store) AddPlayer(p player.Player) error {
	existing, err := s.GetPlayerForTeam(p.Name, p.Team)
	if err == nil {
		return fmt.Errorf("player already exists: %s (player_key=%s)", existing.Name, existing.Key)
	}
	if !strings.Contains(err.Error(), "player not found") {
		return err
	}
	_, _, err = s.AddPlayerReturning(p)
	return err
}

// AddPlayerReturning inserts a player or returns the identical existing row so
// command retries are idempotent.
func (s *Store) AddPlayerReturning(p player.Player) (player.Player, bool, error) {
	if strings.TrimSpace(p.Key) != "" {
		return player.Player{}, false, errors.New("caller must not specify player_key")
	}
	if p.TeamID == 0 {
		id, _, err := s.ResolvePlayerTeam("")
		if err != nil {
			return player.Player{}, false, err
		}
		p.TeamID = id
	}
	existing, err := s.getPlayerForTeamID(p.Name, p.TeamID)
	if err == nil {
		if existing.Number == p.Number && existing.Bat == p.Bat && existing.Throw == p.Throw && existing.Positions == p.Positions {
			return existing, false, nil
		}
		return player.Player{}, false, fmt.Errorf("player already exists with different attributes: %s (player_key=%s)", p.Name, existing.Key)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return player.Player{}, false, err
	}
	if strings.TrimSpace(p.Key) == "" {
		p.Key, err = player.NewKey()
		if err != nil {
			return player.Player{}, false, fmt.Errorf("generate player key: %w", err)
		}
	}
	updatedAt := nowTimestamp()
	result, err := s.db.Exec(`INSERT INTO players(player_key,team_id,name,number,bat_hands,throw_hands,positions,updated_at) VALUES(?,?,?,?,?,?,?,?)`, p.Key, p.TeamID, p.Name, p.Number, int64(p.Bat), int64(p.Throw), int64(p.Positions), updatedAt)
	if err != nil {
		return player.Player{}, false, err
	}
	p.ID, err = result.LastInsertId()
	if err != nil {
		return player.Player{}, false, err
	}
	p.UpdatedAt = updatedAt
	if err := s.db.QueryRow(`SELECT name FROM teams WHERE id=?`, p.TeamID).Scan(&p.Team); err != nil {
		return player.Player{}, false, err
	}
	ownID, err := s.ownTeamID()
	if err != nil {
		return player.Player{}, false, err
	}
	if p.TeamID == ownID {
		p.Scope = "own"
	} else {
		p.Scope = "opponent"
	}
	return p, true, nil
}

func (s *Store) ResolvePlayerTeam(name string) (int64, string, error) {
	id, err := s.resolveTeamID(name)
	if err != nil {
		return 0, "", err
	}
	var n string
	if err := s.db.QueryRow(`SELECT name FROM teams WHERE id=?`, id).Scan(&n); err != nil {
		return 0, "", err
	}
	return id, n, nil
}

func (s *Store) GetPlayer(name string) (player.Player, error) {
	p, err := s.GetPlayerForTeam(name, "")
	if err != nil {
		return player.Player{}, err
	}
	// Preserve the legacy Repository method shape. Identity-aware callers use
	// the team/id/key methods below.
	p.ID, p.Key, p.TeamID, p.Team, p.Scope, p.UpdatedAt = 0, "", 0, "", "", ""
	return p, nil
}

func (s *Store) GetPlayerForTeam(name, teamName string) (player.Player, error) {
	teamID, err := s.resolveTeamID(teamName)
	if err != nil {
		return player.Player{}, err
	}
	p, err := s.getPlayerForTeamID(name, teamID)
	if errors.Is(err, sql.ErrNoRows) {
		return player.Player{}, fmt.Errorf("player not found: %s", name)
	}
	return p, err
}

func (s *Store) GetPlayerByID(id int64) (player.Player, error) {
	return s.getPlayerWhere(`p.id=?`, id)
}

func (s *Store) GetPlayerByKey(key string) (player.Player, error) {
	return s.getPlayerWhere(`p.player_key=?`, key)
}

func (s *Store) ListPlayers() ([]player.Player, error) { return s.ListPlayersFiltered("", "") }

func (s *Store) ListPlayersFiltered(teamName, scope string) ([]player.Player, error) {
	where := ""
	var args []any
	if teamName != "" {
		id, err := s.resolveTeamID(teamName)
		if err != nil {
			return nil, err
		}
		where = " WHERE p.team_id=?"
		args = append(args, id)
	} else if scope == "own" {
		where = " WHERE p.team_id=c.own_team_id"
	} else if scope == "opponent" {
		where = " WHERE p.team_id<>c.own_team_id"
	}
	rows, err := s.db.Query(`SELECT p.id,p.player_key,p.team_id,t.name,CASE WHEN p.team_id=c.own_team_id THEN 'own' ELSE 'opponent' END,p.name,p.number,p.bat_hands,p.throw_hands,p.positions,p.updated_at FROM players p JOIN teams t ON t.id=p.team_id JOIN app_config c ON c.id=1`+where+` ORDER BY t.name,p.number,p.name`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []player.Player
	for rows.Next() {
		var p player.Player
		var b, t, pos int64
		if err := rows.Scan(&p.ID, &p.Key, &p.TeamID, &p.Team, &p.Scope, &p.Name, &p.Number, &b, &t, &pos, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.Bat, err = player.HandFromBits(b)
		if err != nil {
			return nil, err
		}
		p.Throw, err = player.HandFromBits(t)
		if err != nil {
			return nil, err
		}
		p.Positions, err = player.PositionFromBits(pos)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) getPlayerForTeamID(name string, teamID int64) (player.Player, error) {
	return s.getPlayerWhere(`p.name=? AND p.team_id=?`, name, teamID)
}

func (s *Store) getPlayerWhere(where string, args ...any) (player.Player, error) {
	var p player.Player
	var batBits, throwBits, positionBits int64
	err := s.db.QueryRow(`SELECT p.id,p.player_key,p.team_id,t.name,CASE WHEN p.team_id=c.own_team_id THEN 'own' ELSE 'opponent' END,p.name,p.number,p.bat_hands,p.throw_hands,p.positions,p.updated_at FROM players p JOIN teams t ON t.id=p.team_id JOIN app_config c ON c.id=1 WHERE `+where, args...).Scan(&p.ID, &p.Key, &p.TeamID, &p.Team, &p.Scope, &p.Name, &p.Number, &batBits, &throwBits, &positionBits, &p.UpdatedAt)
	if err != nil {
		return player.Player{}, err
	}
	if p.Bat, err = player.HandFromBits(batBits); err != nil {
		return player.Player{}, err
	}
	if p.Throw, err = player.HandFromBits(throwBits); err != nil {
		return player.Player{}, err
	}
	if p.Positions, err = player.PositionFromBits(positionBits); err != nil {
		return player.Player{}, err
	}
	return p, nil
}

func (s *Store) PlayerExists(name string) (bool, error) {
	id, err := s.ownTeamID()
	if err != nil {
		return false, err
	}
	var ok bool
	err = s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM players WHERE name=? AND team_id=?)`, name, id).Scan(&ok)
	return ok, err
}
