# Rules Spec (draft for team review)

The rules the GB system applies at every step, with the **recommended value** and **why**. Once the team agrees,
the tampering scenarios are written from these rules (each scenario = one rule exercised), and the code is built
to make them pass.

Values marked **(verify)** depend on a real-world fact we haven't confirmed yet. Design background: `docs/core_solution.md`.

Severity scale used below: **Critical** (act now) · **High** (act today) · **Medium** (review) · **Info** (awareness).

---

## 0. General rules (apply everywhere)

| ID | Rule | Recommended | Why |
|---|---|---|---|
| G1 | Which clock decides time-based rules | **Event time** from the pole's GPS clock, not the server's receive time. Server also stores receive time. | Offline poles upload late; expiry, hours and quotas must follow when things actually happened. Also makes scenarios replayable. |
| G2 | Clock tampering | Event time vs receive time differs by **> 2 min while online** → **High** `CLOCK_SKEW` | A pole whose clock is moved could fake trips into permitted hours. |
| G3 | Default deny | Not positively identified = not allowed. No pass, no legal exit. | Core principle: uncertainty never helps the Vendor. |
| G4 | Exact matching | Plates and FASTags matched exactly; never "nearest registered plate". | Fuzzy matching is how a clone slips through. |
| G5 | Silence is suspicious | Missing data (pole silent, weight missing, chain gap) is itself an alert, never ignored. | Brief requirement. |
| G6 | Nothing is deleted | Corrections are new records that reference the old one; alerts are closed with a reason, never deleted. | Tamper-evidence and disputes. |
| G7 | Time zone | Site local time (IST) for hours windows and daily totals. | Permits are written in local time. |

---

## 1. Count (poles: radar + camera)

| ID | Rule | Recommended | Why |
|---|---|---|---|
| C1 | When is a movement counted | Vehicle crosses **both virtual lines in order** (A→B = OUT, B→A = IN). Stopping or reversing inside the gate isn't counted. | No double counts from queues, creeping or turning back. |
| C2 | Which vehicles are trips | **Heavy vehicles (length ≥ 6 m)** going **OUT** at an exit. Lighter vehicles logged, not trips; both barriers **lift for them without a pass**. | Trucks only for now. Known, accepted gap: a pickup-sized load (decided 2026-11-21). |
| C3 | Radar vs camera disagree | Radar saw it, camera didn't → **High** `CAMERA_BLIND` (count stands). Camera saw it, radar didn't → **Medium** `RADAR_FAULT`. | Radar is primary; a blinded camera is a tamper sign. |
| C4 | Duplicate trigger | Same lane, same plate, **within 30 s** → one movement. | Camera double-fires at slow speed. |
| C5 | Heartbeat | Every **60 s**. **3 missed (3 min)** → **Critical** `POLE_OFFLINE`; that gate's data marked *provisional*. | Silence is suspicious (G5). |
| C6 | Physical tamper flags | Box opened, tilt, solar output drop with sun → **High** `POLE_TAMPER`. | Pole sits on Vendor land. |

---

## 2. Identify (plate + FASTag + radar length vs GB registry)

| ID | Rule | Recommended | Why |
|---|---|---|---|
| I1 | Plate format | Normalise; standard plates need **exactly 4 digits**, valid state code; BH series supported. Invalid = unreadable. | Rejects partial reads. (Built.) |
| I2 | Length tolerance | Radar vs enrolled length within **±0.5 m**. | Measurement noise vs. catching a different truck. (Built.) |
| I3 | Identification rule, **PoC now** | **Strict:** plate + FASTag + length must all be present and agree. | Chosen to see raw behaviour first. (Built.) |
| I4 | Identification rule, **recommended next** | Identified if: (a) plate + FASTag agree + length OK; **or** (b) plate registered + length OK, **no tag** → allowed, flag `TAG_MISSING`; **or** (c) tag registered + length OK, **plate unreadable** → allowed, flag `PLATE_OBSCURED`. **Never** on one identifier without length. | A lost tag or muddy plate shouldn't stop a genuine truck; length + one identifier is still hard to fake. |
| I5 | Conflicts always block | Plate and FASTag point to **different trucks**, or length out of tolerance → `MISMATCH`, **High** `POSSIBLE_CLONE`, no pass. | A conflict is never a "missing" case. |
| I6 | Repeated weak identification | Same truck flagged `TAG_MISSING` / `PLATE_OBSCURED` **more than 2 times in 7 days** → truck **on hold** for re-inspection. | Stops "tag keeps falling off" becoming a habit. |
| I7 | Mismatch consequence | Truck(s) named by the plate and by the tag → **on hold** until an officer reviews. | Freezes a possible clone pair. |
| I8 | Authorisation | Active status, within enrollment validity, RC / fitness / insurance / permit not expired, VAHAN verified. Computed at event time. | Expiry applies automatically. (Built.) |

---

## 3. Trip pass

| ID | Rule | Recommended | Why |
|---|---|---|---|
| P1 | When issued | Only at **entry**, only after Identify = authorised **and** Compare checks pass (P2, CP5, CP9, exit available). | The GB, not the Vendor, creates every pass, triggered by a GB sensor. |
| P2 | One open pass per truck | Truck already has an open pass → refused, **High** `CLONE_SUSPECT`, truck **on hold**. | A second copy of the plate can't get a second pass. |
| P3 | Pass content | pass id, plate, FASTag id, entry gate + time, empty weight, expiry; **digitally signed (Ed25519)**. QR in the app; **8-character SMS code** derived from the pass with a GB-only key (checkable offline). | Can't be forged; works on basic phones. |
| P4 | Expiry | **2 hours** after issue (site-configurable; set from measured normal turnaround × 1.5). | Short window limits side-route trips during an open pass. Earlier draft said 3 h. |
| P5 | Normal close | At **any working exit**: QR or SMS code valid + not used + not expired + plate and FASTag match the pass → **barrier lifts**, pass closed with net tonnes. | Single, verifiable exit event. |
| P6 | Reuse | A closed or used pass presented again → rejected, **High** `PASS_REUSE`, barrier stays down. | Screenshots can't be reused. |
| P7 | Wrong truck | Pass valid but plate/FASTag at exit ≠ pass → rejected, **High** `PASS_MISMATCH`, both trucks on hold. | Pass can't be handed to another truck. |
| P8 | Tampered pass | Signature or code invalid → rejected, **High** `INVALID_PASS`. | Forgery attempt. |
| P9 | No QR / code at exit | Close by **plate + FASTag + length** matching the truck's open pass, flag **Medium** `CLOSED_WITHOUT_QR`. Limit **1 per truck per day**; beyond that, barrier stays down until an officer approves. **Not allowed for a truck on hold** → **High** `NO_QR_ON_HOLD`. | Dead phones happen; the limit stops it becoming routine. A held identity may be cloned: without the hold rule a clone that forced its way in could close the real truck's pass by claiming a dead phone (found by the site-level simulation, 2026-11-21). |
| P10 | Expired, truck still inside | At expiry → **Medium** `PASS_EXPIRED` (possible side route). The trip **stays counted** against the quota. | Can't free quota by "disappearing". |
| P11 | Expired pass presented at exit | Barrier stays down; officer can approve a **late close** (flag `LATE_CLOSE`). Trip counted. | Keeps late trips visible without stranding trucks. |
| P12 | Leaves with no pass | At the exit with no pass to close (e.g. came in by a side track) → barrier stays down, **High** `NO_PASS`. If it **breaks through**, the OUT is counted with no pass closure → **illegal trip**, **Critical** `ILLEGAL_TRIP` + `BARRIER_FORCED`. | The 100-vs-200 case. |
| P13 | Quota reservation | Issuing **reserves 1 trip**; closing confirms it. Reserved trips are only released by an officer with a reason. | No over-issuing; no silent quota recovery. |
| P14 | Offline pole | Pole holds **5 pre-allocated passes**; issues / checks locally, syncs later; when used up → refuses. | Works through network outages without over-issuing. |
| P15 | Hours window and open passes | No pass issued outside permitted hours. A truck with an open pass may exit up to **30 min after** the window ends; later exits flagged `OUTSIDE_HOURS`. | Last trip of the day isn't punished; night trips are. |

---

## 4. Compare (against the permit)

| ID | Rule | Recommended | Why |
|---|---|---|---|
| CP1 | Permit limits | **Trips**, **tonnes**, **distinct vehicles**, **period** (from–to dates) and **daily hours**. Entered by the GB once per contract. | The brief's four limits. |
| CP2 | Legal trips | Passes **closed** (incl. flagged closes). | Paperwork side, generated by the GB. |
| CP3 | Actual trips | Heavy-vehicle **OUT movements at exits** (radar). | Reality side. |
| CP4 | Illegal trips | Actual OUTs not matched to a pass closure (**each one recorded individually**). Invariant: every OUT matches **exactly one** closure. | Exposes the gap trip by trip. |
| CP5 | Warnings | **80%** → Info, **90%** → Medium, **100%** → **High** and **pass issuing stops** for that limit. | Early warning, then hard stop. |
| CP6 | Over the limit | Any trip beyond 100% (illegal by definition) → **Critical** `LIMIT_EXCEEDED`. | |
| CP7 | Vehicles limit | Distinct trucks with ≥ 1 pass in the period; a new truck beyond the limit → no pass, **High** `VEHICLE_LIMIT`. | Stops fleet padding. |
| CP8 | Tonnes | Legal tonnes = sum of **measured net tonnes** on closed passes. | Royalty is per tonne. |
| CP9 | Vendor report | Compared **daily**. Vendor trips **below GB actual** → **High** `UNDER_REPORT` (message says if it is even below GB legal). Vendor tonnes below GB weighed tonnes by more than **2% (min 0.5 t)** → **High** `UNDER_REPORT_TONNES`. | Under-reporting (E1). Vendor figures never used as the source. Built 2026-11-21: one High rule instead of the Medium/High split, because "below legal" is always also "below actual". |
| CP10 | Monthly mass balance | Extracted (GB drone survey) vs dispatched (gate tonnes) + stockpile change. Gap **> 10%** → **Critical** `MASS_BALANCE_GAP`. **(verify survey + density accuracy)** | Catch-all for side routes and broken poles; 10% leaves room for survey/density error. |
| CP11 | Offline data | Totals from an offline pole shown **provisional** until synced. | Honest numbers. |

---

## 5. Measure (GB weigh pad)

| ID | Rule | Recommended | Why |
|---|---|---|---|
| M1 | Net load | **Exit weight − entry weight** (entry pad); fallback: enrolled empty weight. | Measured, not assumed. |
| M2 | Arrived loaded | Entry weight > enrolled empty weight **+ 1.0 t** → **Medium** `ARRIVED_LOADED`. | Material brought in to be re-dispatched, or a different truck. |
| M3 | Overload | Net > rated capacity → **Medium** `OVERLOAD`; > **10%** over → **High**. Quota counts the real tonnes. Exit still allowed (safety + evidence). **(verify legal tolerance under Indian rules)** | Most common real fraud; blocking a loaded truck at the gate creates a safety problem. |
| M4 | Weigh pad bypassed | Movement counted but no weight → **High** `WEIGH_BYPASS`. | Silence is suspicious. |
| M5 | Empty exit | Net **< 0.5 t** → **Medium** `EMPTY_EXIT`; pass closes, trip still counts (P13). | Prevents quota games; officer can release. |
| M6 | Vendor weighbridge | GB vs Vendor weight differs by **> 2% (min 0.5 t)** → **Medium** `WEIGHBRIDGE_DISCREPANCY`. **(verify certified weighbridge accuracy class)** | Exposes rigged Vendor weighbridges. |

---

## 6. Act

| ID | Rule | Recommended | Why |
|---|---|---|---|
| A1 | Barriers (entry and exit) | **Entry** barrier lifts **only when a pass is issued**; **exit** barrier lifts **only on a valid pass close** (or a logged GB officer override). Never opens for the Vendor. | Turns "detect" into "prevent". Entry refusal happens while the truck is still empty, so there is no loaded truck at the exit to pressure an officer (decided 2026-11-21). |
| A2 | Barrier forced | Impact / arm opened without permission → **Critical** `BARRIER_FORCED` + photo/video; trip treated as illegal (P12). | Makes cheating a recorded act of force. |
| A3 | Barrier / pole down | Gate **fails closed**; GB override only (one-time code to an officer), every use logged and flagged. | No silent fail-open. |
| A4 | Truck on hold | Set automatically by I6, I7, P2, P6, P7; released only by an officer **with a reason**, and **not by the officer who raised the review** (maker-checker). | Clone pairs frozen until reviewed. |
| A5 | Channels | Critical: dashboard + **SMS immediately**. High: dashboard; SMS if not acknowledged in **15 min**. Medium / Info: dashboard + daily digest. | Right urgency per level. |
| A6 | Escalation | Critical not acknowledged in **10 min** → supervisor; High in **2 h** → supervisor. | Detection that nobody acts on fails (Colombia evidence). |
| A7 | Auto-confirmed alerts | Fact-based: `ILLEGAL_TRIP`, `LIMIT_EXCEEDED`, `BARRIER_FORCED`, `POLE_OFFLINE`, `RECORD_TAMPERED` → confirmed automatically, can't be dismissed. | Officers can't sit on facts. |
| A8 | Review | Other alerts: Open → Acknowledged → Confirmed / Dismissed (**reason ≥ 10 characters**) → Closed. Never deleted. | Accountable review. |
| A9 | Incidents | Same alert type + same gate **within 60 min** → one incident with drill-down. | Avoids alert floods. |
| A10 | Vendor notice | Generated for every **confirmed** incident with its evidence pack; sent daily. Penalties are the GB's decision. | Evidence, not policy. |

---

## 7. Record

| ID | Rule | Recommended | Why |
|---|---|---|---|
| R1 | What is recorded | Every movement, identify result, pass event, weight, alert, review and registry change, **append-only**. | Full audit trail. |
| R2 | Chain | Each entry stores the **SHA-256 hash of the previous entry**; any edit or deletion breaks the chain. | Tamper-evident. |
| R3 | Device signing | Each pole signs its movement records with its own key; server rejects unsigned / wrongly signed records → **High** `UNSIGNED_EVENT`. PoC: simulated pole keys. | Fake events can't be injected. |
| R4 | Daily anchor | At **23:59** the chain head hash is sent to the Vendor and a public timestamp service. | Even GB staff can't rewrite history quietly. |
| R5 | Verification | Chain verified **hourly** and on demand; any break → **Critical** `RECORD_TAMPERED` (auto-confirmed). | Detects insiders. |

---

## Decisions the team needs to make

1. **Pass expiry (P4):** 2 h recommended (was 3 h). Agree, or measure the site's turnaround first?
2. **Relaxed identification (I4):** adopt now, or keep strict for the demo?
3. **Empty exit still counts (M5, P13):** agree that only an officer can release a reserved trip?
4. **Overload at the gate (M3):** flag and let it go (recommended), or block?
5. **Mass-balance threshold (CP10):** 10%?
6. **Escalation timings (A5, A6):** 10 min / 15 min / 2 h OK?

## Facts to verify

- Legal overload tolerance for trucks in India (M3).
- Accuracy class / permitted error of certified weighbridges (M6).
- Realistic accuracy of drone volumetric surveys and density sampling (CP10).
