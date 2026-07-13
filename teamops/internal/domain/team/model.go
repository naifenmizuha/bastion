package team

type Scope string

const (
	ScopeOwn      Scope = "own"
	ScopeOpponent Scope = "opponent"
)

type Team struct {
	ID        int64
	Name      string
	Scope     Scope
	CreatedAt string
	UpdatedAt string
}
