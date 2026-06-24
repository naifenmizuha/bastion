package domain

type Hand uint8

const (
	HandLeft Hand = 1 << iota
	HandRight
)

type Position uint8

const (
	PositionPitcher Position = 1 << iota
	PositionCatcher
	PositionInfield
	PositionOutfield
)

type Player struct {
	Name      string
	Number    int
	Bat       Hand
	Throw     Hand
	Positions Position
}

type Report struct {
	Name       string
	Date       string
	Content    string
	Reflection string
}
