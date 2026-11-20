# How the System Works: An End-to-End Walkthrough

The whole solution in plain terms, in the order things happen on a real site: setup, a normal
legal trip, each cheating attempt and how it's caught, what happens after an alert, and the
monthly check. Technical details are in `solutions.md` (S1–S8).

---

## 0. The setting

| Who | Role |
|---|---|
| **Governing Body (GB)** | Owns the site; sets the permit (e.g. **100 trips / 2,000 tonnes this month**). Our customer. |
| **Vendor** | Extracts material under contract. **Controls the site:** gates, power, network, staff, roads. |
| **Transport vendors** | Own the trucks that carry material out. Work with the Vendor. |

**The core problem:** everything the GB sees today (weighbridge slips, CCTV, passes, trip records)
comes from equipment or people the Vendor controls. So the GB sees **what the Vendor reports**, not
**what actually happened**.

**Our approach in one line:** the GB gets **its own eyes, its own scale, its own records and its own
view from the sky**, none of them depending on the Vendor. Every check is backed up by another,
independent one.

---

## 1. Setup (before the permit starts)

### 1.1 What the GB installs
| Equipment | Where | What it does | Why the Vendor can't simply turn it off |
|---|---|---|---|
| **Exit/entry pole** | Every gate (inside the Vendor's area) | Radar counts every vehicle; camera reads plates and the pass QR code; small computer sends data | **Own solar power, own 4G SIM, own storage.** Uses nothing of the Vendor's |
| **Buried road sensor (weigh-in-motion)** | Under the road at every gate | Weighs each truck, counts axles, keeps counting even if the pole is smashed | Hidden under the road; has its own battery and memory |
| **Drone in a dock** | On site | Random patrols, flies automatically to alerts, monthly 3D surveys | Flies on its own schedule; video evidence |
| **Hidden vibration sensors** | A few likely side tracks | Detect a heavy vehicle crossing; call the drone | Location secret; if dug up they go silent, which is an alert |
| **Trenches / earth banks** | Unused tracks out of the site | Physically block them | Filling them in needs machinery and is visible from the air |
| **GB server + app** | Off site (GB's office / cloud) | Registry, passes, matching, alerts, records | The Vendor has no access |

### 1.2 Enrolling trucks (the registry)
GB staff **physically inspect** each truck the Vendor wants to use and record:
- plate number and photos
- **length, axle count and axle spacing**
- **chassis number** (stamped into the frame)
- **empty weight** and **legal maximum loaded weight**
- the device that will run the GB app for that truck

Only enrolled trucks can ever get a pass. **The Vendor's own fleet list is never trusted.**

### 1.3 Baseline survey
The drone maps the whole site in 3D on day one: **pit shape and every existing stockpile**. This is
the **opening balance** for the monthly check.

### 1.4 Route survey
Satellite images plus a ground visit identify **every track a truck could use to leave**. Each one
gets a pole, a hidden sensor, or is blocked with a trench.

---

## 2. A normal, legal trip

```
ENTRY ──> PASS ISSUED ──> LOADING ──> EXIT ──> PASS CLOSED ──> COUNTED + RECORDED
```

1. **Truck arrives empty at the gate.** The pole's radar detects it, the camera reads plate
   `KA01AB1234`, and the buried sensor weighs it: **12 t** (empty).
2. **GB server checks automatically:**
   - Is the truck enrolled? ✅
   - Does its length and axle count match enrollment? ✅
   - Does it already have an open pass? ❌ (good)
   - Is permit quota left? ✅ (63 of 100 trips used)
   - Is the exit pole working? ✅
3. **A one-time QR pass** appears in the GB app on the truck's registered device. Valid for 3 hours,
   usable once, tied to this plate.
4. **Truck loads** inside the site.
5. **Truck drives out.** The radar counts it, the camera reads the plate **and scans the QR code**, and
   the buried sensor weighs it: **32 t**.
6. **Server matches:** QR valid ✅, plate matches ✅, physical match ✅, weight under legal maximum ✅.
   **Net load = 32 − 12 = 20 t.**
7. **Pass closed.** Permit now: **64 / 100 trips, 1,280 / 2,000 tonnes.**
8. **Every step is signed** by the device that recorded it and added to the **chained log**, which
   nobody can edit later.

**No Vendor staff, power, network or equipment was involved at any step.**

---

## 3. Cheating attempts and how each is caught

Format for each: **the trick → what happens → why it doesn't work → the backup check**.

### 3.1 Running extra, unregistered trucks (A1). The headline case
- **Trick:** the Vendor adds 100 extra trucks that aren't registered.
- **What happens:** the radar counts each one; the plate isn't in the registry → **"unregistered
  vehicle" alert** with photo. No pass can ever be issued for it.
- **Why it doesn't work:** counting is done by radar, not by the Vendor. The registry is the GB's.
- **Backup:** the monthly volume check shows more material gone than legal trips explain.

### 3.2 Hiding or removing the plate (A4)
- **Trick:** mud on the plate, a cover, or no plate.
- **What happens:** the radar still counts the vehicle; no plate is read → **"unidentified vehicle"
  alert**.
- **Why it doesn't work:** **default deny**. A vehicle is legal only if positively identified, so
  hiding the plate gets it flagged, not hidden.

### 3.3 Two trucks using the same registered plate (A2, cloning)
- **Trick:** an unregistered truck carries a copy of registered plate `KA01AB1234`.
- **What happens:**
  - If the real truck is inside with an open pass and the clone arrives → **"one open pass per
    plate" → clone alert**.
  - If the real truck is parked, the clone's **length or axle count doesn't match** enrollment →
    **mismatch alert**.
  - The clone driver doesn't have the registered device → **no QR code** at exit → **illegal trip**.
- **Backup:** too many trips per day for one plate → plausibility flag; surprise inspection checks
  the **chassis number**, which can't be cloned.

### 3.4 Moving a real plate to another truck (A3, swapping)
- **Trick:** plates moved between trucks.
- **What happens:** the buried sensor and radar measure **length and axles**; they don't match the
  enrolled truck for that plate → **mismatch alert**.
- **Why it doesn't work:** physical measurements come from GB sensors, not from the plate.

### 3.5 Fake passes, reused passes, under-reporting (E1, E3, E4)
- **Trick (common in India today):** the Vendor generates passes with no real trip (to make illegal
  material elsewhere look legal), reuses one pass for many trucks, or reports fewer trips.
- **What happens:** **the Vendor can't create passes at all.** A pass exists only when a GB pole sees
  a real enrolled truck enter. Each QR code works once. Trip counts and timestamps come from GB
  devices, not Vendor reports.
- **Why it doesn't work:** the paperwork is generated by the GB from what physically happened.

### 3.6 Driving through bumper to bumper (B2)
- **Trick:** two trucks close together, hoping to be counted as one.
- **What happens:** radar and axle sensor count two vehicles, but only one QR code is scanned →
  **illegal trip alert** for the second.

### 3.7 Working at night, in dust or rain (B3, D11)
- **What happens:** radar and the buried sensor don't need light. The camera has infrared lighting.
  **No passes are issued outside permitted hours**, so night trips are illegal by default.

### 3.8 Overloading or enlarging the truck body (C7, A8)
- **Trick:** carry 30 t on a truck allowed 20 t net, or raise the sides.
- **What happens:** the buried sensor weighs the truck at exit; over its legal maximum → **overload
  alert**. Net tonnes count against the permit, so overloading uses up the tonnage limit.
- **Why it doesn't work:** we don't need to spot the modification. **The extra weight shows up.**
- **Backup:** flagged trucks are sent to a **certified public weighbridge** for confirmation; monthly
  volume check.

### 3.9 Tampering with or bypassing the Vendor's weighbridge (C1, C3)
- **Trick:** a remote chip makes the Vendor's weighbridge read low (as in the 2026 Ahmedabad case), or
  trucks skip it.
- **What happens:** our buried sensor weighs every truck at the gate anyway. Compared with the
  Vendor's weighbridge: theirs says 18 t, ours says 26 t → **manipulation alert**. A truck with no
  weighbridge record but seen at our gate → **bypass alert**.
- **Why it doesn't work:** the Vendor's weighbridge becomes **something we check**, not something we
  rely on.

### 3.10 Using a side route (B1, B4)
- **Trick:** trucks leave through a fence gap or a new track with no pole.
- **What happens:**
  - A truck that **entered through a pole gate** but left elsewhere never closes its pass → **expired
    pass alert**.
  - A **hidden sensor** on the track detects a heavy vehicle → instant alert → **drone flies there and
    films it**.
  - Random drone patrols spot traffic on tracks.
  - **Weekly satellite images** reveal new tracks → blocked or given a movable pole.
- **Why it doesn't work:** no legal trip ever uses a side route, so **any** activity there is a
  violation.
- **Backup:** the monthly volume check shows material missing.

### 3.11 Smashing, covering or switching off the pole (D1, D2, D3, D10, G2)
- **Power cut:** doesn't apply (solar).
- **Network jammed or cut:** the pole keeps recording and uploads later; missing heartbeats raise
  an alert immediately.
- **Camera covered or turned:** the view change raises an alert; radar keeps counting.
- **Pole smashed:**
  1. Its tilt sensor sends a **last message with a photo**; or the server notices the silence within
     ~2 minutes.
  2. **Drone flies there automatically** and films.
  3. **The exit is closed:** no pass can be closed there, so any truck leaving is illegal.
  4. **Registered trucks** that slip out never close their pass, so they're flagged on expiry.
  5. **The buried sensor keeps counting** on its own battery → gives the real number of vehicles.
  6. A **movable pole** is towed in within hours.
- **Why it doesn't work:** breaking the pole doesn't open a free window. Legal dispatch through that
  exit stops, and vehicles are still counted.

### 3.12 Digging too much, too deep, or hiding stockpiles (F1, F2, F3)
- **Trick:** dig outside the boundary or below permitted depth; stockpile material out of sight;
  claim new material is "old stock".
- **What happens:**
  - **Weekly satellite + drone patrols** → digging outside the boundary is flagged.
  - **Monthly drone 3D survey** → pit floor below permitted depth is flagged; new piles are flagged.
  - Old-stock claims are checked against the **day-one baseline survey**.
- **Why it doesn't work:** a hole can't be un-dug. The ground is the one record the Vendor can't edit.

### 3.13 Editing records or bribing the reviewer (E2, E5, E6)
- **Trick:** delete or edit trip records; pay a GB officer to dismiss alerts.
- **What happens:**
  - Every record is **signed at the device** and **chained** to the previous one. Any edit breaks the
    chain at that exact entry.
  - The **daily fingerprint is sent to the Vendor and a public timestamp service**, so neither side
    can rewrite history.
  - Alerts **can't be deleted**, only closed with a reason. High-severity dismissals need **a second
    reviewer**. Alerts are **assigned at random**; ignored alerts **escalate automatically**.
- **Backup:** if real violations are dismissed, the **monthly volume check** still exposes the gap.

---

## 4. What happens after an alert

```
ALERT
  │
  ├─ Fact-based? (trip limit exceeded, no pass, closed exit) ──> VIOLATION recorded automatically
  │
  └─ Needs review?
        │
        ▼
   DESK REVIEW (randomly assigned officer)
   Evidence pack: photos (seen vs. enrolled), radar/axle/weight readings, time, pole, trip history.
   Cross-checks: other poles, national vehicle database (VAHAN), Vendor's weighbridge/CCTV (untrusted).
        │
        ├─ False alarm (e.g. plate misread) ──> close WITH a reason (logged, can't be deleted)
        ├─ Confirmed ──> notice to the Vendor with the evidence pack ──> recorded as a violation
        └─ Unclear ──> FIELD CHECK: surprise inspection, chassis number, certified weighbridge
```
- High-severity dismissals need a **second approver**.
- Unhandled alerts **escalate** after a set time.
- **What the GB does about a confirmed violation** (penalties, suspension) is **the GB's decision**.
  Our system supplies the evidence.

---

## 5. Month end: the mass balance

The drone flies its automatic 3D survey. The system compares:
```
Material dug out of the ground (pit volume change x density)
        vs.
Material that left through our gates (sum of net tonnes weighed)
        +
Change in stockpiles on site
```
| Result | Meaning |
|---|---|
| Matches (within ~5–10%) | ✅ Everything is accounted for |
| More dug out than left + stockpiled | ❌ Material escaped unseen: side route, outage, tampered sensor, so investigate |
| More dug out than the permit allows | ❌ Over-extraction |

This is the **final safety net**. Even if every other check were somehow beaten, **the missing
material still shows up here**.

---

## 6. Why it's independent of the Vendor

| Part | Depends on the Vendor for… | Answer |
|---|---|---|
| Pole | Power? Network? Servers? Staff? | **No.** Solar, own 4G SIM, own computer and storage, self-service QR scan |
| Pole | Physical access? | **Yes, unavoidable.** Hence tamper alerts, buried backup counter, drone, exit closure |
| Buried road sensor | Anything? | Hidden under the road, own battery; digging it up is visible |
| Drone | Anything? | Own dock and schedule; random patrols |
| Satellite | Anything? | **Nothing at all.** The Vendor can't touch it |
| Registry | Vendor's fleet list? | **No.** The GB inspects and enrolls each truck itself |
| Passes | Vendor's paperwork? | **No.** Created only when a GB pole sees a real truck enter |
| Weight | Vendor's weighbridge? | **No.** Our own sensor; theirs is only cross-checked |
| Records | Vendor's systems? | **No.** Signed at GB devices, chained on the GB server |
| Time | Vendor's network clock? | **No.** GPS time |

---

## 7. How the checks protect each other (no single point of failure)

| If the Vendor beats… | …this still catches it |
|---|---|
| The camera (mud, cover, dark) | Radar + buried sensor still count; default deny flags it |
| The plate (clone, swap) | Length/axle match, one-open-pass rule, missing QR code, chassis inspection |
| The pole (smashed) | Buried counter, pass expiry, drone, exit closure, movable pole |
| The gate entirely (side route) | Hidden sensors, drone patrols, pass expiry, weekly satellite |
| The weight sensor | Vendor weighbridge cross-check, certified weighbridge, monthly volume |
| The drone (grounded or watched) | Hidden sensors, satellite, monthly volume |
| The paperwork | It's generated by the GB from physical events |
| A GB officer (bribed) | Second approver, random assignment, escalation, monthly volume |
| **Everything above at once** | **Monthly mass balance: the hole in the ground** |

---

## 8. Honest limits

- **Physical access can't be removed.** The Vendor can damage on-site devices; we make it **loud,
  recorded and useless**, not impossible.
- **New side routes** can be used for a short time before a sensor, drone or the weekly satellite
  catches them.
- **Identical trucks** (same model and size) with cloned plates rely on the pass rules, plausibility
  and chassis inspections, not on measurements.
- **Mass balance** catches systematic leakage (hundreds of truckloads), not single trucks.
- **Trucks running with no pass at all** are detected, but **stopping them is enforcement**, which is
  the GB's job.
- **Material quality / grade fraud** is out of scope.
