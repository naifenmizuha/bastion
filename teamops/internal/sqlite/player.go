package sqlite

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"teamops/internal/domain/player"
)

func (s *Store) AddPlayer(p player.Player) error {
	if p.TeamID == 0 {
		id, _, err := s.ResolvePlayerTeam("")
		if err != nil {
			return err
		}
		p.TeamID = id
	}
	_, err := s.db.Exec(`INSERT INTO players(team_id,name,number,bat_hands,throw_hands,positions,updated_at) VALUES(?,?,?,?,?,?,?)`, p.TeamID, p.Name, p.Number, int64(p.Bat), int64(p.Throw), int64(p.Positions), nowTimestamp())
	if err != nil && strings.Contains(err.Error(), "UNIQUE") {
		return fmt.Errorf("player already exists: %s", p.Name)
	}
	return err
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
	initialized, initErr := s.IsInitialized()
	if initErr == nil && !initialized {
		p.ID, p.TeamID, p.Team, p.Scope = 0, 0, "", ""
	}
	return p, nil
}

func (s *Store) GetPlayerForTeam(name, teamName string) (player.Player, error) {
	teamID, err := s.resolveTeamID(teamName)
	if err != nil {
		return player.Player{}, err
	}
	var p player.Player
	var batBits, throwBits, positionBits int64
	err = s.db.QueryRow(`SELECT p.id,p.team_id,t.name,CASE WHEN p.team_id=c.own_team_id THEN 'own' ELSE 'opponent' END,p.name,p.number,p.bat_hands,p.throw_hands,p.positions FROM players p JOIN teams t ON t.id=p.team_id JOIN app_config c ON c.id=1 WHERE p.name=? AND p.team_id=?`, name, teamID).Scan(&p.ID, &p.TeamID, &p.Team, &p.Scope, &p.Name, &p.Number, &batBits, &throwBits, &positionBits)
	if errors.Is(err, sql.ErrNoRows) {
		return player.Player{}, fmt.Errorf("player not found: %s", name)
	}
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
	rows, err := s.db.Query(`SELECT p.id,p.team_id,t.name,CASE WHEN p.team_id=c.own_team_id THEN 'own' ELSE 'opponent' END,p.name,p.number,p.bat_hands,p.throw_hands,p.positions FROM players p JOIN teams t ON t.id=p.team_id JOIN app_config c ON c.id=1`+where+` ORDER BY t.name,p.number,p.name`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []player.Player
	for rows.Next() {
		var p player.Player
		var b, t, pos int64
		if err := rows.Scan(&p.ID, &p.TeamID, &p.Team, &p.Scope, &p.Name, &p.Number, &b, &t, &pos); err != nil {
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

func (s *Store) PlayerExists(name string) (bool, error) {
	id, err := s.ownTeamID()
	if err != nil {
		return false, err
	}
	var ok bool
	err = s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM players WHERE name=? AND team_id=?)`, name, id).Scan(&ok)
	return ok, err
}
