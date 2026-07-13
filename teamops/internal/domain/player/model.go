package player

import (
	"crypto/rand"
	"encoding/hex"
)

type Hand uint8

const (
	HandLeft Hand = 1 << iota
	HandRight
)

type Position uint8

const (
	PositionPitcher Position = 1 << iota
	PositionCatcher
	PositionFirstBase
	PositionSecondBase
	PositionThirdBase
	PositionShortstop
	PositionOutfield
)

type Player struct {
	ID        int64
	Key       string
	TeamID    int64
	Team      string
	Scope     string
	Name      string
	Number    int
	Bat       Hand
	Throw     Hand
	Positions Position
	UpdatedAt string
}

// NewKey returns an opaque, database-local player identity. Callers never
// provide this value; the CLI creates it when a player is registered.
func NewKey() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return "ply_" + hex.EncodeToString(raw[:]), nil
}
