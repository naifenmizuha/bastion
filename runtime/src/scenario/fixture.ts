export const SCENARIO_DATABASE_PATH = "/tmp/bastion-runtime-scenario.db";

export const SCENARIO_PROMPTS = [
  `请为球队新增以下三名队员，信息必须严格按我给出的值录入：
- 林晨：背号 7，右打右投，位置为游击手
- 周航：背号 18，左打右投，位置为外野手
- 陈宇：背号 21，右打右投，位置为投手
请逐一完成并确认录入结果。`,
  `请安排一场比赛：2026-07-05 19:30 对阵海港队，我们先攻。首发阵容为：林晨第 1 棒游击手，周航第 2 棒中外野手，陈宇第 3 棒投手。请创建比赛并保存这三名首发。`,
  `请把刚才创建的 game_id=1 比赛一次性录入完成。不要复述、规划或改变 payload，直接依次执行以下两个写入并核对比赛。

game event write 的 input：
{"game_id":1,"events":[{"inning":1,"half":"top","play_no":1,"sequence":1,"event_kind":"plate_result","player":"林晨","team":"own","result":"single","related_player":"对方投手","pitch_sequence":"B,X","description":"林晨一垒安打"},{"inning":1,"half":"top","play_no":2,"sequence":1,"event_kind":"plate_result","player":"周航","team":"own","result":"double","related_player":"对方投手","pitch_sequence":"S,X","description":"周航二垒安打"},{"inning":1,"half":"top","play_no":2,"sequence":2,"event_kind":"runner_movement","player":"林晨","team":"own","result":"run_scored","base_from":1,"base_to":4,"reason":"batted_ball","runs_scored":1,"rbi_player":"周航","description":"林晨从一垒回本垒得分"},{"inning":2,"half":"top","play_no":3,"sequence":1,"event_kind":"plate_result","player":"陈宇","team":"own","result":"homerun","related_player":"对方投手","pitch_sequence":"B,S,X","description":"陈宇击出本垒打"},{"inning":2,"half":"top","play_no":3,"sequence":2,"event_kind":"runner_movement","player":"陈宇","team":"own","result":"run_scored","base_from":1,"base_to":4,"reason":"batted_ball","runs_scored":1,"rbi_player":"陈宇","description":"陈宇本垒打得分"},{"inning":2,"half":"bottom","play_no":1,"sequence":1,"event_kind":"plate_result","player":"对手乙","team":"opponent","result":"homerun","related_player":"陈宇","pitch_sequence":"S,B,X","description":"对手乙击出本垒打"},{"inning":2,"half":"bottom","play_no":1,"sequence":2,"event_kind":"runner_movement","player":"对手乙","team":"opponent","result":"run_scored","base_from":1,"base_to":4,"reason":"batted_ball","related_player":"陈宇","runs_scored":1,"earned":true,"description":"对手乙本垒打得到一分"},{"inning":3,"half":"bottom","play_no":1,"sequence":1,"event_kind":"fielding_credit","player":"周航","team":"own","result":"putout","description":"周航在中外野完成接杀"}]}

game score set 的 input：
{"game_id":1,"own_score":2,"opponent_score":1}`,
  `请完成队员表现分析，不要复述或规划，直接依次执行：
1. game analysis generate，input 为 {"game_id":1}
2. game analysis read，参数为 --game-id 1 --player 林晨
最后用不超过 120 个汉字解读林晨的打击、跑垒和守备数据；没有记录的数据只需标明“无记录”，不要补推。`,
] as const;
