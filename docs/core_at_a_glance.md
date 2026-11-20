# Core Solution: At a Glance

The decided core in one page. Details are in `core_solution.md`; extra defences against tampering are in `solutions.md`;
evidence from real cases is in `research_existing_systems.md` (§6–8).

---

## The idea in one line
**The GB gets its own eyes, scales and gate at every exit, issues every trip pass itself, and compares what physically
happened with what was permitted, using no power, network, staff or records from the Vendor.**

## The pipeline
```
 ┌─────────────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐   ┌─────────┐
 │ COUNT + MEASURE │──>│ IDENTIFY │──>│ COMPARE  │──>│   ACT   │──>│ RECORD  │
 └─────────────────┘   └──────────┘   └──────────┘   └─────────┘   └─────────┘
  radar + camera        plate +        trips, tonnes,  pass refused,  signed,
  + weigh pad at        FASTag +       vehicles, time  barrier down,  chained log
  every gate            length vs      + monthly       alert, flag,   (to finalise)
                        GB registry    mass balance    Vendor notice
        └──────────────────── TRIP PASS links them all ──────────────────┘
```

## What the GB installs
| Item | Where | Job |
|---|---|---|
| **Pole**: radar + plate camera + FASTag reader + small computer + 4G SIM + solar | Every gate (IN and OUT lanes) | Count and identify every vehicle; check passes |
| **Weigh pad** | Exit lane (and entry lane, recommended) | Measure what each truck carries |
| **Boom barrier** (GB-controlled, solar) | Every exit lane | Lifts only for a valid pass |
| **GB server** | Off site | Registry, passes, comparison, alerts, records |
| **GB app + SMS** | Transporter's and driver's phones | Receive the trip pass (QR or short code) |
| **Drone survey** (monthly) | The pit and stockpiles | Total extracted, for the mass balance |
| **Dashboard** | GB office | Live numbers, alerts, review, Vendor notices |

Hardware (India first): Vehant radar / ATCC · CP Plus or Matrix ANPR camera · Vahan Eye-type plate reading · standard
FASTag (UHF RFID) reader · certified weigh platform · heavy-duty DC boom barrier.

---

## One trip, start to finish
```
 TRUCK ARRIVES (empty)
        │
        ▼
 [1 COUNT + MEASURE]  Radar + camera see it cross the entry lines · entry pad weighs it empty
        │
        ▼
 [2 IDENTIFY]  Plate + FASTag → GB registry → same truck? radar length matches?
        │
        ├── ✗ unknown / unreadable / mismatch ──> NO PASS + alert   (default deny)
        ▼
 [3 COMPARE]   Open pass already?  Quota left?  Within hours?  Exit working?
        │
        ├── ✗ any fails ──> NO PASS + reason (clone alert / quota reached / ...)
        ▼
 [4 ACT]       PASS ISSUED → signed QR (app) + short code (SMS); 1 trip reserved
        │
        ▼
   Truck loads inside the site
        │
        ▼
 EXIT: stops on weigh pad at the barrier · radar counts · plate + FASTag read · QR / code checked · weighed
        │
        ├── all valid ──────────> BARRIER LIFTS → PASS CLOSED with NET TONNES ✅ (64/100 trips · 1,280/2,000 t)
        │                          (net > rated capacity → overload flag)
        ├── anything fails ─────> BARRIER STAYS DOWN + reason + alert
        ├── no QR / code ───────> closed by plate / tag + length, FLAGGED
        └── barrier forced / no pass ──> 🔴 ILLEGAL TRIP + photo / video evidence
        │
        ▼
 [5 RECORD]    every step signed and chained; can't be edited

 MONTHLY: drone survey → Extracted ≈ Dispatched (gate tonnes) + Stockpiled → gap = material that left unseen
```

---

## The five steps in short

### 1. COUNT + MEASURE: what really moves, and how much
- **Radar** (primary) + **camera** (secondary) on every gate pole; each checks the other.
- Counted only when a vehicle **crosses two lines in order**: no double counts from queues or reversing.
- **GB weigh pad** where the truck stops at the exit (entry pad for empty weight) → **net tonnes per trip**.
- Own solar, own 4G, stores data if offline, **heartbeat every minute**. Trucks only (for now).

### 2. IDENTIFY: which truck, whose, allowed?
- **GB registry** built by physically inspecting each truck (+ VAHAN check): plate, **FASTag IDs**, length, empty
  weight, owner. The Vendor's list is never trusted.
- **Three checks: plate + FASTag + length.** A muddy plate no longer blocks a real truck; a swapped tag or fake plate
  shows up as a mismatch.
- **Default deny:** not positively identified = not allowed. **No guessing** of unclear plates.

| Result | Outcome |
|---|---|
| Identified + authorised | Pass issued / closed |
| Not in registry / suspended | Flag: unregistered |
| Neither plate nor tag readable | Flag: unidentified |
| Plate / tag / length disagree | Flag: mismatch (possible clone) |
| Tag missing | Allowed, flagged |

### TRIP PASS: the link between steps
- Issued **only by the GB**, **only when a real enrolled truck is seen entering**.
- **Signed, single use, tied to plate + tag**, expires (e.g. 3 h). **One open pass per plate.**
- Delivered by **app (QR) and SMS (short code)**; the code can be checked by the pole even offline.
- Closed only at a GB pole, with **net tonnes**. **The Vendor can't create, reuse or cancel a pass.**
- Expired passes, empty exits, overloads and no-QR closes are **flagged**.

### 3. COMPARE: within limits right now?
- **Four limits:** trips · tonnes (**measured**) · vehicles · time window. Warnings at **80 / 90 / 100%**.
- **Four levels:** each movement (pass checks) · running totals · reality vs paperwork · **monthly mass balance**.
```
            Authorised   Legal (closed passes)   Actual                 Vendor reported
 Trips          100             100              200 (radar)                  95
 Tonnes       2,000           2,000            3,100 (mass balance)        1,900
                         GAP = 100 illegal trips · 1,100 t unaccounted · under-reported
```

### 4. ACT: prevent, alert, flag, notify
| Type | What |
|---|---|
| **Prevent** | No pass for unknown trucks, clones, after quota, outside hours; **truck on hold** after a clone / mismatch flag; **GB exit barrier lifts only for a valid pass** (forcing it = critical alert; GB-only override; never fails open silently) |
| **Alert** | 🔴 Critical / 🟠 High / 🟡 Medium / 🔵 Info → dashboard + SMS / app push; escalates if not acknowledged |
| **Flag** | Evidence pack; review: confirm or dismiss **with a reason**; never deleted; fact-based alerts auto-confirmed |
| **Notify** | Grouped into incidents; **Vendor notice** with evidence generated automatically |
- Penalties and contract action are **the GB's decision**.

### 5. RECORD: tamper-evident trail
*(to be finalised)*: every record signed at the device and chained on the server, so any edit shows.

---

## Why the Vendor can't simply switch it off
| Vendor controls… | Our answer |
|---|---|
| Power | Solar + battery (pole, barrier, weigh pad) |
| Network | Own 4G SIM; stores and uploads later; SMS code checkable offline |
| Staff / gate guards | Fully automatic; barrier opened only by the GB system |
| Their records / weighbridge / CCTV | Only compared against, never trusted |
| Truck list | GB enrolls trucks itself (plate, FASTag, length, weight) |
| Passes | Only the GB can issue and close them; no cancellation |
| Physical access to the pole | Cross-checks, tamper flags, heartbeat; barrier fails closed; monthly mass balance catches the gap (deeper: S5) |

## Why we believe it works (evidence)
- Every documented Indian pass fraud (UP: one pass, many trips · Haryana: pass cancelled after the check-post · pass
  created after being caught) happens because **the operator creates or cancels the pass**. Ours can't.
- The parts are **already used in India**: QR e-passes (UP), unmanned gates and RFID barriers (UP, Coal India),
  automated weighing (Coal India). We rearrange them to fix four repeated failures: operator-issued passes, checkpoints
  on public roads, operator power / staff, and detection without action.
- **Detection alone barely works** (Colombia: 7–11% reduction), so we **block automatically** at the barrier.

## What the core leaves to hardening (`solutions.md`)
Side routes (S4) · pole destroyed (S5) · multi-point / in-motion weighing (S6) · survey method (S7) · reviewer
controls and device signing (S8) · exact-truck checks (S3, optional).

---

## PoC at a glance
```
 Simulator (fake poles, FASTag, weights, barrier) ──> GB backend (registry · passes · compare · alerts · log)
                                                  ──> Dashboard + driver app / SMS mock
```
**Demo story** (each scene replays a real case): normal trip → clone refused → QR reuse rejected (UP) → pass can't be
cancelled after exit (Haryana) → overload 16 t on a 10 t truck → no-pass truck: barrier stays down; forced → critical
alert → limit reached at 100 → **Authorised 100 · Legal 100 · Actual 200** → monthly mass balance gap → incident +
Vendor notice.
