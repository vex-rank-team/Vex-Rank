# Vex-Rank

Vex-Rank is a VEX V5 ranking and statistics project built around **VCR 2.0 (VEX Competitive Rating)**. VCR estimates current competitive strength from official results and rewards performance above expectation rather than attendance, awards, geography, or reputation.

## How VCR works

Each team has an internal strength rating (`mu`) centered at 1500 and a rating deviation (`RD`) that represents uncertainty. The public score is a conservative 0–1000 transformation:

```text
ConservativeMu = mu - 0.75 × RD
PublicVCR = clamp(0, 1000, 500 + 1.25 × (ConservativeMu - 1500))
```

New or inactive teams have more uncertainty, so their public rank remains conservative until enough reliable evidence is available. Ratings carry partially between seasons, while acknowledging that a new game, robot, roster, and strategy can change a team's strength.

At the end of an event, four distinct signals are combined:

| Component | Weight | What it measures |
| --- | ---: | --- |
| Match performance | 55% | Wins, ties, losses, score margin, and opponent strength |
| Contribution | 18% | Adjusted offense, defense, and residual scoring contribution |
| Autonomous | 10% | Autonomous outcomes and estimated individual contribution |
| Event result | 17% | Qualification and elimination performance versus expectation |

```text
DeltaVCR = 0.55 × DeltaMatch
         + 0.18 × DeltaContribution
         + 0.10 × DeltaAuto
         + 0.17 × DeltaEventResult
```

The final internal change for one event is capped at ±100 points. Match updates use an Elo-style expected result with a bounded margin-of-victory adjustment. Partner credit is divided using available contribution evidence instead of assuming both partners contributed equally.

## Event strength and weighting

The Event Strength Score (`ESS`) is a 0–100 measure calculated from frozen pre-event information. It considers field strength, field depth, elite-team density, regional calibration, format quality, and regional diversity. The event tier and weight are frozen before matches begin so results cannot retroactively make their own event look stronger.

Event Weight applies to tournament-level surprise. Beating expectations at a strong event creates more upside, while a highly rated team falling short at a weak event still receives meaningful downside. Ordinary match updates are not multiplied by Event Weight because opponent ratings already represent match difficulty.

## Processing flow

For each event, the model:

1. Freezes entrants, ratings, uncertainty, event strength, tier, and weight.
2. Processes official matches chronologically against pre-match expectations.
3. Fits regularized offense, defense, autonomous, and contribution estimates.
4. Calculates qualification and elimination results against frozen expectations.
5. Blends the four rating components and applies the event cap.
6. Updates team strength and uncertainty, then records an auditable breakdown.

## Design rules

- Judged awards never affect VCR, event strength, offense, defense, or regional strength.
- Raw scoring statistics are normalized within the current game season.
- Missing data, no-shows, disqualifications, and incomplete autonomous details use explicit reliability factors.
- Repeated local opposition reduces the amount of new information without erasing the result.
- Older evidence decays in leaderboard calculations; inactivity increases uncertainty rather than declaring that a team became weaker.
- Regional rankings filter the same global model. Geography is not a permanent bonus or penalty.
- Public results should show the old rating, each component change, event weight, confidence, and new rating.

The published constants are launch defaults. They should be evaluated through chronological backtesting against match prediction, calibration, and future-event performance before later versions change them.

## Documentation

- [Engineering notebook (PDF)](output/pdf/VEX_Rank_Engineering_Notebook_2026-09-23.pdf) — 326-page dated design, implementation, testing, and release history through September 23, 2026.
- [Engineering notebook (editable Word document)](output/document/VEX_Rank_Engineering_Notebook_2026-09-23.docx)

- [VCR 3.0 candidate: corrected event settlement](docs/VCR-3.0-revision.md) — implemented in the live ranking API, team history, and historical builder with winner safeguards, an auditable event ledger, exact formulas, and scenario tests. It remains a candidate until historical calibration and deployment.

- [Full VCR 2.0 algorithm documentation](output/pdf/vex_competitive_rating_full_algorithm.pdf)
- [VCR technical specification](output/pdf/vex_competitive_rating_specification.pdf)
- [Algorithm flowchart (Lucidchart)](https://lucid.app/lucidchart/155358d5-0829-4c12-bbc1-64ef25e11112/edit?viewport_loc=-510%2C10%2C2540%2C1251%2Cp5&invitationId=inv_cc466bb8-1ad0-44d9-8f3d-b37c83503b93)
- [Project setup and structure](docs/SETUP.md)

The editable PDF sources are `build_full_algorithm_pdf.py` and `build_vcr_pdf.py`.

## Repository structure

- `website/` — React website, API routes, ranking scripts, database schema, public assets, and lockfile
- `output/pdf/` — generated algorithm documents
- `build_full_algorithm_pdf.py` — source for the complete VCR 2.0 document
- `build_vcr_pdf.py` — source for the shorter technical specification
- `docs/SETUP.md` — development and document-generation instructions

## Run the website locally

Requires Node.js 22.13 or newer and pnpm.

```sh
cd website
pnpm install --frozen-lockfile
pnpm dev
```

Live RobotEvents requests require `ROBOT_EVENTS_API_TOKEN` in the runtime environment. Keep credentials out of version control.

Other website commands:

```sh
pnpm build
pnpm lint
```

## Regenerate the PDFs

Install Python and ReportLab, then run:

```sh
python -m pip install reportlab
python build_full_algorithm_pdf.py
python build_vcr_pdf.py
```

The generated PDFs are written to `output/pdf/`.

