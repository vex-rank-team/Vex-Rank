# VIQRC fixtures

Captured 2026-11-01 for the VEX IQ plan (`docs/viqrc-plan.md`). Real responses, not hand-written.

| File | Source | Notes |
|---|---|---|
| `event-65767-ms-qualification.json` | test Worker `/api/events/65767` | 2026-27 Level Up, Middle School, 1 division, 112 teamwork matches, no finals |
| `event-61958-es-two-divisions.json` | test Worker `/api/events/61958` | 2025-26, Elementary, Division A/B plus an empty `Final` division |
| `team-86995D-season-203.json` | test Worker `/api/teams/86995D?teamId=186306&season=203` | Its `ratingHistory` is the V5 VCR wrongly run over IQ matches - kept to show the leak |
| `skills-203-middle-school-top40.json` | `events.vex.com/api/seasons/203/skills?grade_level=Middle%20School` | first 40 rows |
| `skills-203-elementary-top40.json` | same, `grade_level=Elementary` | `Elementary School` is rejected by this endpoint |

What these show:
- A teamwork match is two one-team "alliances" coloured red and blue that carry the same score.
- IQ ranking rows have `wins`, `losses`, `ties`, `wp`, `ap`, `sp` all 0; only `high_score` is meaningful in the
  current route output (it drops the upstream average/total fields - unconfirmed without a token).
- Finals are not in rounds 2-6, so the current event route never returns them.
