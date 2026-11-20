# Implementation: GB Truck Registry

The registry is the GB's **own list of which trucks may work at the site, and what each one physically is**.
Everything in it is captured by the GB at a **physical inspection** and checked against VAHAN. The Vendor's fleet
list is never taken as truth (it can be imported only as a "to inspect" list).

Design background: `docs/core_solution.md` (Step 2: IDENTIFY, 2.1) and `docs/core_at_a_glance.md`.

---

## 1. Truck (the vehicle)
| Field | How it's captured | Used in | What for |
|---|---|---|---|
| **Plate number** (normalised, e.g. `KA01AB1234`) + plate type (standard / BH) | Read off the truck, checked against the RC | Identify, Pass | Main lookup key at every gate; the pass is tied to it |
| **Plate photos** (front, rear) | Photographed at inspection | Identify review, Act | A reviewer compares the gate photo with the enrolled one when a mismatch is flagged |
| **FASTag tag ID + factory chip ID** | Read by an **RFID sensor** (same type as on the gate pole) at the enrollment point | Identify, Pass | Second identity that works when the plate is muddy; tag ↔ plate mismatch = clone / swap flag |
| **Length** (metres) | Measured at inspection | Identify | Compared with the radar length at the gate (± ~0.5 m) |
| **Axle count** | Counted at inspection | Identify (later), S3 | Extra physical check; a different axle count means a different truck |
| **Make, model, body type** (tipper, trailer), **colour** | VAHAN + visual check | Identify review | Helps a reviewer judge "same truck or not" from photos |
| **Chassis + engine number** | Read off the truck, matched against VAHAN | Act (disputes), S3 | Final proof in a clone dispute; field inspection |
| **Empty weight** (tonnes) | **Weighed** at enrollment on a certified scale | Measure, Compare | Fallback for net load; sanity check against the entry weight (higher = arrived loaded) |
| **Rated capacity / legal max weight (GVW)** | From the RC / VAHAN | Compare, Act | Overload flag (net > rated); tonnes estimate if a weight is missing |
| **Side / full photos** | Photographed at inspection | Identify review, Act | Evidence packs, visual comparison |
| **Document validity**: registration, fitness, insurance, permit expiry dates | VAHAN | Identify (authorisation) | Expired documents → truck auto-suspended until renewed |
| **VAHAN check result + date** | VAHAN lookup at enrollment | Record | Proof that the plate, make and model are genuine |
| **Status**: active / suspended / on hold / retired + reason + valid from–to | Set by the GB (on hold set automatically by clone / mismatch flags) | Identify, Pass, Act | Only *active* trucks get passes |
| **Site / contract assignment** | Set by the GB | Compare | Which site the truck may work at; counts toward the "max vehicles" limit |

## 2. Transporter (the party)
| Field | Used in | What for |
|---|---|---|
| Company name, address | Act (notices) | Every trip traceable to a company |
| **GSTIN** | Later: e-way bill cross-check | Links our trips to tax records (hardening idea) |
| Contact person + phone | Act | Who receives flags about their trucks |
| Which Vendor contract they serve | Compare, Act | Groups trips and flags per contract; the Vendor notice lists their trucks |

## 3. People who receive the pass
| Field | Used in | What for |
|---|---|---|
| Transporter's registered phone numbers | Pass | Pass delivered by app (QR) + SMS (code) |
| Drivers: name, phone, licence number (optional) | Pass, Act | The transporter sets the **"driver of the day"** per truck, so the pass reaches whoever is driving |

The pass is tied to the **truck**, not to a phone. Phones only receive it, so a driver changing phone or truck doesn't
break anything.

## 4. Enrollment record (who registered it, and the history)
| Field | Used in | What for |
|---|---|---|
| Inspected by (GB officer), date, location | Record | Accountability: who vouched for this truck |
| Approved by (second officer) | Record, S8 | Maker–checker: one person can't enroll a fake truck alone |
| **Change history**: every edit and suspension, with who, when and why | Record | Nothing is overwritten silently; the registry is part of the tamper-evident trail |

---

## Where the registry is used in the flows
```
 IDENTIFY  plate / FASTag lookup → status active? → length matches? → plate and tag point to the same truck?
 PASS      tied to plate + FASTag; sent to registered numbers; refused if suspended / on hold / documents expired
 MEASURE   empty weight (fallback / sanity), rated capacity (overload)
 COMPARE   site assignment → "max vehicles" limit; rated capacity → tonnes fallback
 ACT       status → hold / suspend; photos, chassis number, owner → evidence pack + Vendor / transporter notice
 RECORD    enrollment + change history → nothing in the registry changes silently
```

## What we deliberately don't store
- **The Vendor's fleet list as truth**: importable only as a "to inspect" list, never as registered trucks.
- **Personal data we don't need**: only driver contacts for pass delivery; licence number optional.

---

## PoC scope (branch `feature/registry-plate-flow`)
- **Full schema built now** (all fields above), so later branches don't need to reshape it.
- **The registry is ground truth**: every record is what the GB physically verified, so seeded records are all
  correct. Only legitimate states vary (most active; one suspended; one with an expired fitness certificate).
  **Cheating scenarios (misreads, unreadable plates, unregistered trucks, clones) live in the simulated gate
  events**, which are compared against the registry, never in the registry itself.
- **Test data only**: made-up transporters, drivers and trucks with realistic Indian plates; **no real photos**.
  Photos are optional; any uploads are kept in a persistent volume.
- **Officers**: a few seeded GB officers (inspector / approver / reviewer); the dashboard has an "acting as"
  dropdown, so every change is recorded against an officer without needing a login.
- **Everything persists** (Postgres volume + uploads volume); schema changes are versioned with Alembic.
- **Registry screen** shows and edits: plate, FASTag IDs, length, empty weight, rated capacity, make / model,
  transporter, status, photos, document expiry dates.
- **VAHAN check simulated**: a "verified" flag + date (no real VAHAN access).
- **Enrollment**: inspector + approver stored and shown; full maker–checker workflow later.
- **Change history** stored for every create / edit / status change.
- **Seed data**: ~10 trucks across 2–3 transporters, matching the sample images used in the plate-reading flow.
