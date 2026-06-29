package player

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
	Name      string
	Number    int
	Bat       Hand
	Throw     Hand
	Positions Position
}
