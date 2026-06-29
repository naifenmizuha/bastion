package player

import "testing"

func TestServiceAddPlayerNormalizesFields(t *testing.T) {
	repo := &fakeRepo{}
	service := NewService(repo)

	player, err := service.AddPlayer(" 张三 ", 18, " Right ", "left,right", "pitcher, shortstop")
	if err != nil {
		t.Fatalf("AddPlayer failed: %v", err)
	}

	if player.Name != "张三" || player.Bat != HandRight || player.Throw != HandLeft|HandRight || player.Positions != PositionPitcher|PositionShortstop {
		t.Fatalf("unexpected player: %+v", player)
	}
	if repo.addedPlayer != player {
		t.Fatalf("repo received unexpected player: %+v", repo.addedPlayer)
	}
}

type fakeRepo struct {
	addedPlayer     Player
	existingPlayers map[string]bool
}

func (r *fakeRepo) AddPlayer(player Player) error {
	r.addedPlayer = player
	return nil
}

func (r *fakeRepo) GetPlayer(name string) (Player, error) {
	return Player{Name: name}, nil
}

func (r *fakeRepo) ListPlayers() ([]Player, error) {
	return nil, nil
}

func (r *fakeRepo) PlayerExists(name string) (bool, error) {
	return r.existingPlayers[name], nil
}
