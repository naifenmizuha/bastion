---
name: drill-cards
description: Import baseball training video links into the Feishu/Lark Bitable DrillCard table. Use when Codex receives a training video URL from YouTube, Douyin, Xiaohongshu, Bilibili, WeChat Channels, or similar platforms plus a recommendation reason, and needs to analyze the video context, generate an AI summary, infer DrillCard header values, and submit the record through the configured Feishu CLI adapter.
---

# Drill Cards

## Overview

Use this skill to turn one training video link and a recommendation reason into a `DrillCard` record. Keep the workflow conservative: store the source link, preserve the user's reason, generate a short coaching summary, default uncertain required fields, and leave `is_enabled` false.

## Required Inputs

Require these user inputs before writing anything:

- `video_url`: original video URL.
- `recommendation_reason`: why the video is worth collecting.

Require these environment variables before submitting:

- `DRILLCARD_DEFAULT_SUBMITTED_BY`: Feishu person-field value for the default submitter.
- `DRILLCARD_FEISHU_CREATE_RECORD_CMD`: CLI command template with a `{payload}` placeholder, for example `feishu bitable record create --payload {payload}`.

If an input or required environment variable is missing, stop and ask for it or tell the user what to configure. Do not create a partial record.

## Workflow

1. Analyze the video link.
   - Prefer available tools or platform metadata for title, description, captions/transcript, author, duration, and visible page text.
   - For YouTube and Bilibili, use title/description/captions when accessible.
   - For Douyin, Xiaohongshu, and WeChat Channels, expect access to fail often; use the recommendation reason as the primary context when metadata cannot be read.

2. Infer DrillCard values.
   - `submitted_by`: read from `DRILLCARD_DEFAULT_SUBMITTED_BY`.
   - `submitted_at`: current local timestamp.
   - `video_url`: preserve the original URL.
   - `recommendation_reason`: preserve the user's wording.
   - `target_positions`: infer from video context and reason using only these labels when confident: `投手`, `捕手`, `内野`, `外野`, `一垒`, `二垒`, `三垒`, `游击`, `跑垒`, `打者`, `全队`. Leave empty when uncertain.
   - `participant_requirement`: infer the minimum participants only when obvious; otherwise use `1`.
   - `venue_requirement`: choose one of `无限制`, `室内场地`, `有网小场`, `完整场地`; otherwise use `无限制`.
   - `is_enabled`: always `false`.

3. Generate `ai_summary` in exactly this format:

   ```text
   视频内容：
   适合对象：
   关键训练点：
   教练可关注：
   ```

   If the video content cannot be read, include this sentence under `视频内容：`: `无法自动读取视频内容，仅根据推荐原因生成初步摘要。`

4. Submit the record with the bundled adapter:

   ```bash
   python3 skills/drill-cards/scripts/submit_drill_card.py \
     --video-url "https://example.com/video" \
     --recommendation-reason "推荐原因" \
     --target-position "打者" \
     --participant-requirement 1 \
     --venue-requirement "无限制" \
     --ai-summary "视频内容：..."
   ```

Use `--dry-run` first when validating configuration or when the user asks to preview the payload.

## Payload Contract

The adapter sends a JSON object with these logical field keys:

```json
{
  "submitted_by": "...",
  "submitted_at": "...",
  "video_url": "...",
  "recommendation_reason": "...",
  "target_positions": [],
  "participant_requirement": 1,
  "venue_requirement": "无限制",
  "ai_summary": "...",
  "is_enabled": false
}
```

The real Feishu CLI adapter is responsible for translating these logical keys into the actual Bitable field identifiers or localized field names if needed.

## Safety Rules

- Do not normalize, shorten, or replace the original video URL.
- Do not set `is_enabled` to true.
- Do not overwrite an existing record unless the user explicitly asks for an update workflow.
- Do not invent video details when the platform blocks access; make the fallback explicit in `ai_summary`.
- Keep the summary short and useful for a coach deciding whether to adopt the drill.
