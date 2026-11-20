# Solutions by Case

How each tampering case (see `tampering_cases.md`) is handled, recorded one case at a time as
we agree on each solution. Later cases build on the earlier ones.

---

## Base: the exit pole
A solar-powered monitoring pole owned by the GB at **every exit**. It sits inside the Vendor's
area, because we can't assume any road outside the site.

| Part | What it does |
|---|---|
| Camera with night lighting | Photographs every vehicle and reads its plate |
| Vehicle counter (small radar) | Counts every vehicle, even when the plate can't be read (dust, mud, night) |
| Small computer + 4G SIM | Combines count + photo + plate and sends it to the GB's server |
| Solar panel + battery | Powers everything. Doesn't use the Vendor's electricity |

- Off-the-shelf kind of equipment (solar camera poles are used on highways and construction sites).
- Never uses the Vendor's power, network or servers.
- Sends an "I'm alive" signal every minute. If it stops, the GB is alerted.
- Raises an alert if the camera view goes dark or changes (covered or turned).
- Saves data locally, so a network drop delays data but never loses it.
- Possible upgrades, only if a later case needs them: thermal camera, buried axle sensor,
  LoRa/satellite backup, crypto signing details.

---

## Solution 1: Count + registry check at exits ✅ agreed
**Covers:** A1 unregistered or extra vehicles (P0) · A4 obscured plates (P2) · A5 fake or invented plates (P3)

### A1: Unregistered / extra vehicles (P0)

**Principles**
- **Count separately from identifying.** The radar counts every vehicle; the camera identifies it.
  A vehicle that's counted but not identified is never silently dropped.
- **Default deny.** A vehicle is authorized only if it's positively matched to the registry.
- **The registry belongs to the GB.** The GB enrolls each permitted truck itself. The Vendor's
  fleet list is never trusted.

**How it works**
1. A truck leaves. The pole counts it, photographs it and reads its plate.
2. The GB server checks the plate against the registry.
3. Outcome:
   - Plate registered → authorized trip, counted against the permit.
   - Plate not registered → **unregistered vehicle** alert.
   - Counted but plate unreadable or missing → **unidentified vehicle** alert.
4. Dashboard: permitted vs. actual trips, with each violation and its photo.

**PoC:** 200 exits counted. 100 match the registry; 100 are flagged (unknown, unreadable or
missing plates), each with evidence.

### A4: Obscured plates
Mud, dust, a cover or no plate means the radar still counts the vehicle, but it can't be
identified. Under **default deny** it's flagged as an **unidentified vehicle**. Hiding the plate
gets the Vendor flagged instead of hidden.

### A5: Fake or invented plates
An invented plate has no registry match, so it raises an **unregistered vehicle** alert.
(A fake copy of a *registered* plate is cloning, A2.)

**Not covered by Solution 1**
- A2/A3 (cloned or swapped registered plates).
- B1 (side routes).
- D1/D2/D10 (disabling the pole).

---

## Solution 2: Trip pass issued by the GB (entry → exit) ✅ agreed
**Covers:** E1 under-reporting · E3 phantom / reused passes (fully) · A2 cloned plates (partly) ·
D10 / G2 broken exit or moving during an outage (via legal closure) · enforces the trip limit at entry

**Core idea:** the pass is **created by the GB when a real registered truck is physically seen
entering**, never on the Vendor's request. Today's systems (e-Rawana, i3MS) let the operator
generate passes. That is what enables phantom passes and reuse.

### Flow
1. **Entry:** a registered truck arrives; the GB pole reads its plate.
2. **Issue:** the GB server checks (a) the truck is registered, (b) quota is left, (c) the truck has no
   other open pass, then sends a **one-time QR pass** to the GB app on that truck's registered device.
3. **Inside:** the pass has an **expiry** (e.g. 3 hours). A truck still inside after expiry is flagged.
4. **Exit:** the **GB pole's camera scans the QR code** (self-service, no Vendor staff) and checks it
   matches the plate. The pass is closed and the trip counted.
5. **Quota reached:** no new passes are issued at entry, so no legal way to leave loaded.

### Rules and safeguards
| Rule | Why |
|---|---|
| The QR code is unique per trip, single-use, digitally signed, and bound to the plate | No reuse, sharing or forgery |
| One open pass per plate | The same plate entering again while its pass is open means a **clone alert** |
| App bound to the truck's registered device | A clone with a copied plate doesn't have the device, so it can't produce the QR code |
| Exit with a broken scanner or pole = **legally closed** | No pass can be closed there; anything passing is a violation |
| The **radar still counts independently** | A truck that skips the scan is flagged as an illegal trip. The QR code is the legal path; the radar catches the rest |
| **Offline mode:** the pole issues and checks passes locally, with a small pre-allocated quota | Works with intermittent connectivity without over-issuing |
| Non-material vehicles (fuel tankers, staff cars, maintenance) registered separately | Logged but not counted against the quota |
| Entry needs a pole (one pole covers both directions on a shared gate) | Passes are issued from observed entries |

### Matching outcomes
| Situation | Result |
|---|---|
| Entry seen → pass → exit scanned, plate matches | ✅ Legal trip |
| Exit counted by radar, no valid scan | ❌ Illegal trip |
| Same plate enters while its pass is open | ❌ Clone alert |
| Pass expired, truck still inside | ⚠️ Loitering alert |
| QR code plate ≠ plate seen | ❌ Mismatch |
| Passage through a closed exit | ❌ Violation |

### Assumptions and open points
- The GB controls the pass system (state mining dept: existing e-pass; company: per-trip
  challans), or our system provides one.
- Load per trip is assumed to be rated capacity until weight checks are added (C1/C3).
- **Remaining risk:** the Vendor runs trucks with no pass at all. Radar detects them; enforcement
  is covered separately.

**PoC:** a registered truck enters → QR code issued → exit scan closes the pass. Show a no-scan exit,
a clone entry, an expired pass, and a closed exit.

---

## Solution 3: Vehicle check beyond the plate (clone / swap detection) ✅ agreed
**Covers:** A2 cloned plates · A3 swapped plates · A7 vehicle disguise (together with Solution 2)

**Problem:** a copied or moved *registered* plate passes the registry check (S1), and the Vendor
holds the drivers' phones, so S2's device binding alone is weak.

**Enrollment (by the GB):** for each truck, record its plate, photos, **length, axle count and axle
spacing**, and **chassis number** (from the registration certificate).

**Pole hardware addition:** a **buried axle sensor** across the exit lane (standard toll-plaza
equipment, cheap, hidden). Radar already gives length.

**Checks (all deterministic, no AI decides):**
| Check | Rule | Catches |
|---|---|---|
| One open pass per plate (from S2) | Same plate enters while its pass is open → clone alert | Two trucks on one plate at once |
| **Physical match** | Radar length differs from enrolled by more than ~0.5 m, OR axle count ≠ enrolled → mismatch alert | Swaps, and clones parked while the real truck is idle |
| Per-truck plausibility | Trips per plate per day > realistic maximum → flag | Clever clones spread over a day |

- AI attributes (vehicle type, colour) are attached as **supporting evidence only**, never the sole
  reason for an alert. This holds up better in disputes and avoids false alarms from dust or lighting.
- **Field proof:** a surprise inspection checks the **chassis number** (stamped into the frame,
  very hard to fake) against enrollment.
- **Known limit:** identical trucks of the same model have the same length and axles. The
  per-plate open-pass rule and plausibility checks, plus field checks, handle these.
- Optional: a large ID number painted by the GB on the sides and rear, read by the camera.
- **Update (core review):** the trip pass catches every clone that produces **extra trips** (simultaneous use,
  no-pass exit, QR reuse). A clone that only takes turns with the real truck still uses passes and counts
  against the quota. So S3's axle and chassis checks are **nice-to-have** (exact-truck verification), not
  required for limit enforcement. See `core_solution.md` §2.7.

---

## Coverage tracker
Status of all 48 cases (see `tampering_cases.md`) against agreed solutions.
S1 = count + registry · S2 = GB trip pass · S3 = vehicle check beyond the plate · Pole = base hardware.

### ✅ Covered
| Case | By |
|---|---|
| A1 Unregistered vehicles | S1 |
| A2 Cloned plates | S2 + S3 |
| A3 Swapped plates | S3 |
| A4 Obscured plates | S1 (default deny) |
| A5 Invented plates | S1 |
| A7 Vehicle disguise | S3 |
| B2 Tailgating / convoys | S1 radar + S2 (one scan for two trucks) |
| B3 Night / off-hours | Pole (night camera, radar) + S2 (no passes outside permitted hours) |
| B5 Small vehicles | S1 (radar counts all; default deny) |
| B6 Trip loops / re-entry | S2 (strict entry → exit pairing) |
| B7 Spreading trips under limits | S2 (every trip counted against the quota) |
| D1 Power cut | Pole (solar) |
| D2 Network cut / jamming | Pole (store and forward + heartbeat) |
| D3 Camera blinding | Pole (view-change alert) + S1 (radar keeps counting) |
| D11 Dust / rain / dark | Pole (radar) |
| E1 Under-reporting | S2 (GB-generated trip records) |
| E3 Phantom / reused passes | S2 |
| E4 Backdating | S2 (GB timestamps) |
| B1 Side routes | S4 |
| B4 Trans-shipment over the fence | S4 (drone, satellite, volume) |
| G1 Blind-spot mapping | S4 (random drone patrols, hidden sensors, movable poles) |
| D10 Pole destroyed / stolen | S5 |
| G2 Moving during outages | S5 |
| C1, C2, C3, C4, C5, C7, A8 Weight and load | S6 (weigh-in-motion) |
| F1 Over-extraction, F2 Hidden stockpiles, F3 Old-stock claims | S7 (drone/satellite survey + mass balance) |
| E2 Log editing, E5 Insider collusion, E6 Evidence disputes | S8 |
| D5 Replay, D6 Fake devices, D7 Firmware, D9 Clocks | S8 (device signing, secure boot, GPS time) |

### ➖ Not applicable by design / out of scope
| Case | Why |
|---|---|
| A6 RFID tag cloning | No RFID used |
| D8 Vehicle GPS spoofing / removal | No reliance on vehicle GPS |
| F4 Blending, C6 Grade misdeclaration | Out of scope: quality, not quantity (needs material sampling) |

### ⚠️ Partly covered
| Case | Have | Missing |
|---|---|---|
| D4 Camera avoidance | Pole covers the exit lane | Full-width coverage on wide exits |
| G4 Fooling AI | Counting is radar-based; S3 is deterministic | Plate reading can still be fooled (default deny limits this) |

### ❌ Open
| Group | Cases |
|---|---|
| Trucks running with no pass (enforcement) | parked, to revisit |
| Attacks on our operations | G3, G5 |

---

## Solution 4: Side routes and perimeter ✅ agreed
**Covers:** B1 unmonitored exits / routes · B4 boundary trans-shipment · G1 blind-spot mapping

**Insight:** a loaded truck needs a drivable track that connects to a public road, so the possible
routes out are **limited**, and creating a new one **leaves visible marks and takes days**.

| Layer | What | Catches |
|---|---|---|
| 1. Route survey at setup | Satellite + ground survey marks every drivable route out. Each gets a **pole** (smaller for minor tracks) or is **blocked by the GB** (trench or earth bank) | Known routes |
| 2. Pass expiry (from S2, free) | A truck entering via a pole gate and leaving via a side route never closes its pass, so expiry alert; re-entry with an open pass, so clone alert | Trucks mixing gates and side routes |
| 3. Weekly satellite change detection | Free Sentinel-2 imagery of the boundary; a new track or a stockpile near the fence raises a "new route" alert | New routes, trans-shipment points |
| 4. Movable poles | Trailer-mounted solar camera units; towed to new routes within a day; rotated at random across minor tracks | New routes; blind-spot mapping (G1) |
| 5. Volume catch-all | Monthly volume extracted vs. trips counted; a large gap means search for the leak | Anything missed (links to F cases) |
| **6. Drone-in-a-box (primary real-time layer)** | Drone docked on site, flies **random-timed patrols** along the boundary and tracks, plus **alarm-triggered flights** to verify; thermal camera for night; video as evidence | Side-route trucks, trans-shipment, verification of all perimeter alerts |
| **7. Hidden buried vibration sensors (only on the few most likely tracks)** | Battery, LoRa, location secret; a heavy vehicle crossing raises an instant alert and the drone flies to it; a sensor going silent (dug up) is itself an alert | Continuous coverage where it matters most, including when the drone is grounded |

**Why drone primary + a few hidden sensors (decision):**
- Visible fixed devices in the Vendor's area are weak; a drone is mobile, unpredictable and brings video evidence.
- The **same drone also does volume surveys (F1–F4) and pole inspections (D10)**, which makes it good value.
- But a drone alone isn't continuous (battery, recharging), can be watched (dock times) and is
  grounded by wind, rain and dust. Hidden sensors on the most likely tracks cover those gaps
  and tell the drone where to fly.
- No legal trip uses a side route, so **any** detection there is a violation; we don't need to identify the vehicle.
- **To check:** DGCA rules for automated flights beyond line of sight (India). Fibre-optic boundary
  sensing (DAS) is a premium option for very long boundaries.

**Honest limit:** a truck on a side route at a moment when the drone is docked or grounded, on a
track without a sensor, is caught only later (satellite or volume gap, layers 3 and 5).

**PoC:** site map with exits and a blocked track; a buried sensor fires on a side track, the drone is
dispatched (simulated clip), an alert is raised; a before/after satellite image shows a new track;
a truck that left via a side route is flagged by its expired pass.

---

## Solution 5: Pole destroyed / outages ✅ agreed
**Covers:** D10 pole destroyed or stolen · G2 moving trucks during outages
(D1 power cut and D2 network cut are already handled by the pole design.)

**Goal:** know how many trucks left while the pole was dead, and make sure breaking it gains the
Vendor nothing. Almost everything reuses S2–S4.

| When | What happens | Reuses |
|---|---|---|
| 0–2 min | **Last message:** tilt or box-opening sensor sends an instant alert with a **final photo**. **Silence:** missing heartbeat raises "pole offline" within ~2 min. **Drone flies there automatically** to film the pole and exit. | Pole, S4 drone |
| Immediately | **Exit legally closed:** no pass can be closed there, so any truck leaving through it is a violation. If it's the only exit, no passes can be issued at all, so site dispatch stops. | S2 |
| During the outage | **Registered trucks** leaving through the dead exit never close their pass, so they're **flagged on expiry**. | S2 |
| During the outage | **Buried axle sensor is the backup counter.** It has its **own battery and memory**, separate from the pole, keeps counting under the road, and sends or hands over its count. | S3 hardware |
| During the outage | **Illegal trips = axle-sensor count − registered trucks caught by expiry.** | |
| Within hours | **Movable pole** (trailer unit) towed in as a temporary replacement; GB team photographs the damage. | S4 |
| Monthly | **Volume check** catches anything that still slipped through (e.g. the axle sensor also destroyed). | F cases |

**Fault or sabotage (evidence, not penalty):**
| Evidence | Suggests |
|---|---|
| Sudden tilt or box-opened signal; last photo shows people | Sabotage |
| Battery slowly running down, cloudy days | Genuine fault (exit still closed until the temporary pole arrives) |
| Drone footage | Confirms either way |
- Repeated outages at the same exit are escalated, whatever the stated reason.

**Out of scope:** contractual or penalty measures (e.g. billing outages at peak rate). Those are the
GB's policy decision; our system supplies the evidence.

**PoC:** kill a pole mid-simulation. Show the last photo and offline alert, the drone dispatched, the
exit closed, trucks flagged by pass expiry, and the axle-sensor count revealing the unregistered trips.

---

## Solution 6: Weight and load, weigh-in-motion at exits ✅ agreed
**Covers:** C7 overloading · A8 modified trucks · C1 weighbridge bypass · C3 weighbridge tampering ·
C4 tare tricks · C2 partial weighing · C5 ticket reuse

**Root problem:** today the only weight measurement is the Vendor's own weighbridge.

**Approach:** upgrade the buried exit sensor (already used for axle checks in S3 and backup counting in S5)
to a **weigh-in-motion (WIM)** strip, which measures axle loads as trucks drive over slowly
(standard highway / toll-plaza equipment).

**Per trip:** entry weight (empty) → exit weight (loaded) → **net load = exit − entry**, linked by the S2 pass.
Net tonnes are counted against the permit's **quantity limit** as well as the trip limit.

| Case | How |
|---|---|
| C7 Overloading / A8 Modified trucks | Loaded weight > legal maximum gross weight (enrollment / VAHAN) → alert; the extra weight shows regardless of body changes |
| C1 Weighbridge bypass | Our WIM weighs every exit; if Vendor weighbridge data is shared, an exit with no weighbridge record → bypass flag |
| C3 Weighbridge chip | Vendor weighbridge vs. our WIM for the same trip; a consistent gap → manipulation alert |
| C4 Tare tricks | Empty weight measured fresh every trip |
| C2 / C5 Partial weighing, ticket reuse | WIM weighs every axle in motion; weight tied to the trip's pass, not tickets |

**Accuracy and disputes:** WIM is a few percent less precise than a static weighbridge, so alerts fire only
above a tolerance (e.g. >10% over the legal limit). Flagged trucks are sent to a **certified public
weighbridge** for static confirmation. Calibration uses a GB test truck of known weight, logged.

**Assumptions:** WIM at every entry and exit (one strip covers both directions on a shared gate);
higher cost than a simple axle counter.

**Decision: WIM stays the primary layer.** It's the realistic, industry-standard way to get a real
weight for every truck in real time. It is a device on the Vendor's site, but tampering means digging
up the exit road: that's visible to the pole camera and drone, and readings would drift from the
Vendor weighbridge and from the monthly volume check.

**Alternatives considered and rejected as the primary layer** (workarounds, not per-truck measurement):
random off-site weighing (sampled only), monthly volume (aggregate only), pole load-volume scanning
(density estimate, defeated by tarpaulins), GB-sealed reader on the Vendor weighbridge (still their
device). Certified off-site weighing stays only as **confirmation for flagged trucks**, and the volume
check stays as the **overall cross-check** (F cases).

**PoC:** 12 t empty → 32 t loaded → 20 t net; an overloaded truck flagged (38 t vs. 35 t legal); a
chipped weighbridge (theirs 18 t, ours 26 t) flagged; dashboard of trips and tonnes used.

---

## Solution 7: Over-extraction and mass balance ✅ agreed
**Covers:** F1 over-extraction (boundary, depth, volume) · F2 hidden stockpiles · F3 old-stock claims ·
final cross-check for B1 (side routes), D10 (outages) and S6 (weight sensor tampering)

**Idea:** every other solution watches trucks; this one measures **the ground**. A hole can't be un-dug.

| Step | What | Frequency |
|---|---|---|
| 1. Baseline survey | GB drone builds a 3D height map of the pit and **every stockpile on day one** (opening balance; settles F3) | Permit start |
| 2. Boundary check | Lease boundary on the map; **satellite** (free, Sentinel) + drone patrol flights flag digging outside it (plugs into / replicates India's Mining Surveillance System) | Weekly |
| 3. Depth check | Drone height map vs. approved mine-plan depth; below permitted level → alert | Monthly |
| 4. **Mass balance** | Drone-in-a-box (S4) flies the survey automatically | Monthly |
| 5. Satellite backup | Satellite stereo height map (metre-level) if the drone or dock is tampered with | As needed |

**Mass balance:**
```
Extracted   = pit volume removed (height map then vs. now) x density
Dispatched  = sum of net tonnes from weigh-in-motion (S6)
Stockpiled  = change in stockpile volume x density
Check:  Extracted ~= Dispatched + Stockpiled   (tolerance ~5-10%)
```
| Result | Meaning |
|---|---|
| Balanced | ✅ All extraction accounted for |
| Extracted > Dispatched + Stockpiled | ❌ Material left unseen (side route, outage, tampered sensor), so investigate |
| Extracted > permitted volume | ❌ Over-extraction, even if every truck was legal |
| New pile anywhere on site | ⚠️ Hidden stockpile (F2), tracked until dispatched through a pole |

**Tamper-proofing:**
- Drone with **RTK positioning**, so no ground markers the Vendor could move.
- **GB takes its own sealed material samples** for density; the Vendor's figure isn't trusted.
- Backfilling with waste also shows up as a height change.

**Accuracy:** drone surveys are a few cm, roughly ±1–3% on volume, plus density uncertainty. So the check
catches **systematic** leakage (hundreds of truckloads), not single trucks; per-truck detection is
the poles' job. This is the safety net.

**Out of scope:** F4 blending and C6 grade misdeclaration (a quality problem that needs material sampling).

**PoC:** simulated before/after height-map grids → volume removed → compared with weigh-in-motion
totals from the trip simulation → mass-balance gap flagged; map shows a boundary breach and a new
hidden stockpile.

---

## Solution 8: Tamper-proof records and reviewer accountability ✅ agreed
**Covers:** E2 log editing / deletion · E5 insider collusion (GB reviewers) · E6 evidence disputes ·
D5 replayed feeds · D6 fake devices · D7 firmware tampering · D9 clock manipulation

**Goal:** the evidence can't be quietly changed afterwards, by the Vendor **or** by the GB's own people.

### Part 1: Records nobody can secretly change (E2)
1. **Every device signs its data.** Poles, buried sensors and drones each have a crypto chip whose
   private key never leaves it. Every record is signed at the source, so edits on the device or in
   transit break the signature. **Consecutive sequence numbers** make deletions visible. Unknown or
   unsigned devices are rejected (D6).
2. **Append-only chained log.** Each entry includes a hash of the previous one; changing or deleting
   any record breaks every hash after it. Alert decisions go into the same chain.
3. **Daily fingerprint shared outside the GB.** One hash covering the day is published to a **public
   timestamp service** (e.g. OpenTimestamps) and **sent to the Vendor** and any auditor. Both sides hold
   the receipt: the GB can't rewrite history, and the Vendor can't claim fabrication (E6).

### Part 2: Reviewers can't quietly bury alerts (E5)
Workflow rules in the system (thresholds configurable by the GB):
| Rule | Stops |
|---|---|
| Fact-based alerts decide themselves (trip limit exceeded, no pass, mass-balance gap) | Human discretion to bribe |
| Alerts can't be deleted, only closed with a reason (in the chain) | Silent dismissal |
| High-severity dismissals need a second reviewer (maker–checker) | One bribed officer acting alone |
| Alerts assigned to reviewers at random | Vendor knowing whom to bribe |
| Unhandled alerts auto-escalate after a set time | Alerts ignored (the real-world failure of the national satellite system) |
| Dashboard of dismissal rates per reviewer | Outlier reviewers going unnoticed |
| Mass balance (S7) as an independent check | Dismissed real violations stay hidden |

### Also closes
| Case | How |
|---|---|
| D5 Replayed feeds | Sequence numbers and timestamps expose duplicated or old data |
| D7 Firmware tampering | Devices run only signed firmware (secure boot); a modified device stops signing correctly |
| D9 Clock manipulation | Device time from GPS, cross-checked against server receive time |

**Tech:** SHA-256 hash chain, Ed25519 device signatures, a public timestamping service. No blockchain
platform needed.

**PoC:** log viewer shows the chain; editing one record in the DB turns verification red at that
entry; dismissing a high-severity alert requires a second approver; an unhandled alert auto-escalates.
