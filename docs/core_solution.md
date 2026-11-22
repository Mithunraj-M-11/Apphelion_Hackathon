# Core Solution: Count → Identify → Compare → Act → Record

The core pipeline, built around the brief's required steps (deck: Count, Identify, Compare, Act;
PDF adds Record). The trip pass is part of the core. Tampering-specific hardening layers are in
`solutions.md` (S1–S8). This file is filled in one step at a time as each is agreed.

```
COUNT + MEASURE ──> IDENTIFY ──────> COMPARE ─────────> ACT ──────────> RECORD
radar + camera      plate + FASTag   permit: trips,     prevent (pass,   signed,
+ weigh pad at      + length vs      tonnes, vehicles,  barrier) /       chained log
GB pole             GB registry      time + monthly     alert / flag /
                    (default deny)   mass balance       notice
```

---

## Step 1: COUNT + MEASURE ✅

**Question it answers:** how many vehicle movements actually happen at the site, and **how much does each truck
carry**? (The PDF calls this step "Measure"; quantity is part of the core, since royalty in India is per tonne.)
Measuring weight is in 1.10c.

### 1.1 What we count
- **Every vehicle movement through every gate, in both directions** (IN and OUT).
- A **trip** = one OUT movement of a material-carrying (heavy) vehicle. This is what the permit limits.
- IN is counted too: it starts the trip (pass issued at entry) and lets us pair IN with OUT.
- **Light vehicles** (cars, bikes, pickups) are counted and logged separately from heavy vehicles.

### 1.2 Where
- **Every gate** has a GB pole. Side routes are not part of the core (hardening layer S4).
- Design supports both **shared gates** (in and out through one gate) and **separate entry and exit gates**.

### 1.3 How: two independent counters on one pole
| Counter | How | Strength | Weakness |
|---|---|---|---|
| **Radar** (primary) | Traffic radar watches the lane: presence, direction, speed, **length** of each vehicle | Works in dust, rain, darkness; can't be blinded like a camera | Two vehicles extremely close together can occasionally merge |
| **Camera detection** (secondary) | The plate camera also detects "a vehicle crossed the line" | Photo of every movement; separates close vehicles well | Weaker in dust, glare, heavy rain |

**Cross-check:**
| Radar | Camera | Meaning |
|---|---|---|
| ✅ | ✅ | Confident count |
| ✅ | ❌ | Camera blinded or covered → **tamper alert**; the count still stands |
| ❌ | ✅ | Possible radar fault → **health alert** |

### 1.4 Deciding a movement (no false or double counts)
- **Two virtual lines** a few metres apart across the lane. Counted only when a vehicle **crosses both, in
  order**: A→B = OUT, B→A = IN.
- A truck that **stops, reverses or turns back** inside the gate isn't counted.
- People and animals are ignored by size and speed.
- **Class by length**: e.g. under 6 m = light, over 6 m = heavy (Indian ATCC classes: 2W, LMV, HMV, MAV).

### 1.5 Output: one record per movement
```
movement_id: G2-000481        gate: G2        direction: OUT
time: 2026-11-19 14:03:22 (GPS)
radar: length 9.8 m, speed 12 km/h, class HEAVY
camera: detected yes, photo attached
confidence: both counters agree
```
Each record is **numbered in sequence and signed** (Step 5). The pole sends a **heartbeat every minute**.

### 1.6 Wide gates and multiple lanes
- One radar per lane, or a multi-lane radar covering the full gate width.
- No vehicle may pass outside the radar's view; gates that are too wide are **narrowed by the GB**
  (barriers, kerbs, trench) at installation.

### 1.7 Power and network
- **Solar + battery**, 2–3 days without sun. Never uses the Vendor's power.
- **Own 4G SIM**, store and forward: if the link drops, counting continues and uploads later.
- **Heartbeat**: silence is noticed within minutes.

### 1.8 Proving accuracy
- **Calibration week at installation**: pole counts vs. manual review of video. The measured accuracy is recorded per pole.
- **Ongoing**: radar–camera agreement tracked; falling agreement triggers maintenance.

### 1.9 Independence from the Vendor
| Needs from the Vendor? | Answer |
|---|---|
| Power | No: solar |
| Network | No: GB's own 4G SIM |
| Staff | No: fully automatic |
| Their CCTV or records | No: own sensors |
| Physical access | Unavoidable → radar–camera cross-check, tamper alerts, heartbeat (deeper: S5) |

### 1.10 Not covered by Count (later steps / hardening)
- *Who* the vehicle is → Identify. *Was it allowed* → Compare.
- Trucks avoiding gates → S4. Pole destroyed → S5.

### 1.10a Gate behaviour: queues, stops and two-way traffic
- **Trucks stop at the gate by design:** at **entry** to receive the pass, at **exit** for the QR scan
  (Steps 2–4). Stop-and-go and queues are normal, not exceptions.
- The "cross both virtual lines in order" rule handles stopping and creeping: only a completed crossing counts.
- **Requirement for the radar:** must **track stopped and slow vehicles** (smartmicro claims this; Indian
  vendors to confirm). Added to the vendor trial checklist.
- **Shared gates:** marked or divided into an **IN lane and an OUT lane** at installation, with one radar
  zone per direction (or a multi-lane radar), so simultaneous in and out traffic is kept separate.
- **Scope for now: trucks only.** Tractor-trolleys and other material carriers are left out to keep it simple.

### 1.10b Heartbeat contents (every minute)
| Field | Why |
|---|---|
| Pole ID, GPS time | Which pole, trusted time |
| Battery level, solar output | Power health; panel covered or battery tampered |
| Last movement sequence number | Detect missing or deleted records |
| Radar status, camera status | Device health |
| Radar–camera agreement rate | Camera blinded or radar fault |
| Box-opened flag, tilt flag | Physical tampering |

The server uses heartbeats to detect outages (silence) and tampering (flags, drops in agreement).

### 1.10c MEASURE: GB weigh pad at the gate (core)
**Why in core:** with rated capacity only, **overloading is invisible**, and it's the most common real fraud
(Australian prosecutions, UP adding weigh-in-motion, Atami 1.5× declared; see research §6–8).

**What:** a **GB-owned weighing platform** in each **exit lane, under the barrier**, where the truck already stops.
Static weighing is far more accurate than weighing on the move.

**Empty weight:**
| Option | How | Note |
|---|---|---|
| **Entry pad (recommended)** | Truck weighed empty on arrival; weight stored on the pass | Also catches trucks **arriving already loaded** |
| Enrolled empty weight (budget fallback) | Empty weight recorded at the GB's physical inspection | Cheaper; slightly less accurate (fuel, crew, modifications) |

**Net load = exit weight − empty weight** → recorded on the pass when it closes.

**Flags:**
| Condition | Flag |
|---|---|
| Net load > rated capacity / legal maximum | ⚠️ **Overload** (quota still counts the real tonnes) |
| Truck counted by radar but no weight reading | ⚠️ Weigh pad bypassed / faulty |
| Entry (empty) weight far above enrolled empty weight | ⚠️ Arrived loaded / different truck |
| Exit weight ≈ empty weight | ⚠️ Empty exit (now **measured**, not declared) |
| GB weight vs Vendor's weighbridge differ beyond tolerance | ⚠️ Weighbridge discrepancy |

**Tamper protection** (cf. weighbridge remote-control chips): electronics in the GB's sealed box, readings **signed
at the device**, load-cell health in the heartbeat, cross-check with the Vendor's weighbridge, monthly mass balance
(Compare level 4) as catch-all.

**Practical:** needs civil work (concrete base) and Legal Metrology certification; the costliest core item after
the pole. Full WIM / multi-gate detail stays in hardening S6.

**PoC:** the simulator emits empty and loaded weights; demo scene: *legal trip, but 16 t on a 10 t truck → overload
flagged, quota counts 16 t.*

### 1.11 In one line
Every gate has a GB pole where radar and camera independently count every vehicle crossing in or
out and a GB weigh pad measures what each truck carries, all checking each other and sending numbered,
signed records to the GB, using no power, network or staff from the Vendor.

---

### 1.12 Hardware: real products in use today

> Specs are **manufacturer / reseller claims** unless noted. **To confirm with vendors or a site
> trial:** behaviour with **slow, stop-start trucks at a gate** (most of these are built for road
> traffic) and **solar power draw**.

#### ⭐ Recommended combinations
| Setting | Counter (radar) | Camera | Plate-reading software |
|---|---|---|---|
| **India (primary)** | **Vehant 4D imaging radar / Vehant ATCC.** Indian, "Make in India", radar accuracy ARAI-certified (vendor); same design as Vehant's free-flow tolling (radar tracks, camera identifies) | **CP Plus ANPR camera.** Made in India (Kadapa, AP), IR, also offers radar-based ANPR; STQC-oriented. Alternative: **Matrix Comsec** (on GeM) | **Vahan Eye (IIIT Hyderabad)** for hand-painted truck plates; alternatives **Videonetics** or **Vehant VehiScan** |
| **International (US / Europe)** | **Wavetronix SmartSensor HD** (USA). Independently evaluated by Minnesota DOT; direction from two beams; per-vehicle length. Low-power alternative: **Houston Radar SpeedLane Pro** (USA), ~1 W, solar-ready | **Axis Q1800-LE** (Sweden). Licence-plate camera with IR; successor to the Q1700-LE | Vendor ANPR, but **Indian hand-painted plates still need a Vahan Eye-type model** |

**Why India first:**
- **STQC certification** (MeitY Essential Requirements) is required for internet-connected CCTV;
  reports say **Hikvision and Dahua** are not being certified, and government purchases need
  STQC-certified products. Chinese options are therefore excluded.
- India already standardises this unit: NHAI's highway spec includes an **ATCC (Automatic Traffic
  Counter-cum-Classifier)**. Pitch line: *"our gate counter is an NHAI-spec ATCC."*
- Government buyers procure through **GeM**.

#### All options considered
**Radars / counters, India**
| Product | Notes |
|---|---|
| Vehant ATCC | AI-based lane-wise counting and classification (2W, LMV, HMV, MAV) |
| Vehant 4D imaging radar (TrafficMon Radar, MLFF) | Radar tracks each vehicle, cameras classify and read plates; ARAI-certified accuracy (vendor) |
| Pixuate ATCC | AI ATCC with built-in ANPR |
| AJS Phoenix II | ATCC using loops / piezo / tube sensors, 20+ classes, 98% (vendor) |
| Steradian Semiconductors | Gantry-mounted radar counting; partnership with Astra Microwave |
| Metro Infrasys, Tollman | ITS integrators (ATCC, CCTV, VMS) |
| Bitsensing (Korea) via Ikio (India) | Traffic radar through an Indian partner |

**Radars / counters, international**
| Product | Notes |
|---|---|
| Wavetronix SmartSensor HD (USA) | Count, speed, length, lane, direction; 6–250 ft; Minnesota DOT evaluation |
| Houston Radar SpeedLane Pro (USA) | ~1 W, 30 W solar panel + optional 96 Wh battery (vendor); length classes; 1M records |
| smartmicro UMRR (Germany) | Tracks up to 256 **stopped and moving** vehicles, 8 lanes; class, length, direction |

**Cameras / ANPR, India**
| Product | Notes |
|---|---|
| CP Plus | Made in India ANPR, IR, radar-based ANPR |
| Matrix Comsec | Made in India network cameras; on GeM since 2017 |
| Videonetics | ANPR + analytics; Andhra Pradesh statewide system, 680+ junctions |
| Vehant VehiScan | ANPR for check posts, toll gates, entry/exit |
| Vahan Eye (IIIT Hyderabad) | ANPR for hand-painted truck plates; on sand trucks in Telangana |

**Cameras / ANPR, international**
| Product | Notes |
|---|---|
| Axis Q1800-LE (Sweden) | Licence-plate camera, IR; Q1700-LE predecessor: night capture 20–50 m, 0 lux with IR |
| ~~Hikvision iDS-TCV500/900-HI, iDS-TCM403-GIR (China)~~ | Excluded for India (STQC) |

#### Sources
- **India rules:** [ElectronicsForU](https://www.electronicsforu.com/market-verticals/indias-security-first-rules-reset-surveillance-systems-risk) · [The News Minute](https://www.thenewsminute.com/news/explained-why-india-is-restricting-chinese-cctv-cameras-from-april-1) · [Business Today](https://www.businesstoday.in/industry/story/china-part-of-concern-indias-cctv-crackdown-over-spying-fears-hits-global-giants-like-hikvision-xiaomi-478143-2025-05-28) · [CMAI policy page](https://sites.google.com/view/cmaivideocameras/govt-policies-for-cctv)
- **NHAI ATCC:** [NHAI ATMS spec](https://nhai.gov.in/nhai/sites/default/files/2020/Annexure-A%20ATMS%20%28%20Part%20of%20Schedule%20D%29%20.pdf) · [IHMCL RFP](https://ihmcl.co.in/wp-content/uploads/2020/05/FinalRFPTS.pdf)
- **Indian counters:** [Vehant ATCC](https://www.vehant.com/products/atcc/) · [Vehant MLFF](https://www.vehant.com/mlff-solution/) · [Vehant TrafficMon Radar](https://www.vehant.com/products/trafficmon-radar-svd/) · [Traffic Infratech (Pixuate, AJS)](https://trafficinfratech.com/?p=23766) · [Watsoo (integrators)](https://watsoo.com/blog/?p=1681) · [Microwave Journal (Steradian)](https://microwavejournal.com/articles/37778-steradian-semiconductors-joins-hands-with-astra-microwave-for-traffic-monitoring-4d-imaging-radar) · [IoT M2M Council (Bitsensing–Ikio)](https://iotm2mcouncil.org/iot-library/news/connected-transportation-news/mou-advances-ai-traffic-monitoring-in-india/)
- **International counters:** [Wavetronix datasheet (ATS)](https://www.atstraffic.ca/wp-content/uploads/2024/03/Wavetronix-SmartSensor-HD.pdf) · [MnDOT evaluation](https://www.lrl.mn.gov/docs/2012/other/C120008.pdf) · [Houston Radar (ITS International)](https://itsinternational.com/products/houston-simplifies-radar-installation-speedlane) · [SpeedLane Pro (Intertraffic)](https://www.intertraffic.com/products-and-services/houston-radar-llc/products/speedlane-r-pro-traffic-data-collector) · [smartmicro (Infrastructure Magazine)](https://infrastructuremagazine.com.au/smartmicro-takes-next-generation-vehicle-detection-technology-to-a-new-level/)
- **Indian cameras:** [CP Plus (Electronics Era)](https://electronicsera.in/?p=31879) · [Matrix Comsec](https://www.matrixcomsec.com/about-us/make-in-india/) · [Videonetics AP (SecurityInformed)](https://www.securityinformed.com/news/videonetics-success-story-asia-biggest-statewide-co-4065-ga-co-4403-ga.1639484206.html) · [Vehant VehiScan](https://www.vehant.com/vehiscan/) · [Vahan Eye (IIIT)](https://blogs.iiit.ac.in/vahan-eye/)
- **International cameras:** [Axis Q1700-LE datasheet](https://www.axis.com/dam/public/ff/ca/6d/datasheet-axis-q1700-le-license-plate-camera-en-US-378441.pdf) · [Hikvision TCV500 datasheet (excluded)](https://assets.hikvision.com/prd/normal/all/doc/m000066251/iDS-TCV500-HI_Datasheet_20250708.pdf)

---

## Step 2: IDENTIFY

**Question it answers:** which vehicle is this, who does it belong to, and is it authorised?
The PDF asks to identify **vehicles, parties and loads**. In the core: vehicle (main job), party (via the
registry), load (**measured weight from the gate weigh pad**, 1.10c).

### 2.1 The registry (built by the GB from physical inspection; the Vendor's fleet list is never trusted)
| Field | Why |
|---|---|
| Plate number (normalised: uppercase, no spaces) | Main identifier |
| **FASTag IDs** (tag number + factory chip ID), read by the GB at inspection | Second identifier that doesn't need a clean plate |
| **Empty weight** (weighed at enrollment) | Budget fallback for net load; sanity check for entry weight |
| Transport vendor / owner | **Party**: every trip traceable to a company |
| Photos (front, side, rear) | Evidence, visual comparison |
| Length (measured at enrollment) | Physical check against the radar |
| Rated capacity / legal maximum weight | Basic load figure in the core |
| Chassis number | Field proof (hardening) |
| Registered numbers: transporter + **driver of the day** (set by the transporter) | Receive the pass by app (QR) and SMS (code), see 2.3 |
| Status: active / suspended, valid from–to | Authorisation can be withdrawn |
| VAHAN check at enrollment | Confirms plate, make and model with the national registration database |

### 2.2 At the gate
1. Camera reads the plate → text + confidence.
2. **Clean-up:** normalise and check against **Indian plate formats** (e.g. `KA 01 AB 1234`, BH series).
   Impossible readings are treated as unreadable, not guessed.
3. **FASTag reader** on the pole reads the windscreen tag (tag number + factory chip ID).
4. Registry lookup by plate **and** by tag; both must point to the **same truck**.
5. **Physical check:** radar length vs. enrolled length (± ~0.5 m). Free, since the radar already measures length.
6. Result attached to the movement record.

**Plate + FASTag + length: three independent checks**
| Situation | Plate | FASTag | Length | Result |
|---|---|---|---|---|
| Normal | ✓ | ✓ | ✓ | Identified |
| Muddy / hand-painted plate | ✗ unreadable | ✓ | ✓ | **Identified by tag** + "plate unreadable" note (no longer stuck under default deny) |
| Tag removed / foil-blocked | ✓ | ✗ missing | ✓ | Identified by plate + ⚠️ **"tag missing"** flag |
| Tag swapped from another truck | ✓ | points to another truck | ? | ❌ **Mismatch** (possible clone / swap) |
| Fake plate of a registered truck | ✓ (fake) | ✗ / other truck | ? | ❌ Mismatch |
| Neither plate nor tag | ✗ | ✗ | – | ❌ Unidentified (default deny) |

Independence: the GB reads and records each tag **itself at the physical inspection**, so it needs no access to the
national toll database and doesn't trust the Vendor. The factory chip ID can't be rewritten, so the tag is harder to
clone than a plate. (FASTag: mandatory on Indian vehicles; "one vehicle, one FASTag".)

**No fuzzy guessing:** if the reader is unsure (e.g. 8 vs. B), we don't pick the nearest registered plate (that's
how a clone would slip through). Unsure = unidentified; alert review sorts it out.

### 2.3 Role of the app and SMS (decided)
- **Entry:** identification = **plate / FASTag + length** (pole only). Only after it succeeds is a pass issued,
  sent to the truck's **registered numbers** (transporter + driver of the day) by **app (QR) and SMS (short code)**.
- **Exit:** identification = **plate / FASTag + (QR or SMS code) + length + weight**. The QR / code proves the trip was
  authorised; the plate and tag checks stop it being used on another truck.
- **SMS** works on a basic phone with weak signal, so drivers who rotate trucks or lack a smartphone aren't stuck.
- **No QR / code at exit:** the pole identifies by plate / FASTag + length, matches the open pass and **closes it,
  flagged "closed without QR"** for review. Legitimate trucks aren't stranded.

### 2.4 Results
| Result | Condition | What happens |
|---|---|---|
| ✅ Identified + authorised | Plate and / or FASTag point to the same registered, active truck; length matches | Goes on to pass issue / close |
| ❌ Identified, not authorised | Not in registry, or suspended | Flagged: unregistered vehicle |
| ❌ Unidentified | Neither plate nor tag readable | Flagged under **default deny** |
| ⚠️ Mismatch | Plate and tag point to different trucks, or length doesn't match | Flagged: possible clone / swap |
| ⚠️ Tag missing | Plate identified, no tag read | Allowed, flagged; repeated → registry review |

### 2.5 Entry and exit must agree
Each trip is identified twice. Plate at exit ≠ plate at entry (same pass) → mismatch flag.

### 2.6 Output added to the movement record
```
movement_id: G1-000517    direction: IN
plate_read: KA01AB1234 (confidence 0.96)   format_valid: yes
fastag: tag 34161FA8... chip E280... -> same truck
registry: found, vendor "XYZ Transport", status ACTIVE
length: radar 9.7 m vs enrolled 9.5 m -> match
weight: 9.1 t (empty, entry pad)
RESULT: IDENTIFIED + AUTHORISED
```

### 2.7 Clones: the pass does most of the work
For a clone of the **same size and model** (length check can't tell them apart):
| Scenario | Caught? |
|---|---|
| Real truck inside with an open pass; clone arrives at entry | ✅ Second pass refused → clone alert |
| Clone leaves without a pass | ✅ Illegal trip |
| Clone uses a screenshot of the real truck's QR | ✅ Second scan rejected (single use) |
| Taking turns: real truck parked, clone does all trips legally | ❌ Not caught, but **every trip still uses a pass and counts against the quota**, so the limit holds |

→ The pass catches **every clone that produces extra trips**. Axle and chassis checks (S3) become **nice-to-have**
(confirming it's the exact physical truck), not required for limit enforcement.

**GB RFID sticker (added 2026-11-22, built):** every truck also carries a GB-issued RFID sticker that answers a
**challenge-response** with a secret key. A copied plate and a cloned FASTag can't answer it, so the "taking turns"
row above is closed too: a perfect clone is refused at the entry barrier even while the real truck is away. The
sticker must belong to the truck identified by plate + FASTag + length, be active (the GB can revoke it), and be the
same sticker at exit as at entry. A missing or damaged sticker is refused for now (relaxations later).

### 2.8 Independence
Registry: GB-built + VAHAN check · Camera, radar: GB pole · Reading and matching: GB server.

### 2.9 Not covered in the core
Exact-truck verification (axles, chassis) → S3 (optional). Multi-point / in-motion weighing detail → S6.

### 2.x Plate-reading software: production vs. PoC

**Production:** a model built for **hand-painted Indian truck plates**, such as **Vahan Eye (IIIT Hyderabad)**,
deployed on sand trucks in Telangana (checks against a whitelist of about 40,000 vehicles).
**Not open source:** no public code, model or dataset found. Access would mean contacting IIIT-H / iHub-Data.

**PoC:** use **ready-to-use (already trained) open-source models**; no fine-tuning by us.

| Option | What you get | India-specific? | Effort |
|---|---|---|---|
| **fast-alpr** (`pip install fast-alpr`) | Full pipeline, already trained: detector (open-image-models) + reader (fast-plate-ocr "global" model) | ⚠️ Global model; India coverage not confirmed | Easiest |
| **Awiros ANPR-OCR** (HF: `surendran0m07/anpr-ocr`) | 37M-parameter reader trained for Indian plates (Awiros: Indian video-analytics company) | ✅ | Needs a separate detector |
| **YOLOv8 + CRNN Indian plate demo** (HF Space: `zenitsu09`) | Detector + reader trained on Indian plates | ✅ | Demo app; check code and licence |
| **Roboflow Universe Indian plate detectors** (`indian_licence_plate`, `Bike&CarNumberPlate`, etc.) | Trained plate detectors; hosted API (free key) or local | ✅ (detection only) | Needs a reader; some datasets CC BY 4.0 |

**Plan:**
1. **Try fast-alpr first** (minutes to set up).
2. If its accuracy on Indian plates is poor, use **Option A**: Roboflow Indian detector (or fast-alpr's detector)
   + **Awiros ANPR-OCR** reader.
3. Test on a handful of **real Indian truck photos**, including hand-painted plates, and record the measured accuracy for the deck.

**Notes:**
- No published accuracy for any of these on Indian truck plates; measure ourselves.
- Hand-painted plates will be hard. In the demo, low-confidence reads go to **"unidentified" → flagged by
  default deny**, which shows the system stays safe when plate reading fails.
- Check each model card's licence (fine for a hackathon demo).
- Pitch line: *"The PoC uses an open-source reader; in production, hand-painted truck plates are handled by a
  model like IIIT Hyderabad's Vahan Eye, already deployed on sand trucks in Telangana."*

**Also considered (would need training / unclear):** Indian Licence Plate Dataset "in the wild" (16,192 images,
arXiv 2111.06054); PlateRecognizePy (YOLOv8 + EasyOCR, licence "other"); IEEE DataPort Indian plate dataset;
Indian commercial truck plate dataset (arXiv 2211.13194, release unconfirmed).

**Sources:** [Vahan Eye (IIIT blog)](https://blogs.iiit.ac.in/vahan-eye/) · [Deccan Chronicle](https://www.deccanchronicle.com/southern-states/telangana/iiit-hs-vahan-eye-targets-truck-plates-1938044) ·
[fast-alpr (PyPI)](https://pypi.org/project/fast-alpr/) · [fast-alpr docs](https://ankandrew.github.io/fast-alpr/latest) · [fast-plate-ocr](https://github.com/ankandrew/fast-plate-ocr) ·
[Awiros ANPR-OCR](https://huggingface.co/surendran0m07/anpr-ocr) · [YOLOv8 + CRNN Space](https://zenitsu09-yolo-crnn-plate-recognition.hf.space/) ·
[Roboflow indian_licence_plate](https://universe.roboflow.com/licenceplatedetection-i880o/indian_licence_plate) · [Roboflow Bike&CarNumberPlate](https://universe.roboflow.com/indiannumberplatesdetection/bike-carnumberplate/model/6) ·
[Indian LPR dataset (arXiv)](https://arxiv.org/abs/2111.06054) · [Truck plate dataset (arXiv)](https://arxiv.org/pdf/2211.13194v2.pdf) · [PlateRecognizePy](https://pypi.org/project/PlateRecognizePy/0.2.2) ·
[IEEE DataPort](https://ieee-dataport.org/documents/indian-license-plate-recognition-dataset-yolo-ocr)

## The Trip Pass (core; links Identify → Compare → Act)

### Life cycle
```
          entry, all checks pass                 exit QR scan, plate matches
REQUEST ───────────────────────────> ISSUED ─────────────────────────────> CLOSED (= 1 trip)
   │                                    │
   │ any check fails                    ├── not scanned before expiry ──> EXPIRED (flagged)
   v                                    │
 REFUSED (reason logged)                └── same plate seen at entry again ──> clone alert
```

### A. Issue (at entry)
Truck stops at the entry stop line; the pole counts it and reads the plate. Checks in order:
| Check | If it fails |
|---|---|
| Plate / FASTag read, same registered truck, active | Refused: unregistered / unidentified |
| Length matches enrollment; plate and tag agree | Refused: mismatch |
| Empty weight plausible (entry pad) | Issued but flagged: arrived loaded / different truck |
| No open pass for this plate | Refused: **clone alert** |
| Quota left | Refused: **quota reached** |
| Within permitted hours | Refused: outside permit window |
| At least one exit pole working | Refused: no working exit |

All pass → pass **issued**, **one trip reserved** from the quota, empty weight stored, and the pass sent to the
truck's registered numbers: **QR in the GB app + short code by SMS**. (A display board on the pole is optional.)

**QR content:** `pass_id, plate, FASTag ID, issued time + gate, empty weight, expiry (e.g. 3 h), GB signature`.
Signed (can't be forged), **single use**, **tied to the plate and tag**.

**SMS code:** a short one-time code (e.g. 8 characters) computed from the pass, plate and expiry with a key only GB
systems hold, so **a pole can check it even offline**. Copied to another truck, it fails (tied to plate + tag).

### B. Close (at exit)
Truck stops on the exit weigh pad at the barrier; the pole counts it, reads plate and FASTag, **scans the QR or takes
the SMS code** on a keypad, and weighs it. Checks: valid signature / code · not used · not expired · plate and tag =
pass. All good → **barrier lifts**, pass **CLOSED** with **net tonnes**, trip confirmed.
**Any working exit** can close a pass.

### Outcomes
| Situation | Result |
|---|---|
| Entry → pass → exit scan, all match | ✅ Legal trip |
| Truck leaves with no pass (radar counted it) | ❌ Illegal trip |
| Second entry with same plate while its pass is open | ❌ Clone alert, pass refused |
| Same QR scanned twice | ❌ Reuse alert |
| Plate in QR ≠ plate seen at exit | ❌ Mismatch |
| **Pass expires without an exit scan** | ⚠️ **Flagged** for review (truck may have left another way). The reserved trip stays counted until resolved. |
| **Truck exits empty** | ⚠️ **Flagged** for review (**measured** by the weigh pad) |
| Net load > rated capacity | ⚠️ **Overload** flagged; quota counts the real tonnes |
| Quota reached: entry refused, truck enters anyway and leaves | ❌ Illegal trip |

### Closing without a QR, and why it doesn't open a door for clones
- No QR at exit → close by **plate + length match to the open pass**, flagged "closed without QR".
- **Core invariant:** *every radar-counted OUT must match exactly one pass closure.* One pass closes once.
  If a clone closes the real truck's pass this way, the real truck's later exit has **no open pass** (or its QR
  is already used) → **flagged as an illegal trip / reuse**. The **count stays correct**; only the question of
  which physical truck did which trip needs review.
- **Guardrails:** limit no-QR closes (e.g. max 1 per truck per day); track the rate per truck and per transport
  vendor; repeated use → registry review (possible suspension).

### Offline mode
If the pole loses its server link, it issues and checks passes itself from a small **pre-allocated quota**
(e.g. 5 passes) and syncs later, so it can't over-issue.

**Built (2026-11-22):** a primary and a standby edge computer at the site with failover, local operation when the
uplink is down (events queued in a sync outbox), signed recovery snapshots, officer-authorised emergency movements
when both are down, and reconciliation afterwards. Every one of these raises an alert (silence is suspicious), and
emergency movements stay provisional in the ledger until reconciled. Passes are Ed25519-signed, so a pole can check
them offline with only the public key.

### PoC
- **Backend pass service** with the rules above; QR codes **really generated and signed** (Python `qrcode` + Ed25519).
- **Driver app mock:** phone-sized web page per truck showing its current pass as a real QR, plus a simulated SMS
  panel showing the short code.
- **Simulated poles:** the simulator "scans" the QR at exit by decoding it (**simulated, no webcam** for now).
- **Dashboard:** passes by state (issued / closed / expired / refused) and the quota counter.

**Demo script (~3 min):**
1. Normal trip: enter → QR appears → exit scan → closed → quota 1/100.
2. Clone: same plate arrives while the first is inside → pass refused, clone alert.
3. Screenshot reuse: same QR scanned twice → second rejected.
4. No pass: unregistered truck leaves → illegal trip.
5. Fast-forward to the limit: 100 used → next entry refused "quota reached"; trucks leave anyway → all flagged →
   **permitted 100, actual 200, 100 illegal, each with evidence**.
6. Expired pass: truck enters, never exits through a pole → expired flag → hints at a side route.

---

## Step 3: COMPARE ✅

**Question it answers:** is the activity within the contract's limits, right now?
Count says what happened, Identify says who; Compare holds both against **the permit** in near real time.

### 3.1 The permit (entered once by the GB): all four limits in the core
| Limit | Example |
|---|---|
| **Trips** | Max 100 trips this period |
| **Quantity** | Max 2,000 tonnes (core: **measured net tonnes** from the gate weigh pad) |
| **Vehicles** | Only enrolled trucks; e.g. max 20 distinct trucks |
| **Time period** | Valid 1–30 Nov; trips only 06:00–20:00 |

### 3.2 Four levels of comparison

**Level 1: each movement, at the gate (real time, preventive)**
Done inside the **pass checks** (registered? quota left? within hours? open pass?), before the truck loads.

**Level 2: running totals (updated with every movement)**
| Measure | Calculation | Example |
|---|---|---|
| Trips used | Closed passes + expired passes under review | 64 / 100 |
| Tonnes used | Sum of **measured net tonnes** on closed passes | 1,280 / 2,000 t |
| Overloads | Closed passes with net > rated capacity | 7 trips |
| Vehicles used | Distinct trucks with a closed pass | 14 / 20 |
| Time | Days / hours left in the permit | 11 days left |

**Warnings at 80% / 90% / 100%** of each limit.

**Level 3: reality vs. paperwork (exposes the 100-vs-200 case)**
```
ACTUAL = vehicles the radar counted going OUT     -> 200
LEGAL  = passes properly closed                    -> 100
GAP    = ACTUAL - LEGAL                            -> 100 illegal trips
```
- Every OUT must match exactly one pass closure; each unmatched OUT is an illegal trip with its own evidence.
- Calculated **per gate and per hour** (where and when leaks happen).
- **Trucks currently inside** = INs − OUTs; a truck that entered but never left → expired-pass flag.

**Level 4: monthly mass balance (catch-all for anything that bypasses the gates)**
```
EXTRACTED  = GB drone survey of the pit (volume dug × density)        -> e.g. 3,100 t
DISPATCHED = sum of measured net tonnes at the gates                  -> 2,000 t
STOCKPILED = GB drone survey of stockpiles (change this month)        ->   300 t
GAP        = EXTRACTED - DISPATCHED - STOCKPILED                      ->   800 t unexplained
```
- Catches side routes, a broken pole, a bypassed weigh pad, and digging beyond the permit.
- Surveys are **GB-run** (own drone / contractor); a baseline survey at the start; density from GB samples.
- Evidence it's credible: Coal India made laser stock measurement mandatory over inflated figures; Atami's declared vs
  actual soil (1.5×). Survey method details → hardening S7.

### 3.3 Vendor's own reports (core)
The Vendor's filed trip / tonnage reports are compared with ours. Theirs lower → **under-reporting (E1)** flag.
Vendor figures are only compared against, never used as the source.

### 3.4 Headline view
| | Authorised | Legal | Actual | Vendor reported |
|---|---|---|---|---|
| Trips | 100 (permit) | 100 (closed passes) | 200 (radar) | e.g. 95 |
| Tonnes | 2,000 | 2,000 (measured, closed passes) | 3,100 (mass balance) | e.g. 1,900 |
Click through to each illegal trip: time, gate, photo, plate (or "unidentified").

### 3.5 Near real time, honest gaps
Totals update with every movement. An **offline** pole's numbers are marked **"provisional"** until it syncs; the
dashboard shows which gate's data is late.

### 3.6 Output
Threshold warnings, illegal trips, limit breaches, under-reporting → **Act**. Every comparison result → **Record**.

### 3.7 Independence
All inputs are GB-generated: radar counts, GB weigh pad, GB registry, GB passes, GB permit, GB surveys.


## Step 4: ACT ✅

**Question it answers:** what does the system do once it finds something wrong?
Brief: "alert on, flag, or prevent". The system **prevents, alerts, flags and hands over evidence**; penalties
and contract consequences are the GB's decision.

### 4.1 Prevent (automatic)
| Trigger | Action |
|---|---|
| Unregistered / unidentified / suspended truck at entry | No pass issued |
| Same plate already has an open pass | No pass + clone alert |
| Quota reached (trips, tonnes or vehicles at 100%) | All pass issuing stops |
| Outside permitted hours / permit expired | No passes issued |
| Exit pole down | Exit legally closed (no pass can close there) |
| Truck under a mismatch or clone flag | **Truck on hold**: no new passes until the flag is reviewed |

No pass = no legal way to move material; anything that moves anyway becomes an illegal trip with evidence.

### 4.1a GB-controlled boom barriers (entry and exit)
Turns "prevent" from a paper refusal into a **physical** one. Mines already use RFID boom barriers (Coal India).

**What:** a standard heavy-duty road barrier on **each entry and each exit lane**, wired to **our pole's computer**,
powered by **our solar + battery**. Only the GB system can open it: not the Vendor's guard, software or office.

**Entry barrier (decided 2026-11-21):** lifts **only when a pass is issued** (identified, authorised, not on hold, no
open pass, inside permitted hours, quota left). A refused truck is turned back while it is still **empty**, so nothing
is at stake: no loaded truck stranded at the exit putting pressure on an officer to "just let it go" (the insider
collusion point), and a full quota becomes a clean stop at the gate. The cost is small: a second arm on the same GB
controller. Light vehicles under 6 m (site jeeps, service vans) are let through and logged, not counted as trips; a
pickup-sized load is a known, accepted gap.

```
Truck stops at exit (already stops for the QR scan)
   → radar + plate + pass QR checked by the GB server
   ├── valid pass, plate matches, not on hold → barrier lifts → truck leaves → pass closed → barrier drops
   └── anything fails → barrier stays down → reason on a small display + alert to GB
```

**Sensors on the barrier:** arm position, impact / break, "opened without permission".

**If the Vendor forces it:**
| Act | Result |
|---|---|
| Arm broken or rammed | 🔴 Critical alert + photo / video + radar count: a deliberate act on GB property |
| Arm lifted by hand | "Opened without permission" → 🔴 Critical alert |
| Driving around it | Placed at the narrowest point with bollards / trench beside it; radar still counts the vehicle |

The barrier doesn't make theft impossible; it makes every illegal trip a **visible, recorded act of force** instead of
simply driving out.

**When our system fails (no silent fail-open):**
| Situation | Behaviour |
|---|---|
| No 4G | Pole decides locally from its small pre-allocated offline quota; syncs later |
| Offline quota used up | Stays down; GB alerted to restore the link or authorise |
| Pole / barrier broken | **GB-authorised override only** (remote approval or one-time code to a GB official); every override logged and flagged. The Vendor can never self-override. |
| Long power failure | Battery lasts days; then **fails closed**, with the override path |
| Emergency vehicles | Emergency release procedure; each use logged and flagged |

**Practical notes:** a few seconds per truck; very busy sites need more exit lanes. Installing it needs a contract
clause (GB's decision). Signage and an emergency release are needed for safety.

**PoC (built):** simulated entry and exit barriers in the gate API, exercised by the simulator (`gate_cheats`): entry lifts only when a pass
is issued, exit only on a valid pass close; otherwise the barrier stays down with the reason as an alert. A truck that
breaks through raises a Critical `BARRIER_FORCED`; at the exit it is also counted as an `ILLEGAL_TRIP`.

### 4.2 Alert (severity, channel, escalation)
| Level | Examples | Channel |
|---|---|---|
| 🔴 Critical | Illegal trip (OUT with no pass), pole offline, camera tampered, quota breached | Instantly: dashboard + SMS / app push to site officer |
| 🟠 High | Clone alert, QR reuse, plate mismatch, unidentified vehicle | Dashboard instantly; SMS if not acknowledged in ~15 min |
| 🟡 Medium | Expired pass, closed without QR, empty exit, overload, tag missing, weighbridge discrepancy, Vendor report lower than ours | Dashboard + daily summary |
| 🔴 Critical (monthly) | Mass-balance gap beyond tolerance | Dashboard + SMS to senior officer |
| 🔵 Info | 80% / 90% of a limit | Dashboard + daily summary |

**Escalation:** critical / high alerts not acknowledged in time go to the officer's supervisor.
**Channels:** dashboard + SMS / app push (email / WhatsApp optional).

### 4.3 Flag: review and evidence
Each alert carries an **evidence pack** (time, gate, photos, plate read + confidence, radar length, pass history).
```
OPEN -> ACKNOWLEDGED -> CONFIRMED (violation) or DISMISSED (reason required) -> CLOSED
```
- Alerts can **never be deleted**, only closed with a reason.
- **Fact-based alerts** (OUT with no pass, quota breached) are **confirmed automatically**.
- Stronger reviewer controls (second approver, random assignment) → hardening S8.

### 4.4 Incidents, not floods
Related alerts are grouped: *"37 illegal trips at Gate 2, 18:00–22:00 on 14 Nov"*, with drill-down to each trip.
Keeps the screen readable; guards against alert fatigue (G3).

### 4.5 Vendor notice (core)
For each confirmed violation or incident, the system **generates a notice with the evidence pack** and sends it to
the Vendor (portal / email). The Vendor can respond in the portal (logged). Next steps are the GB's decision.

### 4.6 When the network is down
Prevention continues locally (pole issues passes from its pre-allocated quota, stops when exhausted). Alerts are
raised as soon as data reaches the server; a pole going silent is itself a critical alert.

### 4.7 Out of scope (GB's decision)
Penalties, contract action, police interception. (The GB-controlled exit barrier is **in** core, see 4.1a; the
contract clause allowing it is the GB's decision.)

### 4.8 PoC
Live colour-coded alert feed · simulated SMS / push panel · incident grouping with drill-down · review screen
(acknowledge → confirm / dismiss with reason) · auto-generated Vendor notice for a confirmed incident.

## Step 5: RECORD
*(to be discussed)*
