# How the solution works, start to end

A plain walkthrough of the whole system: what is installed, what happens to a truck from registration to the
weekly check, what the GB sees, how we test it, and what is still a limit. Details of each rule are in
`rules_spec.md`; the cheats and how each is handled are in `threat_coverage.md`.

---

## 1. The problem in one paragraph

A Vendor digs and hauls material from a site under a contract (a permit) that limits trips, tonnes, vehicles, hours
and the period. Today the Vendor reports its own numbers. The Governing Body (GB) needs **its own count** of what
really leaves, that the Vendor can't influence, and needs to catch cheating: extra or fake trucks, cloned plates,
reused passes, overloading, trucks going round by side tracks, switching equipment off, editing records.

## 2. The idea in one sentence

**A GB-owned pole and barrier at every gate identifies each truck, weighs it, gives it a signed pass at entry and
only lets it out on that pass, so every trip is counted against the permit; a weekly GB survey of the ground catches
material that never went through a gate.**

## 3. What is installed, and who owns it

Everything below belongs to the GB and is run by the GB. Nothing depends on the Vendor's equipment, power, network or
records.

| Where | Equipment | What it does |
|---|---|---|
| Each gate (entry and exit) | **Pole** with a number-plate camera, a FASTag reader, a GB RFID sticker reader and a radar | Reads who the truck is and how long it is |
| Each gate | **Weigh pad** | Weighs the truck (empty at entry, loaded at exit); the official weight for tonnes |
| Each gate lane | **Weigh-in-Motion (WIM) strip** | Weighs each axle as the truck rolls over it: axle count, axle spacing and a second, independent weight |
| Each gate | **Two barriers** (entry, exit) | Open only when the GB server says so; an impact sensor records a forced crossing |
| On each registered truck | **GB RFID sticker** | A chip that answers a cryptographic challenge: it can't be copied |
| On site | **Edge computer** (primary + standby) | Keeps the gates working if the link to the GB server is down |
| GB office | **GB server + dashboard** | Decides every gate event, keeps the records, raises alerts |
| GB survey unit | **Drone** (weekly), LiDAR (monthly), satellite (quarterly) | Measures how much has been dug |

---

## 4. Before any truck works

**4.1 Registration (GB inspection).** A GB officer inspects each truck in person and records it in the GB registry:
plate, FASTag number, length, axle count and axle spacing, empty weight, rated capacity, documents (fitness,
insurance, permit), transporter. The
GB fits a **GB RFID sticker** tied to that one truck. The registry is the ground truth for identity; every change is
signed by an officer and kept in history.

**4.2 The contract (permit).** The GB enters the permit: how many trips and tonnes, how many different vehicles, the
working hours (with an exit grace period), the dates, how long a pass is valid (2 hours by default), and optionally
a number of trips per vehicle.

---

## 5. One truck's trip, step by step

### At the entry gate
1. **The truck arrives.** The pole reads the plate, the FASTag, the GB sticker and the length; the WIM strip reads
   its axles; the pad weighs it. The pole signs everything it sends (WIM included), so the server knows the reading
   came from a real GB pole.

   Two layers are checked. **Identity** (who claims to be here): GB sticker, plate, FASTag. **Body** (is it physically
   that truck): radar length, WIM axle count and spacing, empty weight from the pad and WIM. Length and axles belong
   to a truck *model*, not one truck, so they can't identify a truck on their own; they catch a body that doesn't
   match the identity it wears.
2. **Identify, part 1: identity. Which truck claims to be here, and is it genuine?**
   - Plate and FASTag must point to the same registered truck.
   - The GB sticker must answer the challenge (not cloned), be active (not revoked) and belong to that truck.
   - If the plate or the FASTag is missed once (mud, rain, a faulty tag), the sticker plus the other one is enough:
     the truck goes through with a flag. A plate that names **another** truck is treated as a clone.
3. **Identify, part 2: body. Is it physically that truck?**
   - **Length (radar)** within 0.5 m of the registered length.
   - **Axles (WIM):** the same axle count, and each axle gap within 0.15 m of the registered layout.
   - **Empty weight:** a bit heavier than registered (more than 0.4 t) means another body wearing this truck's
     identifiers. Pad, WIM and the registered weight are compared: if the pad is the odd one out, the body is judged
     by WIM instead and the pad is flagged.
   - Any mismatch: refused and held (BODY_MISMATCH; a length mismatch is raised as POSSIBLE_CLONE, since it is
     decided together with the plate and FASTag).
4. **Eligibility: may it work right now?** Not on hold, no open or unresolved trip, inside the permit period and
   hours, the permit's trips, tonnes and vehicles not used up.
5. **Measure.** The entry weight recorded on the pass, and whether the scale can be trusted: pad vs WIM (they must
   agree within max(1 t, 8%), else WIM_PAD_DISAGREE) and pad drift. Much heavier than registered: it arrived loaded.
6. **Pass.** The GB issues a **trip pass**: a signed QR code plus an 8-character SMS code, tied to this truck and its
   sticker, valid for 2 hours. One trip is reserved against the permit.
7. **Barrier.** It lifts only if a pass was issued.

### Inside the site
The truck loads. The GB sees nothing here; that is why the pass is needed at the exit.

### At the exit gate
8. **Identify again, from scratch** (identity and body), with the same sticker as at entry. A body that
   differs at exit is flagged (truck swapped inside?), not refused. The exit never trusts what the entry said.
9. **Pass check.** The driver shows the QR (or gives the SMS code). The pass must be genuine (signature), not used
   before, for this truck and sticker, and not expired. If the driver has no phone, the GB can match the truck's open
   pass by plate + FASTag + sticker, once a day and never while the truck is on hold.
10. **Measure.** Exit weight minus entry weight = **net tonnes** (from the pad). Overload, an empty exit or a skipped
   weigh pad are flagged. The WIM strip weighs the same truck: if pad and WIM disagree by more than max(1 t, 8%), the
   pad may be rigged to read low (WIM_PAD_DISAGREE, with WIM's estimate of the real load). It never stops the truck.
11. **Compare.** The trip is confirmed against the permit; tonnes added; warnings at 80%, 90%, 100%; a late exit
    after hours is flagged.
12. **Barrier.** It lifts only on a valid pass. A truck that breaks through is recorded as an **illegal trip** with a
    critical alert.

**Result:** every trip through a gate is counted, with its tonnes, against the permit, whatever the Vendor says.

Light vehicles under 6 m (site jeeps) are logged, not counted as trips, but weighed in and out: one leaving heavier
than it came is flagged.

---

## 6. When something is wrong

- **Refused at the barrier**: the barrier stays down. A refusal at entry happens while the truck is still empty, so
  nothing is at stake.
- **Alerts** with a severity (Info, Medium, High, Critical) for everything suspicious.
- **Holds**: a truck involved in a clone or pass misuse is frozen until an officer reviews it.
- **Officer actions**, each with a written reason, never deleted:
  - release a hold (the truck is then read again through every check; a release never opens the barrier);
  - late-close or cancel an unresolved trip. A late close says "the truck did leave by a gate, it just wasn't
    recorded", so the GB checks its own records: if no equipment fault (silent pole, delayed link, edge
    failure) was recorded while the trip was open, the claim isn't supported and a High LATE_CLOSE_UNSUPPORTED
    alert is raised. A late-closed trip that was never weighed out is charged at the truck's rated load, so its
    tonnes don't disappear;
  - let out a refused truck on its own pass (the trip still counts, flagged).
  - Three overrides by one officer in a day raise an alert (possible bribery).

---

## 7. Watching the GB's own equipment

Attacks on the equipment are cheaper than fooling it, so the GB watches its own devices.

| Check | How | Alert |
|---|---|---|
| Pole switched off or smashed | The pole sends "I'm alive" every few minutes; silence longer than 20 min | POLE_SILENT |
| Link to the pole cut | An event arriving well after the pole's latest signal | LATE_EVENT |
| Someone posting fake gate events | Events without a valid pole signature are refused | FAKE_GATE_EVENT |
| Weigh pad off on every reading | Empty trucks at entry no longer weigh their registered weights, all by about the same amount | WEIGH_DRIFT |
| Weigh pad chip that only reads loaded trucks light | The WIM strip disagrees on the first loaded truck; an unannounced test with a GB load of known weight; all trucks' loads suddenly lighter than earlier days | WIM_PAD_DISAGREE, WEIGH_DRIFT, LOAD_DROP |
| WIM strip down | No reading (offline or timed out): the body and weight are checked by radar and the pad only, as before. A poor reading (braking on the strip) is ignored | WIM_UNAVAILABLE |
| Edge computer fails or the WAN is down | Standby takes over; the site keeps working offline and syncs later; degraded states raise alerts | EDGE_* alerts |

---

## 8. Records that can't be quietly changed

- Every gate event, decision, alert and officer action is stored with a live log.
- Gate events are linked in a **hash chain**: each record carries a fingerprint of the one before. Editing or
  deleting a stored event breaks the chain, and the record check raises **RECORD_TAMPERED**.
- Nothing is deleted; corrections are new records with a reason.

---

## 9. Daily and weekly checks

**Daily, the Vendor's report.** The Vendor files its own daily trips and tonnes. The GB compares them with what its
gates recorded; declaring less raises **UNDER_REPORT**. The Vendor's numbers are never used as the source.

**Weekly, the volume survey (mass balance).** For material that never passes a gate (side tracks, extra trucks):
1. A GB drone flies the site on a random day each week and builds a 3D height map of the ground.
2. Comparing it with last week's map gives the volume dug (each grid cell: height before minus height after, times
   its area).
3. Volume × rock density = tonnes dug; minus ore still lying in stockpiles = tonnes that left the site.
4. Compared with the tonnes the GB gates weighed out that week:
   - more than 5% apart: **VOLUME_MISMATCH**;
   - more than 2% apart three weeks in a row: **VOLUME_TREND**;
   - since the first survey, more than 5% of an average week: **VOLUME_CUMULATIVE** (errors of the in-between maps
     cancel out, so steady leakage shows clearly over time);
   - digging outside the approved boundary or depth: **EXTRACTION_OUTSIDE_PLAN**.
5. Accuracy is kept honest with GB-owned fixed survey pillars; a flight with too much error (> 5 cm) is flown again.

---

## 10. What the GB sees (dashboard)

| Page | What it is for |
|---|---|
| Solution flow | The idea on one page |
| Truck registry, Transporters, RFID stickers | Who may work, and their GB stickers |
| Gate console | One truck at a time through the real GB software, with mocked sensors (the live demo) |
| Trip passes, Trip quotas | Every pass and per-vehicle allocation |
| Gate events, Alerts | Every decision and every alert |
| Edge & recovery | The on-site edge computers |
| Scenario runs | Cheats acted out one story at a time, scored |
| Site runs | Whole weeks / months of a site acted out, scored |

---

## 11. How we test it (the PoC)

The GB software is real; the physical world is simulated. A **simulator** plays the poles, trucks, drivers, the
Vendor, a bribed officer, an insider and the survey team, and keeps the **ground truth** (what really happened),
which the GB never sees.

| Test | What it does |
|---|---|
| **Gate console** | You set up one truck (genuine or tampered) and watch every check live |
| **Gate cheats** (34 stories) | Regression: every rule we built still works |
| **Threat coverage** (36 stories) | Every priority cheat from our threat list, judged against what the GB *should* do |
| **Edge resilience** (7 cases) | Failover, WAN loss, recovery |
| **Site runs** | A whole period: honest traffic with cheats, faults and surveys mixed in (clean week, the brief's case, mixed week, threat week, threat month) |

**The scorecard** (same on every run):
1. **Correct against ground truth**, as three tiles: overall (everything judged, together), cheats fully handled,
   and honest cases left alone. Each instance is judged once: one cheat attempt, one honest trip (entry + exit),
   or one story in the scenario suites. The overall tile leans towards the larger side, so read it with the other two.
2. **Cheats**: how many were caught (recall), whether its flags were real cheats (precision), F1.
3. **Honest**: whether honest trucks were left alone (recall), whether what it passed was really honest (precision), F1.
4. **What it cost**: trips and tonnes the GB missed, against what really moved.
5. **By threat area**: covered / partial / gap / silent gap (the GB doesn't know) / period-level (only the survey
   can see it).

**Headline results (2026-11-23):** threat coverage 15 → 32 of 36 covered (plus 3 period-level; the one left is the
same-model transplant, a known limit); threat week 0 false alarms, 41 of 42 cheats caught, the rigged weigh pad
flagged by WIM on the first loaded truck; the brief's case (permit 100, 206 really moved): the GB records 129 at its gates and
the weekly survey shows +57.5%.

## 12. What is real and what is simulated

| Real (built software) | Simulated (stands in for hardware or people) |
|---|---|
| Registry, permit, identify, passes, weights logic, barriers' decisions, alerts, holds, officer actions | Camera, FASTag reader, RFID reader, radar, weigh pad and WIM strip readings |
| Signatures (passes, poles), hash chain, heartbeat checks | Trucks, drivers, the Vendor, the bribed officer, the insider |
| Vendor report check, mass balance calculation | Drone survey results (from ground truth with a stated error) |
| Dashboard, live log | Edge hardware |

## 13. Known limits (say them before the judges do)

- **A transplant onto a truck of the same model** (same length, same axle layout, empty weight within the pad's noise)
  passes: no sensor can tell two trucks of one model apart. The defence is that the identifiers can't be moved (the
  GB sticker tears on removal). Shown honestly in the Gate console and the threat suite (story W2b).
- **WIM is a few percent accurate in motion**, so it catches a pad that is off by about 1 t or 8% and more; smaller
  offsets are left to the drift check and the reference weight test. Net tonnes always come from the pad.
- "Covered" means the GB responded as designed to the cheats we modelled; thresholds were tuned on those cases.
- Detected is not recovered: trips during a pole outage, tonnes taken off by a rigged pad, edited records are
  flagged but stay wrong until investigated.
- A few side-track trips a week (under about 2% of the volume) stay below what a survey can see.
- Not built yet: real-time watchdog on poles, pole keys in a secure element, sending the record chain off site,
  officer login, barrier that stays shut without power, incident escalation, manual review.

## 14. Alerts at a glance

| Alert | Meaning |
|---|---|
| UNREGISTERED_VEHICLE, UNIDENTIFIED_VEHICLE, POSSIBLE_CLONE | Not a registered truck / not identifiable / plate and FASTag disagree |
| RFID_CLONED, RFID_MISSING, RFID_REVOKED, RFID_MISMATCH | GB sticker copied / missing / revoked / of another truck |
| PLATE_UNREADABLE, FASTAG_UNREAD, PLATE_MISREAD | Genuine truck, one sensor missed (let through, flagged) |
| BODY_MISMATCH | The truck's identifiers are on a different body (weight or WIM axle layout) |
| NO_PASS, PASS_REUSE, PASS_MISMATCH, INVALID_PASS, PASS_EXPIRED_AT_EXIT | Pass missing / reused / another truck's / edited / expired |
| UNRESOLVED_TRIP | Its last trip was never closed (likely left by a side track) |
| TRIP_LIMIT, TONNE_LIMIT, VEHICLE_LIMIT, OUTSIDE_HOURS | Contract limits |
| OVERLOAD, ARRIVED_LOADED, EMPTY_EXIT, WEIGH_BYPASS | Weight problems |
| BARRIER_FORCED, ILLEGAL_TRIP | Broke through; the trip counts as illegal |
| OFFICER_EXIT, OFFICER_LATE_CLOSE, OFFICER_OVERRIDE_PATTERN | Officer overrides, and too many by one officer |
| LATE_CLOSE_UNSUPPORTED | An officer late-closed a trip with no equipment fault on record to explain it |
| POLE_SILENT, LATE_EVENT, FAKE_GATE_EVENT | Pole down / link cut / fake events |
| WEIGH_DRIFT, LOAD_DROP | Weigh pad wrong |
| WIM_PAD_DISAGREE | Weigh pad and the WIM strip disagree: pad rigged or WIM faulty |
| WIM_UNAVAILABLE | WIM strip gave no reading; body and weight checked by radar and the pad only |
| RECORD_TAMPERED | Stored records changed |
| UNDER_REPORT | The Vendor declared less than the gates recorded |
| VOLUME_MISMATCH, VOLUME_TREND, VOLUME_CUMULATIVE, EXTRACTION_OUTSIDE_PLAN | The ground says more left than the gates saw |
