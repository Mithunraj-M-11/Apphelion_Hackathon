# Threat coverage plan (P0 and P1 cases)

Purpose: stage every P0 / P1 cheat from `docs/tampering_cases.md` in the simulator, defended or not, and compare
with ground truth. Whatever the GB misses (or misses silently) shows up as a measured gap. Then we fix the biggest
and the silent gaps first, and run again.

How to read the table:
- **How we stage it**: what the simulator acts out. Staging never needs the defence; the simulator only needs to
  act out the cheat and keep the ground truth.
- **What the GB should do**: the ideal response, whether we built it or not. A story is judged against this.
- **Today (expected)**: what happens with the current code. *Caught* = the right alert / refusal. *Partial* =
  caught in some variants or late. *Silent gap* = material moves and the GB raises nothing. *Gap* = noticed only
  indirectly or not at all.
- **Where**: `S` = a `threat_coverage` scenario story (one cheat at a time), `W` = part of the `threat_week` site
  run (all cheats mixed in a realistic week).
- **New staging?**: whether the simulator needs a new ability to act it out (not a new defence).

---

## P0: core

| # | Cheat (variant) | How we stage it | What the GB should do | Today (expected) | Where | New staging? |
|---|---|---|---|---|---|---|
| A1 | Unregistered truck at the gate | Outside truck, own plate, no GB sticker | Refuse at entry, alert | **Caught** (UNREGISTERED_VEHICLE) | S, W | No |
| A1 | Extra truck working by side tracks only | Outside truck loads and leaves by side tracks | Show up in a volume check (mass balance) | **Silent gap** (never at a gate) | W | No |
| A2 | Cloned plate + cloned FASTag, real truck inside | Copy arrives while the real one has an open pass | Refuse, hold both | **Caught** (RFID_CLONED / CLONE_SUSPECT) | S, W | No |
| A2 | Cloned plate + FASTag + copied sticker UID, real truck away | Copy arrives alone | Refuse (chip can't answer) | **Caught** (RFID_CLONED) | S, W | No |
| A2 | **Full transplant**: real plate, real FASTag and the real GB sticker moved onto another truck of the same size | Truck Y wears X's three identifiers; X is parked | Notice the body is different (e.g. empty weight at entry far from X's enrolled empty weight; sticker removal leaves a tamper mark) | **Gap**: passes as X; only caught if X is also working at the same time | S, W | Yes: a "transplant" vehicle (Y's weights with X's identifiers) |
| A3 | Plate swapped between two registered trucks | Truck Y shows X's plate, its own FASTag and sticker | Refuse, hold both | **Caught** (POSSIBLE_CLONE: plate and tag disagree) | S | No |
| B1 | Side track in, GB exit out | No entry event; arrives at exit with no pass | Refuse at exit; force = illegal trip | **Caught** (NO_PASS; ILLEGAL_TRIP if forced) | S, W | No |
| B1 | GB entry with a pass, side track out | Pass never closed | Unresolved trip flagged, truck blocked next time | **Partial**: caught late (pass expiry, UNRESOLVED_TRIP on return) | S, W | No |
| B1 | Side track in and out | Never at a gate | Volume check (mass balance) or perimeter sensing | **Silent gap** | W | No |
| E1 | Vendor under-reports trips / tonnes | Daily report lower than reality | Daily mismatch alert against GB gates | **Caught** (UNDER_REPORT), limited to what the gates saw | W | No |
| E3 | Old QR reused / QR handed to another truck / edited QR | As in `gate_cheats` | Refuse at exit | **Caught** (PASS_REUSE / PASS_MISMATCH / INVALID_PASS) | S, W | No |
| E3 | Fake gate event posted to the GB API (someone on the network fakes a pole) | POST an exit event that closes a pass without a real truck | Reject: the event isn't signed by a real pole | **Silent gap**: the gate API accepts anything | S | No (just a POST without pole credentials) |
| D1 / D10 | Pole loses power or is smashed, trucks keep moving | Pole stops sending events for a period; trucks cross; ground truth records them | Pole heartbeat missing = alert within minutes; barrier stays down without power (fail-closed), so crossing means forcing it | **Silent gap**: nothing notices the silence; trips during the outage are invisible | S, W | Yes: pole outage window (events not delivered, heartbeat stops) |
| D2 | Network cut between pole and GB server | Pole works but events arrive late (or never) | Pole keeps deciding locally and uploads later; gap in arrival flagged | **Partial**: edge design exists, but in the PoC events are posted live, nothing flags a delay | S, W | Yes: delayed delivery of events |
| G2 | Move only while a pole is down | Cheats timed inside the outage window | Same as D1, plus extra scrutiny of what passed during it | **Silent gap** | W | Yes (same outage ability) |

## P1: high

| # | Cheat (variant) | How we stage it | What the GB should do | Today (expected) | Where | New staging? |
|---|---|---|---|---|---|---|
| C7 | Overloaded truck | Load above rated capacity | Allow (trip is real), overload alert | **Caught** (OVERLOAD) | S, W | No |
| A8 | Raised sides / extended body | Registered truck carries far more than its rated load | Same as overload, by weight | **Caught** by the GB weigh pad (OVERLOAD) | S, W | No |
| C1 | Weigh pad bypassed | No weight reading at exit | Alert, net tonnes unknown | **Caught** (WEIGH_BYPASS) | S, W | No |
| C3 | GB weigh pad tampered (drift or remote chip reading low) | Pad reports e.g. 3 t less than the real weight; ground truth keeps the real one | Detect drift: empty trucks at entry should weigh their enrolled empty weight; a steady offset across trucks = calibration alert | **Silent gap**: tonnes under-recorded, no alert | S, W | Yes: weigh pad offset for a period |
| F1 | Digging beyond the boundary / depth | Tonnes really extracted vs tonnes that left through gates | Survey (drone) volume vs gate tonnes (mass balance) | **Gap**: not a gate problem; mass balance not built | (slide) | Out of PoC staging |
| D3 / D11 | Plate unreadable (mud, rain, night) on a **genuine** truck | Plate read missing or wrong for some honest trucks | Let a genuine truck through when FASTag + GB sticker agree; flag the plate | **Gap the other way**: strict Identify refuses honest trucks (false alarms, blocked work) | S, W | Yes: plate misread / miss rate |
| D3 / D11 | Plate deliberately covered by a cheat | Cheat truck with no readable plate | Refuse (default deny) | **Caught** (UNIDENTIFIED) | S | No |
| D3 / D11 | FASTag read fails (shielded, faulty) on a genuine truck | FASTag missing for some honest trucks | Same as plate: sticker + plate enough, flag the tag | **Gap the other way**: refused | S, W | Yes: FASTag miss rate |
| B3 | Night trip at a gate | Entry outside hours | Refuse | **Caught** (OUTSIDE_HOURS) | S, W | No |
| B3 | Night trip by side track | Outside hours, never at a gate | Volume check | **Silent gap** (same as B1) | W | No |
| E5 | Bribed officer lets refused trucks out | Officer uses "let out" on trucks that shouldn't pass (expired or no valid reason) | Two-person approval, or a pattern alert per officer (too many overrides) | **Gap**: each override is a Medium alert, but they look legal and nothing spots the pattern | S, W | Yes: officer actor in the site run |
| E5 | Bribed officer releases clone holds | Officer releases holds so a clone can work | Same; release needs a second officer or evidence | **Gap** | S, W | Yes (same) |
| E2 | Stored records edited or deleted | After trips, delete or change gate events / passes in the database | Hash chain: the daily check reports which records were altered | **Silent gap**: no chain | S | Yes: direct database edit step |

## Not in P0 / P1 but found in our own review (worth staging)
| Cheat | Why include it | Today |
|---|---|---|
| Light vehicle carrying material (pickup under 6 m) | Our own rule C2 lets it through uncounted | **Gap** by design (accepted) |
| Officer identity: anyone can pick any officer in "Acting as" | Makes E5 untraceable | **Gap** (no login in the PoC) |

---

## The `threat_coverage` suite (scenario runs)
- One story per row marked `S` above, written from the attacker's side, judged against **What the GB should do**.
- Separate from `gate_cheats`, which stays the regression suite (everything we built still works).
- Scorecard per case: **covered / partial / gap / silent gap**, which is the gap list.

## The `threat_week` site run
A normal week of honest trucks with every `W` row mixed in, plus:

| Assumption (stated in the report) | Value |
|---|---|
| Days, fleet | 7 days, 10 trucks, permit well above normal use |
| Pole outage | 2 outages a week, 30 to 90 min each; trucks keep moving through them |
| Network delay | 1 period a week where events arrive 1 to 3 h late |
| Weigh pad drift | from day 4, the pad reads 3 t low |
| Plate misread / miss | 3% of reads on honest trucks |
| FASTag miss | 2% of reads on honest trucks |
| Bribed officer | 1 officer, 2 to 3 improper "let out" or hold releases a week |
| Side tracks both ways | 0.5 a day |
| Full transplant | 0.3 a day |
| Database edit | none in the week (staged as a separate story) |

The report adds, next to today's numbers: **trips and tonnes missed, by cause**, and how many were missed
**silently** (no alert at all).

## Building order
1. Staging abilities (simulator side): pole outage window, delayed delivery, weigh pad offset, plate / FASTag
   misreads, officer actor, transplant vehicle, database edit, unsigned gate event.
2. `threat_coverage` stories + `threat_week`; run both; record the gap numbers.
3. Defences, biggest and silent gaps first (likely order: pole heartbeat + fail-closed barrier, pole authentication,
   weigh pad drift check, hash chain, officer-action oversight, relaxed Identify with sticker + FASTag).
4. Run again and show before / after.

---

## Results: before and after the first round of defences (2026-11-23)

Defences built: weigh pad drift check A (median of entry weight minus enrolled empty weight over recent trucks),
pole heartbeat + POLE_SILENT, LATE_EVENT, pole-signed events (unsigned = refused + FAKE_GATE_EVENT), hash chain +
record check (RECORD_TAMPERED), body check at entry (BODY_MISMATCH), light vehicles weighed in and out
(LIGHT_VEHICLE_LOADED), officer override pattern (OFFICER_OVERRIDE_PATTERN).

| Run | Before | After |
|---|---|---|
| `threat_coverage` (scenario run) | 15 covered, 1 partial, 3 gap, 11 silent of 30 | **24 covered, 3 gap, 4 silent of 31** (C3b added) |
| `threat_week` (site run) | 25 covered, 6 gap, 10 silent of 41 attempts | **29 covered, 8 gap, 4 silent** of 41 |
| `gate_cheats` / `edge_resilience` | 34/34, 7/7 | 34/34, 7/7 (no regressions) |

Still open, for the second pass:
- **Side tracks both ways** (A1b, B1c, B3b): needs a volume check (mass balance). Gap 7.
- **Strict Identify refuses genuine trucks** on a missed or misread plate / FASTag (D3a, D3b, D3c; 29 false alarms
  in the week). Gap 10.
- **Weigh chip that reads low only when loaded** (C3a; ~400 t in the week): method A can't see it because empty
  trucks read correctly. Needs a reference weight test or a fleet-wide load-drop check. It also hides light vehicles
  carrying material (their loaded exit reads light).
- Officer cover-ups are now flagged as a pattern (gap), but the trip still counts as legal until reviewed.

## Results: second pass (gap 10 and gap 1 B / C, 2026-11-23)

Defences built: relaxed Identify (GB sticker + plate or FASTag + length is enough; PLATE_UNREADABLE /
FASTAG_UNREAD / PLATE_MISREAD as Medium flags; IDENTIFIER_REPEATEDLY_MISSED after 3 in a day; a plate naming another
registered truck stays a mismatch), fleet-wide load-drop check (LOAD_DROP: today's median load share under 90% of
earlier days), and an unannounced daily reference weight test (WEIGH_DRIFT when a known load reads off by > 0.3 t).

| Run | After round 1 | After second pass |
|---|---|---|
| `threat_coverage` | 24 covered, 3 gap, 4 silent of 31 | **28 covered, 3 silent** of 31 |
| `threat_week` | 29 covered, 8 gap, 4 silent; **27 false alarms** | 29 covered, 8 gap, 5 silent of 42; **0 false alarms**, 0 honest trucks refused |
| `gate_cheats` / `edge_resilience` | 34/34, 7/7 | 34/34, 7/7 |

In the week the rigged pad (3 t light when loaded, from day 4) is caught on day 4 by the reference test and by
LOAD_DROP on each of the 4 affected days. The tonnes it took off stay wrong in the GB's records (432 t): the alert
says from when weights are suspect, it does not correct them.

Still open:
- **Side tracks** (A1b, B1c, B3b; 10 trips, 168 t in the week): volume check (mass balance) under discussion.
- **Transplant onto a similar body**: a body under 0.4 t heavier than the enrolled one passes the body check (one in
  the week, 0.5 t heavier but read within pad noise). Tighter tolerance needs real fuel / load data.
- **Light vehicle on the rigged pad**: its exit reads light too; flagged pad, but the load itself is missed.

## Results: mass balance (gap 7, 2026-11-23)

Weekly GB survey (RTK drone photogrammetry; monthly LiDAR and quarterly satellite as cross-checks; GB-owned check
pillars, surveys over 5 cm check error rejected; random day each week). Ore that left = volume dug x in-situ density
- stockpile increase, against what the GB gates weighed out. Alerts: VOLUME_MISMATCH (> 5% in a week), VOLUME_TREND
(> +2% three weeks running), VOLUME_CUMULATIVE (since the first survey, > 5% of an average week; the error of a
long period stays about one week's error in tonnes because the middle terrain models cancel), EXTRACTION_OUTSIDE_PLAN.
Staging: one error per terrain model, so each week's error is within +/-3%.

| Run | Survey result |
|---|---|
| `brief_case` (permit 100, 206 really moved) | +57.5% in week 1: VOLUME_MISMATCH. All 77 side-track attempts become gaps (leakage known, not which trip) |
| `threat_week` (rigged pad + side tracks) | +18%: VOLUME_MISMATCH (the gates' weights are wrong and material leaked) |
| `threat_month` (4 weeks, honest pad, 4-6% leakage a week) | weeks: +3.8%, +5.8% MISMATCH, +4.6% TREND + CUMULATIVE, +3.1% TREND |
| `threat_coverage` | side-track stories scored "period-level": 28 covered + 3 period-level of 31, no gaps |

Limit: a few side-track trips a week (under about 2% of the volume) stay below what the survey can see.
