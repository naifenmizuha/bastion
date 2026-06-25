app := "bastion"
src_dir := "src"
out_dir := "out"
bin := out_dir / app

default:
    @just --list

build:
    mkdir -p {{out_dir}}
    cd {{src_dir}} && go build -o ../{{bin}} .

run *args: build
    ./{{bin}} {{args}}

dev *args:
    cd {{src_dir}} && go run . {{args}}

test:
    cd {{src_dir}} && go test ./...

fmt:
    cd {{src_dir}} && gofmt -w .

seed-reference-game db="bastion.db": build
    ./{{bin}} --db "{{db}}" game write \
      --date 2026-06-24 \
      --start-time 19:30 \
      --opponent "海港队" \
      --batting-side top \
      --own-score 2 \
      --opponent-score 1 \
      --raw "参考比赛：6月24日对海港队，先攻，2:1获胜。" \
      --lineup-json '[{"team":"own","player":"张三","batting_order":1,"starting_position":"P"},{"team":"own","player":"李四","batting_order":2,"starting_position":"CF"}]' \
      --events-json '[{"inning":1,"half":"top","play_no":1,"sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"double","related_player":"对方投手","pitch_sequence":"B,X","description":"张三二垒安打"},{"inning":1,"half":"top","play_no":1,"sequence":2,"event_kind":"runner_movement","player":"李四","team":"own","result":"run_scored","base_from":2,"base_to":4,"reason":"batted_ball","runs_scored":1,"rbi_player":"张三","description":"李四从二垒回本垒得分"},{"inning":1,"half":"top","play_no":2,"sequence":1,"event_kind":"runner_movement","player":"张三","team":"own","result":"advance","base_from":1,"base_to":2,"reason":"stolen_base","description":"张三盗上二垒"},{"inning":1,"half":"bottom","play_no":3,"sequence":1,"event_kind":"plate_result","player":"对手甲","team":"opponent","result":"strikeout","related_player":"张三","pitch_sequence":"S,S,S","outs_on_play":1,"description":"张三三振对手"},{"inning":1,"half":"bottom","play_no":4,"sequence":1,"event_kind":"runner_movement","player":"对手乙","team":"opponent","result":"run_scored","base_from":3,"base_to":4,"reason":"batted_ball","related_player":"张三","runs_scored":1,"earned":true,"description":"对手乙回本垒得分"},{"inning":1,"half":"bottom","play_no":5,"sequence":1,"event_kind":"fielding_credit","player":"李四","team":"own","result":"putout","description":"李四完成接杀"}]'

analyze-player game_id="1" player="张三" db="bastion.db": build
    ./{{bin}} --db "{{db}}" game analysis generate --game-id {{game_id}}
    ./{{bin}} --db "{{db}}" game analysis read --game-id {{game_id}} --player "{{player}}"

clean:
    rm -rf {{out_dir}}
