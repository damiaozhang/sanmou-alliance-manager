# Battle Statistics Model

How Sanmou Ledger turns raw alliance battle records into the win rates shown in the
Lineup Center. This is the normative description — the frontend and any analysis
script must follow it.

## Where the data comes from

Battle records are produced by the passive alliance listener and written as one JSON
object per line:

```
{output_root}/<workspace>/<capture_YYYYMMDD_HHMMSS>/alliance_protocol/alliance_battles.jsonl
```

`BATTLE_GRABBER_V6_OUTPUT_ROOT` overrides the root (defaults to the app-data folder).
Scan **every** workspace and capture — a new season or a new day starts a new
workspace, so picking "the biggest directory" is wrong.

## Record types: one engagement, many duels

Two armies meeting is not a single fight. It is a **queue relay**:

1. Attacker army **A** engages defender army **B**.
2. The loser (troops reduced to 0) leaves the field and the **next army in that
   side's queue** steps up.
3. This repeats until one queue is exhausted — the side still holding the tile wins
   the engagement.
4. If the round cap is reached with both sides alive, the duel is a **draw** and both
   sides disengage.

That maps onto two record types:

| `recordType` | Meaning | Notes |
|---|---|---|
| `block` | The **final** duel of an engagement, carrying the engagement outcome | Always a full 3-hero lineup with real troop counts |
| `child` | An **intermediate** duel of the same engagement | May be a depleted lineup; some troop fields hold the hero count instead (values ≤ 100) and must be skipped |

`child.parentBattleId` points at the owning `block.battleId`. A `block` may own many
`child` records.

**Both record types are complete, independent 1v1 duels.** They are not duplicates
and must not be deduplicated against each other.

## The two win-rate scopes

| Scope | Records counted | Answers |
|---|---|---|
| **Engagement (tile) win rate** | `block` only | Who holds the tile — the outcome of the whole engagement |
| **Duel win rate** | `block` + `child` | True lineup strength, duel by duel |

These can differ wildly for the same matchup, and that difference is meaningful: it
reflects how deep each side's queue is (how many players stack on one target), not a
data error.

Worked example — side *A* pushes a tile held by side *B*:

- `child`: A's army **beats** B's first army, leaving 15,622 troops vs 0.
- `block`: the same A army **loses** to B's second army, 0 troops vs 15,567.

Both are correct: one army won its duel, then died to the next in the queue. The
`block` record is the final duel, so A lost the engagement.

## Filters

Applied to every statistic:

1. **Deduplicate** by `(battleId, recordType)`, keeping the row with the largest
   `timeStamp`.
2. **Matchup filter** — keep only rows where `attackAlliance` and `defendAlliance`
   are the two sides being compared, in either order. Otherwise battles against
   third parties leak in.
3. **Lineup quality filter** (defaults, tunable):
   - `totals.armyTroops >= 5000`
   - every hero `level >= 46`
   - `totals.armyTroops <= 100` means the field holds a hero count, not troops → skip
   - lineup statistics additionally require a full 3-hero lineup
4. **Draws** (`winnerSide == "draw"`) count toward appearances only, never toward
   wins or losses.

## Key fields

```
top level : battleId, recordType(block|child), parentBattleId,
            attackAlliance, defendAlliance          # plain strings, not objects
            winnerSide                              # attacker_win | defender_win | draw
            winnerArmyId, attacker{...}, defender{...}
side      : player{name, allianceName}, armyId, heroes[], totals{armyTroops}, formationName
hero      : heroId, name/displayName, evolution, enlighten, level, remainingTroops
```

`redness score = sum(evolution) * 100 + sum(enlighten)` — e.g. 15 evolution and 15
enlighten totals 1515.

## Computation

```python
duels = [b for b in battles if b.recordType in ("block", "child")]  # every row is a 1v1

for b in duels:
    if b.winnerSide == "draw":
        appearances += 1
        continue
    winner = b.attackAlliance if b.winnerSide == "attacker_win" else b.defendAlliance
    duel_wins[winner] += 1
    if b.recordType == "block":
        engagement_wins[winner] += 1

duel_win_rate       = duel_wins[A]       / (duel_wins[A] + duel_wins[B])
engagement_win_rate = engagement_wins[A] / (engagement_wins[A] + engagement_wins[B])
```

Lineup win rates, red-tier stratified win rates and the matchup counter table all use
the **duel** scope, grouped respectively by sorted 3-hero key, red-tier bucket, and
the two opposing lineups.

Tier buckets: `full red (≥15)`, `high (10–14)`, `mid (5–9)`, `low (<5)`.

## Sanity checks

Reproducible invariants — re-run these if the numbers ever look wrong:

1. Every `child` shares an `armyId` with one of the `block` sides (the relay army).
2. No `child` loser (0 troops) is the `block` winner — a dead army cannot relay.
3. For every record, `winnerSide` agrees with the remaining troop counts
   (winner has troops, loser has 0).
4. `child` outcomes match the raw protocol's `battleSettlement.winer` (which stores
   an army id, not an enum). An empty `offensive` field on `child` is expected.
