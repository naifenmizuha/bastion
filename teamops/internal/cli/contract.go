package cli

import (
	"fmt"
	"strings"
)

// ContractCmd prints the machine-readable input contract for structured commands.
type ContractCmd struct{}

// CommandInputContract describes the JSON object accepted by one CLI command.
type CommandInputContract struct {
	Command []string            `json:"command"`
	Input   ObjectInputContract `json:"input"`
}

// ObjectInputContract is the JSON-schema-like subset consumed by the Runtime.
type ObjectInputContract struct {
	Required             bool                      `json:"required"`
	Type                 string                    `json:"type"`
	AdditionalProperties bool                      `json:"additionalProperties"`
	RequiredFields       []string                  `json:"requiredFields"`
	Properties           map[string]map[string]any `json:"properties"`
	Example              map[string]any            `json:"example"`
}

var commandInputContracts = []CommandInputContract{
	objectContract([]string{"team", "init"}, []string{"own_team"}, map[string]map[string]any{"own_team": stringProperty("Own team name")}, map[string]any{"own_team": "堡垒队"}),
	objectContract([]string{"team", "add"}, []string{"name"}, map[string]map[string]any{"name": stringProperty("Opponent team name")}, map[string]any{"name": "海港队"}),
	objectContract(
		[]string{"batch", "read"},
		[]string{"operations"},
		map[string]map[string]any{
			"operations": batchOperationsProperty("Read-only Bastion operations"),
		},
		map[string]any{"operations": []any{
			map[string]any{"args": []string{"player", "read", "--name", "张三"}},
			map[string]any{"args": []string{"report", "read", "--name", "张三", "--date", "2026-06-30"}},
		}},
	),
	objectContract(
		[]string{"batch", "write"},
		[]string{"operations"},
		map[string]map[string]any{
			"operations": batchOperationsProperty("Ordered Bastion operations; may include writes"),
		},
		map[string]any{"operations": []any{
			map[string]any{"args": []string{"player", "add"}, "input": map[string]any{"name": "张三", "number": 18, "bat": "right", "throw": "right", "positions": "pitcher,shortstop"}},
			map[string]any{"args": []string{"report", "write"}, "input": map[string]any{"name": "张三", "date": "2026-06-30", "content": "打击训练 100 球", "reflection": "外角球仍需加强"}},
		}},
	),
	objectContract(
		[]string{"player", "add"},
		[]string{"name", "number", "bat", "throw", "positions"},
		map[string]map[string]any{
			"team":      stringProperty("Optional registered team name; defaults to own team"),
			"name":      stringProperty("Player name"),
			"number":    integerProperty("Uniform number", 0),
			"bat":       listStringProperty("Comma-separated batting hands", []string{"left", "right"}),
			"throw":     listStringProperty("Comma-separated throwing hands", []string{"left", "right"}),
			"positions": listStringProperty("Comma-separated player positions", []string{"pitcher", "catcher", "first_base", "second_base", "third_base", "shortstop", "outfield"}),
		},
		map[string]any{"name": "张三", "number": 18, "bat": "right", "throw": "right", "positions": "pitcher,shortstop"},
	),
	objectContract(
		[]string{"report", "write"},
		[]string{"name", "date", "content", "reflection"},
		map[string]map[string]any{
			"name":       stringProperty("Registered player name"),
			"date":       formattedStringProperty("Training date", "date"),
			"content":    stringProperty("Training content"),
			"reflection": stringProperty("Training reflection"),
		},
		map[string]any{"name": "张三", "date": "2026-06-30", "content": "打击训练 100 球", "reflection": "外角球仍需加强"},
	),
	objectContract(
		[]string{"game", "write"},
		[]string{"date", "opponent", "batting_side", "own_score", "opponent_score", "raw"},
		map[string]map[string]any{
			"date":           formattedStringProperty("Game date", "date"),
			"start_time":     formattedStringProperty("Optional game start time", "time"),
			"opponent":       stringProperty("Opponent name"),
			"batting_side":   enumStringProperty("Own team batting side", []string{"top", "bottom"}),
			"own_score":      integerProperty("Own final score", 0),
			"opponent_score": integerProperty("Opponent final score", 0),
			"raw":            stringProperty("Raw game description"),
			"lineups":        gameLineupArrayProperty("Game lineup entries"),
			"events":         gameEventArrayProperty("Game fact events"),
		},
		map[string]any{"date": "2026-06-30", "opponent": "海港队", "batting_side": "top", "own_score": 1, "opponent_score": 0, "raw": "比赛记录", "lineups": []any{}, "events": []any{}},
	),
	objectContract(
		[]string{"game", "create"},
		[]string{"date", "opponent", "batting_side", "raw"},
		map[string]map[string]any{
			"date":         formattedStringProperty("Game date", "date"),
			"start_time":   formattedStringProperty("Optional game start time", "time"),
			"opponent":     stringProperty("Opponent name"),
			"batting_side": enumStringProperty("Own team batting side", []string{"top", "bottom"}),
			"raw":          stringProperty("Raw game description"),
		},
		map[string]any{"date": "2026-06-30", "start_time": "19:00", "opponent": "海港队", "batting_side": "top", "raw": "比赛记录"},
	),
	objectContract(
		[]string{"game", "lineup", "add"},
		[]string{"game_id", "team"},
		map[string]map[string]any{
			"game_id":           positiveIntegerProperty("Game id"),
			"team":              enumStringProperty("Lineup team", []string{"own", "opponent"}),
			"player":            stringProperty("Player name"),
			"player_key":        stringProperty("Optional database-local player key; one of player/player_key is required"),
			"batting_order":     rangedIntegerProperty("Optional batting order", 1, 9),
			"starting_position": enumStringProperty("Optional starting position", []string{"P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"}),
		},
		map[string]any{"game_id": 1, "team": "own", "player": "张三", "batting_order": 1, "starting_position": "P"},
	),
	objectContract(
		[]string{"game", "event", "validate"},
		[]string{"game_id", "events"},
		map[string]map[string]any{
			"game_id": positiveIntegerProperty("Game id"),
			"events":  eventArrayProperty("Ordered game fact events"),
		},
		map[string]any{"game_id": 1, "events": []any{}},
	),
	objectContract(
		[]string{"game", "event", "write"},
		[]string{"game_id", "events"},
		map[string]map[string]any{
			"game_id": positiveIntegerProperty("Game id"),
			"events":  eventArrayProperty("Ordered game fact events"),
		},
		map[string]any{"game_id": 1, "events": []any{}},
	),
	objectContract(
		[]string{"game", "score", "set"},
		[]string{"game_id", "own_score", "opponent_score"},
		map[string]map[string]any{
			"game_id":        positiveIntegerProperty("Game id"),
			"own_score":      integerProperty("Own final score", 0),
			"opponent_score": integerProperty("Opponent final score", 0),
		},
		map[string]any{"game_id": 1, "own_score": 5, "opponent_score": 3},
	),
	objectContract(
		[]string{"game", "analysis", "generate"},
		[]string{"game_id"},
		map[string]map[string]any{"game_id": positiveIntegerProperty("Game id")},
		map[string]any{"game_id": 1},
	),
	objectContract(
		[]string{"game", "analysis", "generate-batch"},
		[]string{"from", "to"},
		map[string]map[string]any{
			"from": formattedStringProperty("Inclusive start date", "date"),
			"to":   formattedStringProperty("Inclusive end date", "date"),
			"mode": enumStringProperty("Generation mode", []string{"missing", "stale", "all"}),
		},
		map[string]any{"from": "2025-01-01", "to": "2025-12-31", "mode": "missing"},
	),
	objectContract(
		[]string{"lineup", "validate"},
		[]string{"schema_version", "game_id", "starters"},
		lineupProperties(),
		lineupExample(),
	),
	objectContract(
		[]string{"lineup", "write"},
		[]string{"schema_version", "game_id", "starters"},
		lineupProperties(),
		lineupExample(),
	),
	objectContract(
		[]string{"drill", "recommend", "write"},
		[]string{"name", "url", "reason", "type", "summary"},
		map[string]map[string]any{
			"name":    stringProperty("Registered player associated with the training"),
			"url":     formattedStringProperty("Drill video URL", "uri"),
			"reason":  stringProperty("Recommendation reason"),
			"type":    enumStringProperty("Drill type", []string{"pitching", "catching", "hitting", "strength", "baserunning", "infield", "outfield"}),
			"summary": stringProperty("Drill summary"),
		},
		map[string]any{"name": "张三", "url": "https://example.com/drill/1", "reason": "改善投球动作", "type": "pitching", "summary": "投球发力链训练"},
	),
}

func objectContract(command, required []string, properties map[string]map[string]any, example map[string]any) CommandInputContract {
	return CommandInputContract{
		Command: command,
		Input: ObjectInputContract{
			Required:             true,
			Type:                 "object",
			AdditionalProperties: false,
			RequiredFields:       required,
			Properties:           properties,
			Example:              example,
		},
	}
}

func stringProperty(description string) map[string]any {
	return map[string]any{"type": "string", "minLength": 1, "description": description}
}

func enumStringProperty(description string, values []string) map[string]any {
	property := stringProperty(description)
	property["enum"] = values
	return property
}

func listStringProperty(description string, values []string) map[string]any {
	property := stringProperty(description)
	property["allowedValues"] = values
	property["separator"] = ","
	return property
}

func formattedStringProperty(description, format string) map[string]any {
	return map[string]any{"type": "string", "minLength": 1, "format": format, "description": description}
}

func integerProperty(description string, minimum int) map[string]any {
	return map[string]any{"type": "integer", "minimum": minimum, "description": description}
}

func positiveIntegerProperty(description string) map[string]any {
	return integerProperty(description, 1)
}

func rangedIntegerProperty(description string, minimum, maximum int) map[string]any {
	return map[string]any{"type": "integer", "minimum": minimum, "maximum": maximum, "description": description}
}

func arrayProperty(description, itemType string) map[string]any {
	return map[string]any{"type": "array", "items": map[string]any{"type": itemType}, "description": description}
}

func eventArrayProperty(description string) map[string]any {
	return map[string]any{
		"type": "array", "minItems": 1, "description": description,
		"items": map[string]any{
			"type": "object", "additionalProperties": false,
			"requiredFields": []string{"inning", "half", "sequence", "event_kind", "team", "result"},
			"oneOf":          []any{map[string]any{"requiredFields": []string{"player_key"}}, map[string]any{"requiredFields": []string{"player"}}},
			"properties": map[string]any{
				"inning": rangedIntegerProperty("Inning", 1, 99), "half": enumStringProperty("Half inning", []string{"top", "bottom"}),
				"play_no": positiveIntegerProperty("Optional source play number"), "sequence": positiveIntegerProperty("Sequence within play"),
				"event_kind": enumStringProperty("Event kind", []string{"plate_result", "runner_movement", "fielding_credit"}),
				"player":     stringProperty("Player name snapshot"), "player_key": stringProperty("Optional player key"), "team": enumStringProperty("Team", []string{"own", "opponent"}),
				"result": stringProperty("Result enum determined by event_kind"), "related_player": stringProperty("Related player snapshot"), "related_player_key": stringProperty("Related player key"),
				"rbi_player": stringProperty("RBI player snapshot"), "rbi_player_key": stringProperty("RBI player key"),
				"base_from": rangedIntegerProperty("Origin base", 0, 3), "base_to": rangedIntegerProperty("Destination base", 1, 4),
				"outs_on_play": integerProperty("Outs on play", 0), "runs_scored": integerProperty("Runs scored", 0), "value": integerProperty("Credit value", 0),
			},
		},
	}
}

func gameEventArrayProperty(description string) map[string]any {
	property := eventArrayProperty(description)
	property["minItems"] = 0
	return property
}

func gameLineupArrayProperty(description string) map[string]any {
	return map[string]any{
		"type": "array", "description": description,
		"items": map[string]any{
			"type": "object", "additionalProperties": false,
			"requiredFields": []string{"team"},
			"oneOf":          []any{map[string]any{"requiredFields": []string{"player_key"}}, map[string]any{"requiredFields": []string{"player"}}},
			"properties": map[string]any{
				"team": enumStringProperty("Lineup team", []string{"own", "opponent"}), "player": stringProperty("Name snapshot"), "player_key": stringProperty("Player key"),
				"batting_order": rangedIntegerProperty("Batting order", 1, 9), "starting_position": enumStringProperty("Starting position", []string{"P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"}),
			},
		},
	}
}

func batchOperationsProperty(description string) map[string]any {
	return map[string]any{
		"type":        "array",
		"description": description,
		"minItems":    1,
		"items": map[string]any{
			"type":                 "object",
			"additionalProperties": false,
			"requiredFields":       []string{"args"},
			"properties": map[string]any{
				"args": map[string]any{
					"type":        "array",
					"minItems":    1,
					"items":       map[string]any{"type": "string"},
					"description": "Bastion subcommand and flags as separate tokens; omit --db, --format, and --input",
				},
				"input": map[string]any{
					"type":        "object",
					"description": "Structured input object for commands that require it",
				},
			},
		},
	}
}

func lineupProperties() map[string]map[string]any {
	return map[string]map[string]any{
		"schema_version": enumStringProperty("Lineup schema version", []string{"1.0"}),
		"game_id":        positiveIntegerProperty("Game id"),
		"strategy":       stringProperty("Optional lineup strategy"),
		"starters":       {"type": "array", "minItems": 9, "maxItems": 9, "items": map[string]any{"type": "object", "requiredFields": []string{"player", "position", "batting_order"}, "properties": map[string]any{"player": stringProperty("Player name"), "position": enumStringProperty("Position", []string{"P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"}), "batting_order": rangedIntegerProperty("Batting order", 1, 9)}}},
		"bench":          {"type": "array", "items": map[string]any{"type": "object", "requiredFields": []string{"player", "suggested_role"}}},
		"pitching_plan":  {"type": "array", "items": map[string]any{"type": "object", "requiredFields": []string{"player", "role"}, "properties": map[string]any{"role": enumStringProperty("Pitching role", []string{"starter", "reliever", "closer"}), "planned_innings": integerProperty("Planned innings", 1)}}},
		"reasoning":      arrayProperty("Optional reasoning notes", "string"),
	}
}

func lineupExample() map[string]any {
	return map[string]any{
		"schema_version": "1.0",
		"game_id":        1,
		"starters": []any{
			map[string]any{"player": "张三", "position": "P", "batting_order": 1},
		},
	}
}

func contractKey(command []string) string {
	return strings.Join(command, " ")
}

func inputContractFor(command []string) (CommandInputContract, bool) {
	key := contractKey(command)
	for _, contract := range commandInputContracts {
		if contractKey(contract.Command) == key {
			return contract, true
		}
	}
	return CommandInputContract{}, false
}

func requiredFieldsForCommand(command []string) ([]string, error) {
	contract, ok := inputContractFor(command)
	if !ok {
		return nil, fmt.Errorf("missing input contract for command %q", contractKey(command))
	}
	return contract.Input.RequiredFields, nil
}

// Run returns every structured-input contract without accessing the database.
func (cmd *ContractCmd) Run(ctx *Context) error {
	return writeCommandResult(
		ctx,
		map[string]any{"commands": commandInputContracts},
		fmt.Sprintf("%d structured command contracts\n", len(commandInputContracts)),
	)
}
