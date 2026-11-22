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
