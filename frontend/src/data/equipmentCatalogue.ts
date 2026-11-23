export interface BrandCategory {
  category: string;
  brands: string[];
}

export interface EquipmentSpecification {
  label: string;
  value: string;
}

export interface EquipmentItem {
  id: string;
  name: string;
  category: string;
  quantity: string;
  priceDisplay: string;
  minPrice: number;
  maxPrice: number;
  currency: string;
  unitNote?: string;
  shortDescription: string;
  fullDescription: string;
  brands: string[];
  brandCategories?: BrandCategory[];
  exampleEquipment?: string[];
  keyFeatures: string[];
  specifications: EquipmentSpecification[];
  procurementNotes?: string;
  operationalNotes?: string;
  safetyNotes?: string;
  backupCovered?: boolean;
  illustrationType:
    | "anpr-camera"
    | "rfid-reader"
    | "rfid-sticker"
    | "boom-barrier"
    | "radar-system"
    | "local-server"
    | "installation-commissioning"
    | "wim-system"
    | "battery-backup"
    | "wim-commissioning"
    | "lidar-drone"
    | "drone-software"
    | "satellite-imagery"
    | "electric-fencing";
}

export interface TierData {
  id: number;
  tierNumber: string;
  title: string;
  subtitle: string;
  description: string;
  budgetDisplay: string;
  minBudget: number;
  maxBudget: number;
  equipmentIds: string[];
  additionalNotes?: string;
  badge: string;
  accentColor: string;
}

export const EQUIPMENT_ITEMS: Record<string, EquipmentItem> = {
  "anpr-camera": {
    id: "anpr-camera",
    name: "Solar-Powered ANPR Camera System",
    category: "Optical & Vehicle Recognition",
    quantity: "2 cameras (1 Entry + 1 Exit)",
    priceDisplay: "₹2.5 lakh – ₹5 lakh",
    minPrice: 250000,
    maxPrice: 500000,
    currency: "INR (₹)",
    unitNote: "for 2 camera units + solar & 4G kit",
    shortDescription:
      "Captures high-resolution vehicle number plates at entry and exit points with autonomous solar power and dedicated 4G transmission.",
    fullDescription:
      "Captures vehicle number plates at entry and exit points. Solar panels provide independent power, while GB-owned 4G connectivity transmits observations to the GB monitoring infrastructure.",
    brands: [
      "Axis Communications",
      "Bosch",
      "Hikvision",
      "Hanwha Vision",
      "Waaree",
      "Vikram Solar",
      "Exide",
      "Luminous",
      "Airtel",
      "Jio",
      "Teltonika",
      "Robustel",
    ],
    brandCategories: [
      {
        category: "Camera & Optical Units",
        brands: ["Axis Communications", "Bosch", "Hikvision", "Hanwha Vision"],
      },
      {
        category: "Solar & Power Components",
        brands: ["Waaree", "Vikram Solar", "Exide", "Luminous"],
      },
      {
        category: "Independent Connectivity (4G / Industrial Routers)",
        brands: ["Airtel", "Jio", "Teltonika", "Robustel"],
      },
    ],
    keyFeatures: [
      "Automatic Number Plate Recognition (ANPR)",
      "Day and night capture with adaptive optics",
      "High-power infrared (IR) illumination",
      "Solar-powered operation with mono-PERC panels",
      "Battery-backed camera operation",
      "Independent GB-owned 4G connectivity",
      "Local tamper-resistant image/video storage",
      "Timestamped, cryptographically signed vehicle observations",
    ],
    specifications: [
      { label: "Optical Sensor", value: "4K / Full HD Global Shutter sensor with motorized zoom" },
      { label: "Night Vision", value: "Smart IR up to 50m with anti-glare retroreflective plate filter" },
      { label: "Power Source", value: "Dedicated 300W+ solar panel with MPPT solar charge controller" },
      { label: "Cellular Uplink", value: "Dual-SIM 4G LTE Cat 4 / Cat 6 industrial gateway with VPN" },
      { label: "Operating Temp", value: "-20°C to +65°C, IP67 weatherproof, IK10 vandal-resistant" },
      { label: "Edge Processing", value: "On-camera neural plate detection with confidence scoring" },
    ],
    procurementNotes:
      "Verify camera firmware supports edge OCR for standard Indian high-security registration plates (HSRP) and commercial vehicle formats. Power autonomy must account for monsoon cloud cover.",
    backupCovered: true,
    illustrationType: "anpr-camera",
  },

  "rfid-reader": {
    id: "rfid-reader",
    name: "Cryptographic RFID Reader and Authentication System",
    category: "Identity & Cryptography",
    quantity: "2 reader points (1 Entry + 1 Exit)",
    priceDisplay: "₹4 lakh – ₹10 lakh",
    minPrice: 400000,
    maxPrice: 1000000,
    currency: "INR (₹)",
    unitNote: "for 2 reader controller points + circular antenna arrays",
    shortDescription:
      "Authenticates GB-issued cryptographic vehicle identification stickers via UHF challenge-response, isolated from contractor FASTag systems.",
    fullDescription:
      "Authenticates GB-issued vehicle identification stickers using cryptographic RFID technology. Provides an additional vehicle identity check independent of contractor-issued FASTag infrastructure.",
    brands: [
      "Impinj",
      "Zebra Technologies",
      "Honeywell",
      "NXP UCODE DNA",
      "Tageos",
      "Confidex",
    ],
    brandCategories: [
      {
        category: "Reader Equipment Manufacturers",
        brands: ["Impinj", "Zebra Technologies", "Honeywell"],
      },
      {
        category: "Compatible Cryptographic Chip & Tag Ecosystems",
        brands: ["NXP UCODE DNA", "Tageos", "Confidex"],
      },
    ],
    keyFeatures: [
      "UHF RFID long-range directional reading (865–867 MHz India band)",
      "AES-128 cryptographic authentication (subject to exact chip and reader compatibility)",
      "Challenge-response authentication preventing tag replay & cloning",
      "High-gain circular polarized reader antennas and controllers",
      "Vehicle association with multi-factor cross-validation",
      "Unknown, revoked and invalid tag detection and instant alert",
      "GB-controlled authentication records with hardware timestamping",
    ],
    specifications: [
      { label: "Frequency Range", value: "865 - 867 MHz (WPC India compliant)" },
      { label: "Crypto Engine", value: "AES-128 hardware coprocessor with secret key diversification" },
      { label: "Read Distance", value: "Up to 8-12 meters with directional antenna beamforming" },
      { label: "Interface", value: "Industrial Ethernet / RS-485 / Wiegand with TLS secure channel" },
      { label: "Controller Rating", value: "IP66 outdoor rated lockable enclosure with tamper switch" },
    ],
    procurementNotes:
      "NXP UCODE DNA is a cryptographic UHF RFID chip family. Honeywell, Impinj and Zebra are reader equipment manufacturers. Verify the exact reader model's support for the selected chip's cryptographic authentication protocol before procurement.",
    backupCovered: true,
    illustrationType: "rfid-reader",
  },

  "rfid-stickers": {
    id: "rfid-stickers",
    name: "Tamper-Evident Cryptographic RFID Stickers",
    category: "Identity & Media",
    quantity: "100 stickers (registered fleet deployment)",
    priceDisplay: "₹50,000 – ₹1.5 lakh",
    minPrice: 50000,
    maxPrice: 150000,
    currency: "INR (₹)",
    unitNote: "for batch of 100 programmed tamper-evident stickers",
    shortDescription:
      "Permanent windshield stickers with destructive frangible patterns that tear on peeling, housing AES-128 cryptographic silicon.",
    fullDescription:
      "Permanent GB-issued vehicle identification stickers attached to registered vehicles. Tamper-evident construction helps reveal removal or attempted transfer to another vehicle.",
    brands: ["NXP UCODE DNA", "Tageos", "Confidex"],
    brandCategories: [
      {
        category: "Secure Cryptographic Silicon & Tag Converters",
        brands: ["NXP UCODE DNA", "Tageos", "Confidex"],
      },
    ],
    keyFeatures: [
      "Cryptographic silicon chip with tamper-proof non-volatile memory",
      "AES-128 capability where supported by the selected tag",
      "Tamper-evident adhesive construction (breaks electrical circuit on removal)",
      "Unique factory-burned serial identity (TID) with GB digital signature",
      "GB-controlled registration with centralized key-management lifecycle",
      "Revocation and replacement tracking with audit trails",
    ],
    specifications: [
      { label: "Substrate & Adhesive", value: "Destructive frangible PET film with optical security foil" },
      { label: "Chipset", value: "NXP UCODE DNA or certified cryptographic equivalent" },
      { label: "Memory Architecture", value: "Up to 3 Kbits user memory + 128-bit AES crypto keys" },
      { label: "Mounting Location", value: "Inside windshield behind rearview mirror (UV & heat stable)" },
      { label: "Durability", value: "Resistant to moisture, cleaning chemicals, and direct solar UV" },
    ],
    procurementNotes:
      "Tags must be delivered with factory-verified cryptographic certificates and randomized serial mappings securely handed over to Governing Body authorities.",
    backupCovered: false,
    illustrationType: "rfid-sticker",
  },

  "boom-barriers": {
    id: "boom-barriers",
    name: "Automated Entry and Exit Boom Barriers",
    category: "Physical Access Control",
    quantity: "2 barriers (1 Entry + 1 Exit)",
    priceDisplay: "₹3 lakh – ₹7 lakh",
    minPrice: 300000,
    maxPrice: 700000,
    currency: "INR (₹)",
    unitNote: "for 2 heavy-duty barrier units + safety loops",
    shortDescription:
      "Heavy-duty industrial automated barriers actuated strictly upon cryptographic authorization from the GB edge server.",
    fullDescription:
      "Controls physical vehicle access at the designated entry and exit points based on the GB authorization workflow.",
    brands: ["FAAC", "CAME", "Magnetic Autocontrol", "BFT"],
    brandCategories: [
      {
        category: "Industrial Barrier Manufacturers",
        brands: ["FAAC", "CAME", "Magnetic Autocontrol", "BFT"],
      },
    ],
    keyFeatures: [
      "Automated industrial boom barrier rated for continuous duty",
      "Deterministic entry and exit flow control",
      "Direct integration with GB authorization workflow and edge decisions",
      "Physical and keyed manual override under emergency protocol",
      "Dual safety: ultrasonic obstruction sensors and inductive ground loops",
      "Hardware event logging and status telemetry back to the GB server",
      "Emergency breakaway and auto-reversal safety procedures",
    ],
    specifications: [
      { label: "Boom Length", value: "4.5m to 6.0m aluminum arm with LED illumination strip" },
      { label: "Cycle Speed", value: "1.5s to 3.5s rapid open / controlled dampening close" },
      { label: "Duty Cycle", value: "100% continuous duty rating (brushless DC or hydraulic drive)" },
      { label: "Safety Mechanism", value: "Inductive vehicle loop detector + active infrared safety beam" },
      { label: "Breakaway Mechanism", value: "Breakaway flange preventing motor gear destruction on impact" },
    ],
    procurementNotes:
      "Specify boom arms with break-away joints or crash breakaway flanges to prevent motor gearbox destruction if an unauthorized truck forces through.",
    backupCovered: true,
    illustrationType: "boom-barrier",
  },

  "radar-system": {
    id: "radar-system",
    name: "Vehicle Detection and Measurement Radar",
    category: "Telemetry & Volumetric",
    quantity: "2 radar units (1 Entry + 1 Exit)",
    priceDisplay: "₹4 lakh – ₹12 lakh",
    minPrice: 400000,
    maxPrice: 1200000,
    currency: "INR (₹)",
    unitNote: "for 2 FMCW 3D millimeter-wave radar units",
    shortDescription:
      "Independent 3D radar sensors that detect presence, track approach velocity, and measure truck dimensions regardless of dust or fog.",
    fullDescription:
      "Provides independent vehicle detection and radar-based observations at the monitored gate locations.",
    brands: ["smartmicro", "SICK", "Wavetronix"],
    brandCategories: [
      {
        category: "Millimeter-Wave & Industrial Radar Manufacturers",
        brands: ["smartmicro", "SICK", "Wavetronix"],
      },
    ],
    keyFeatures: [
      "Independent vehicle detection unaffected by rain, heavy dust, or darkness",
      "Continuous vehicle trajectory and approach movement observation",
      "Precision speed measurement where supported by selected radar model",
      "Vehicle dimension measurement (length & height) where supported by model",
      "Microsecond-precise timestamped observations",
      "Native digital integration with the GB monitoring backend",
    ],
    specifications: [
      { label: "Frequency Band", value: "76–81 GHz FMCW High-Definition 3D radar" },
      { label: "Detection Range", value: "0.5m to 40m gate approach corridor" },
      { label: "Dimension Accuracy", value: "Length estimation within ±15cm on calibrated lane" },
      { label: "Environmental", value: "IP67 hermetically sealed against airborne mining particulate" },
      { label: "Update Rate", value: "Up to 20Hz real-time target point cloud" },
    ],
    procurementNotes:
      "Select forward-firing or side-profile radar modules that support precise length measurement for truck model verification against registry data.",
    backupCovered: true,
    illustrationType: "radar-system",
  },

  "local-server": {
    id: "local-server",
    name: "GB-Controlled Local Server Infrastructure",
    category: "Edge Compute & Storage",
    quantity: "1 installation (on-site secure enclosure)",
    priceDisplay: "₹4 lakh – ₹8 lakh",
    minPrice: 400000,
    maxPrice: 800000,
    currency: "INR (₹)",
    unitNote: "for edge server rack, network switches & security cabinet",
    shortDescription:
      "Ruggedized on-site server hosting the edge gate engine, cryptographic verification routines, and tamper-evident local database.",
    fullDescription:
      "Hosts the local monitoring application, databases, event records and edge-processing services under GB control.",
    brands: ["Dell PowerEdge", "HPE ProLiant", "Lenovo ThinkSystem"],
    brandCategories: [
      {
        category: "Enterprise Server Hardware",
        brands: ["Dell PowerEdge", "HPE ProLiant", "Lenovo ThinkSystem"],
      },
    ],
    keyFeatures: [
      "Local application hosting running the Aphelion edge container stack",
      "Hardened PostgreSQL database with append-only hash chaining",
      "Encrypted local event storage with multi-terabyte retention",
      "Isolated GB network infrastructure (VLAN, industrial managed switch)",
      "RAID storage redundancy with automated snapshots",
      "Dedicated rack-mount smart UPS support with graceful shutdown",
      "Complete offline autonomous operation during telecommunications outages",
      "Store-and-forward synchronization with central GB headquarters infrastructure",
    ],
    specifications: [
      { label: "Compute Hardware", value: "1U/2U Rackmount Server, 16-Core Xeon/EPYC, 64GB ECC RAM" },
      { label: "Storage Architecture", value: "4x 2TB Enterprise NVMe/SSD in RAID-10 with hardware TPM 2.0" },
      { label: "Security Cabinet", value: "Tamper-monitored, lockable IP55 server cabinet with filtered cooling" },
      { label: "Network Security", value: "Hardware firewall, isolated GB management VLAN, TLS 1.3 endpoints" },
      { label: "Local Database", value: "PostgreSQL with SHA-256 event chaining and write-ahead cryptographic logs" },
    ],
    procurementNotes:
      "Physical cabinet must feature dual-key mechanical locks and electronic door-open tamper sensors that trigger automated alerts if opened without officer authorization.",
    backupCovered: true,
    illustrationType: "local-server",
  },

  "installation-commissioning": {
    id: "installation-commissioning",
    name: "Installation and Commissioning (Tier 1)",
    category: "Civil & Integration Services",
    quantity: "1 site turn-key deployment",
    priceDisplay: "₹3 lakh – ₹8 lakh",
    minPrice: 300000,
    maxPrice: 800000,
    currency: "INR (₹)",
    unitNote: "for site civil works, cabling, mounting & commissioning",
    shortDescription:
      "Mounting poles, ruggedized outdoor enclosures, trenching, industrial cabling, network setup, and full system integration.",
    fullDescription:
      "Installation, mounting, equipment enclosures, cabling, configuration, integration and commissioning of the independent monitoring infrastructure.",
    brands: ["System Integrators", "Field Engineering Contractors"],
    brandCategories: [
      {
        category: "Engineering & Integration Services",
        brands: ["Certified Indian System Integrators", "Specialized Mining Infrastructure Contractors"],
      },
    ],
    keyFeatures: [
      "Heavy-duty pole mounting & gantry civil fixtures for cameras and radar",
      "Industrial weather-proof IP66 junction boxes and hardware enclosures",
      "Armored outdoor cabling and fiber/copper conduits",
      "GB edge local area network configuration and penetration testing",
      "End-to-end integration, sensor calibration, and commissioning sign-off",
      "Site acceptance testing with registered test vehicles",
    ],
    specifications: [
      { label: "Scope of Work", value: "Turn-key mechanical, electrical, and data cabling for 2 lanes" },
      { label: "Civil Fixtures", value: "Vibration-damped structural steel poles with lockable base vaults" },
      { label: "Testing Standard", value: "100-vehicle commissioning pass rate validation before handover" },
    ],
    procurementNotes:
      "Ensure contracting scope clearly specifies dedicated earthing pits and surge protection devices (SPDs) compliant with IS 3043 for lightning protection in open mining zones.",
    backupCovered: false,
    illustrationType: "installation-commissioning",
  },

  // ---------------- Tier 2 Additional Equipment ----------------
  "wim-system": {
    id: "wim-system",
    name: "Weigh-In-Motion (WIM) System",
    category: "Dynamic Weight Verification",
    quantity: "1 installation, subject to lane configuration",
    priceDisplay: "₹30 lakh – ₹1 crore",
    minPrice: 3000000,
    maxPrice: 10000000,
    currency: "INR (₹)",
    unitNote: "for in-pavement sensor array, charge amplifiers & DAQ controller",
    shortDescription:
      "Dynamic in-pavement sensors that capture axle weights and estimate gross vehicle weight while trucks move, catching unrecorded or overloaded runs.",
    fullDescription:
      "Measures vehicle axle loads and estimates gross vehicle weight while vehicles pass over an instrumented road section. Provides an additional independent weight observation for verification and anomaly detection.",
    brands: ["Kistler", "International Road Dynamics (IRD)", "Intercomp"],
    brandCategories: [
      {
        category: "Global Weigh-In-Motion Technology Providers",
        brands: ["Kistler (LineSpect / LineQuart)", "International Road Dynamics (IRD)", "Intercomp"],
      },
    ],
    keyFeatures: [
      "Dynamic axle-weight measurement at speeds up to 40 km/h",
      "Estimated gross vehicle weight (GVW) calculation",
      "Axle spacing and vehicle speed association",
      "Microsecond timestamped measurement records",
      "Autonomous measurement-quality indicators and confidence bounds",
      "Automated overload detection against legal road limits",
      "Integration with vehicle identity and gate passage events",
      "Completely independent data recording isolated from contractor weighbridges",
    ],
    specifications: [
      { label: "Sensor Technology", value: "Quartz crystal / Piezoelectric LineSensors embedded in pavement" },
      { label: "Accuracy Class", value: "COST 323 Class B+(7) / OIML R134 dynamic weight standard" },
      { label: "Axle Load Range", value: "Up to 30 tonnes per axle (handles heavy mining tippers)" },
      { label: "Operating Speed", value: "5 km/h to 50 km/h continuous passage" },
      { label: "Data Interface", value: "High-speed DAQ controller with direct TCP/IP telemetry to GB server" },
    ],
    procurementNotes:
      "Quartz-based piezoelectric strip sensors provide superior long-term thermal stability across Indian summer road temperature fluctuations compared to older polymer strips.",
    operationalNotes:
      "WIM acts as an additional independent weight verification mechanism. It does not replace radar or a certified static weighbridge. Its measurements should be interpreted according to system accuracy, calibration and measurement quality.",
    backupCovered: true,
    illustrationType: "wim-system",
  },

  "battery-backup": {
    id: "battery-backup",
    name: "Two-Day Independent Battery Backup System",
    category: "Power Resilience & Continuity",
    quantity: "1 comprehensive site installation",
    priceDisplay: "₹15 lakh – ₹40 lakh",
    minPrice: 1500000,
    maxPrice: 4000000,
    currency: "INR (₹)",
    unitNote: "for 48-hour battery bank, inverter, charge controllers & switchgear",
    shortDescription:
      "Dedicated 48-hour battery storage system guaranteeing unbroken monitoring through mining grid blackouts and deliberate power cuts.",
    fullDescription:
      "Provides up to 48 hours of backup power for the complete electrical monitoring infrastructure during a power interruption.",
    brands: ["Exide", "Amara Raja", "Luminous", "Victron Energy"],
    brandCategories: [
      {
        category: "Industrial Battery & Power Systems",
        brands: ["Exide", "Amara Raja", "Luminous", "Victron Energy"],
      },
    ],
    keyFeatures: [
      "High-capacity industrial battery bank (LiFePO4 or heavy-duty tubular VRLA)",
      "Pure sine wave industrial inverter and online double-conversion UPS",
      "Substation-grade power distribution board (PDB) with isolation transformers",
      "Class I & II lightning surge protection (SPD) on AC and DC lines",
      "Real-time individual cell voltage and temperature monitoring",
      "Backup status telemetry and state-of-charge (SoC) reporting to GB console",
      "48-hour full-load autonomy design target",
    ],
    specifications: [
      { label: "Energy Capacity", value: "30 kWh – 60 kWh sized for complete 2-lane gate deployment" },
      { label: "Autonomy Duration", value: "48 continuous hours without grid or solar contribution" },
      { label: "Protected Loads", value: "ANPR cameras, RFID readers, boom barriers, radar, WIM DAQ, server, switches" },
      { label: "Chemistry Options", value: "Lithium Iron Phosphate (LiFePO4) 48V or 2V Heavy Tubular VRLA cells" },
      { label: "Monitoring", value: "SNMP / Modbus integration with remote state-of-charge telemetry" },
    ],
    operationalNotes:
      "The backup must cover: ANPR cameras and their communication equipment, RFID readers and controllers, Entry and exit boom barriers, Radar units, WIM sensors and controller, Local GB server, Network equipment and storage infrastructure. Actual battery capacity must be calculated from the continuous and peak electrical loads, barrier operating cycles, equipment efficiency, battery ageing and site conditions.",
    backupCovered: false,
    illustrationType: "battery-backup",
  },

  "wim-commissioning": {
    id: "wim-commissioning",
    name: "WIM Installation and Commissioning",
    category: "Pavement Civil & Calibration",
    quantity: "1 installation (entry and exit approaches)",
    priceDisplay: "₹5 lakh – ₹15 lakh",
    minPrice: 500000,
    maxPrice: 1500000,
    currency: "INR (₹)",
    unitNote: "for precision road grooving, epoxy potting & dynamic calibration",
    shortDescription:
      "High-precision pavement slot cutting, sensor potting with specialized epoxy, controller calibration, and reference test truck runs.",
    fullDescription:
      "Includes road preparation, sensor installation, controller integration, calibration and system commissioning.",
    brands: [
      "Certified Highway Engineers",
      "WIM Specialist Integrators",
      "Civil Road Contractors",
    ],
    brandCategories: [
      {
        category: "Specialist Engineering Contractors",
        brands: [
          "Certified Highway Engineers",
          "WIM Specialist Integrators",
          "Civil Road Contractors",
        ],
      },
    ],
    keyFeatures: [
      "Precision concrete/asphalt pavement saw-cutting and channel preparation",
      "In-pavement quartz sensor leveling and potting using high-strength polyurethane/epoxy",
      "Controller integration, charge amplifier shielding and conduit routing",
      "Multi-speed dynamic calibration using pre-weighed reference multi-axle trucks",
      "Full calibration certificate and system commissioning sign-off",
    ],
    specifications: [
      { label: "Pavement Requirement", value: "50m smooth approach corridor meeting COST 323 flatness criteria" },
      { label: "Potting Compound", value: "Fast-curing high-modulus polyurethane / epoxy grout" },
      { label: "Calibration Runs", value: "Minimum 20 passes at varied speeds with certified reference truck" },
    ],
    procurementNotes:
      "Pavement approach flatness is critical to WIM accuracy. The civil contractor must mill or level any road undulations 30 meters prior to the sensor line.",
    backupCovered: false,
    illustrationType: "wim-commissioning",
  },

  // ---------------- Tier 3 Additional Equipment ----------------
  "lidar-drone": {
    id: "lidar-drone",
    name: "UAV Drone with LiDAR Payload",
    category: "Aerial Intelligence & Volumetrics",
    quantity: "1 enterprise drone system + dual LiDAR payload",
    priceDisplay: "₹30 lakh – ₹80 lakh",
    minPrice: 3000000,
    maxPrice: 8000000,
    currency: "INR (₹)",
    unitNote: "for industrial RTK drone platform, LiDAR sensor & base station",
    shortDescription:
      "Autonomous aerial surveying platform that scans pit topography and stockpiles through foliage and dust to compute exact extracted volumes.",
    fullDescription:
      "Provides aerial surveying and terrain mapping to independently observe mining-site terrain, extraction areas and changes in land elevation.",
    brands: ["DJI Enterprise", "YellowScan", "RIEGL"],
    brandCategories: [
      {
        category: "Enterprise UAV & LiDAR Manufacturers",
        brands: ["DJI Enterprise", "YellowScan", "RIEGL"],
      },
    ],
    exampleEquipment: [
      "DJI Matrice 350 RTK",
      "DJI Zenmuse L2 LiDAR payload",
      "YellowScan UAV LiDAR systems",
      "RIEGL UAV LiDAR systems",
    ],
    keyFeatures: [
      "UAV-based high-density LiDAR scanning and multispectral photogrammetry",
      "Independent terrain mapping without relying on operator land surveys",
      "Dense 3D point-cloud generation penetrating dust, brush, and canopy",
      "Digital Elevation Model (DEM) and Digital Surface Model (DSM) creation",
      "Comprehensive site boundary and excavation pit surveillance",
      "Extraction-area monitoring detecting off-lease or unauthorized dig sites",
      "Periodic volumetric mass-balance estimation compared against recorded truck despatches",
    ],
    specifications: [
      { label: "Flight Platform", value: "Industrial quadcopter / hexacopter with IP55 weather rating" },
      { label: "LiDAR Precision", value: "Vertical accuracy 4cm, horizontal accuracy 5cm at 120m AGL" },
      { label: "Point Rate", value: "Up to 240,000 points/sec with up to 5 returns per pulse" },
      { label: "Flight Time", value: "40 to 55 minutes per battery set with automated hot-swap" },
      { label: "Navigation", value: "D-RTK 2 High-Precision GNSS base station with centimetre accuracy" },
    ],
    procurementNotes:
      "Ensure compliant registration under India's DigitalSky portal (UIN / DGCA drone certification) and establish scheduled flight clearance protocols with local civil aviation authorities.",
    backupCovered: false,
    illustrationType: "lidar-drone",
  },

  "drone-software": {
    id: "drone-software",
    name: "Drone Processing Software and Accessories",
    category: "Photogrammetry & Point-Cloud Analytics",
    quantity: "1 processing workstation & software licence suite",
    priceDisplay: "₹5 lakh – ₹15 lakh",
    minPrice: 500000,
    maxPrice: 1500000,
    currency: "INR (₹)",
    unitNote: "for enterprise photogrammetry licence & rugged field kit",
    shortDescription:
      "High-performance analytical software transforming raw laser scan points into classified terrain models, cut-and-fill volumes, and compliance maps.",
    fullDescription:
      "Processes drone survey data into usable 3D terrain models, point clouds and mapping outputs.",
    brands: ["DJI Terra", "Pix4D"],
    brandCategories: [
      {
        category: "Photogrammetry & 3D Analytics Software",
        brands: ["DJI Terra", "Pix4D (Pix4Dmatic / Pix4Dsurvey)"],
      },
    ],
    keyFeatures: [
      "Automated LiDAR point-cloud processing and ground point classification",
      "High-precision 3D terrain reconstruction and mesh generation",
      "Digital Terrain Models (DTM) and contour line extraction",
      "Survey data analysis with cut/fill volume differential comparison",
      "Compliance mapping and audit-ready volumetric reporting",
      "Automated diffing against previous survey epochs to calculate net mined tonnage",
    ],
    specifications: [
      { label: "Processing Engine", value: "GPU-accelerated photogrammetry & LiDAR registration algorithms" },
      { label: "Output Formats", value: "LAS/LAZ point clouds, GeoTIFF elevation models, DXF/DWG CAD meshes" },
      { label: "Volumetric Tool", value: "Polygon-bounded volume calculation against arbitrary baseline planes" },
      { label: "Field Hardware", value: "Ruggedized field laptop, charging hub, RTK pole and ground control targets" },
    ],
    procurementNotes:
      "Perpetual licenses with multi-year update protection are recommended for government monitoring infrastructure to avoid sudden software expiration in field deployments.",
    backupCovered: false,
    illustrationType: "drone-software",
  },

  "satellite-imagery": {
    id: "satellite-imagery",
    name: "Satellite Imagery and Site Monitoring",
    category: "Orbital Earth Observation",
    quantity: "Annual recurring subscription (periodic tasking)",
    priceDisplay: "₹3 lakh – ₹15 lakh per year",
    minPrice: 300000,
    maxPrice: 1500000,
    currency: "INR (₹)",
    unitNote: "recurring annual subscription based on site area & revisit cadence",
    shortDescription:
      "Sub-meter orbital imagery tracking mining pit perimeter expansion, new haul roads, and unauthorized external excavation clusters.",
    fullDescription:
      "Provides periodic satellite imagery for independent observation of mining-site expansion, land-use changes, extraction patterns and potential activity outside approved boundaries.",
    brands: ["Maxar", "Airbus Defence and Space", "Planet Labs"],
    brandCategories: [
      {
        category: "Commercial Earth Observation Constellations",
        brands: ["Maxar (WorldView)", "Airbus Defence and Space (Pléiades Neo)", "Planet Labs (SkySat / PlanetScope)"],
      },
    ],
    keyFeatures: [
      "High-resolution optical satellite imagery (30cm – 50cm ground sample distance)",
      "Periodic scheduled site monitoring covering wide catchment areas",
      "Automated land-use change detection and vegetation loss tracking",
      "Excavation-area comparison against official mining lease boundary polygons",
      "Boundary encroachment monitoring detecting illegal bypass tracks",
      "Historical imagery archival comparison over multiple fiscal years",
    ],
    specifications: [
      { label: "Resolution", value: "30cm to 50cm per pixel optical multispectral imagery" },
      { label: "Revisit Cadence", value: "Bi-weekly or monthly tasking with cloud-free threshold filtering" },
      { label: "Analysis Pipeline", value: "Orthorectified GeoTIFF with automated spectral change masks" },
      { label: "Coverage", value: "Standard 25 sq. km tile encompassing lease and 2km buffer perimeter" },
    ],
    operationalNotes:
      "Satellite imagery pricing is recurring and depends on area, image resolution, revisit frequency and availability.",
    backupCovered: false,
    illustrationType: "satellite-imagery",
  },

  "electric-fencing": {
    id: "electric-fencing",
    name: "Electric Perimeter Security Fencing",
    category: "Perimeter Intrusion Deterrence",
    quantity: "Per kilometre of surveyed site perimeter",
    priceDisplay: "₹5 lakh – ₹12 lakh per kilometre",
    minPrice: 500000,
    maxPrice: 1200000,
    currency: "INR (₹)",
    unitNote: "per linear kilometre of high-tensile security fencing",
    shortDescription:
      "Regulated non-lethal pulsed electric fencing channeling all vehicle traffic exclusively through monitored GB gate corridors.",
    fullDescription:
      "Establishes a physical perimeter deterrence mechanism to discourage unauthorized entry or movement outside designated entry and exit locations.",
    brands: ["Gallagher", "Nemtek", "JVA"],
    brandCategories: [
      {
        category: "Perimeter Security & Energizer Manufacturers",
        brands: ["Gallagher", "Nemtek", "JVA"],
      },
    ],
    keyFeatures: [
      "Professionally installed high-tensile perimeter security fencing",
      "Non-lethal pulsed electric energizer with controlled millisecond pulse discharge",
      "Continuous electrical loop monitoring detecting cut wires and short circuits",
      "Tamper and fault alerts where supported with zoned perimeter locator",
      "Bilingual warning signage prominently displayed at 10-meter intervals",
      "Controlled physical access points directing haulage to official gates",
      "Direct integration with perimeter security alert channels on the GB console",
    ],
    specifications: [
      { label: "Energizer Discharge", value: "Pulsed electric shock conforming strictly to IEC 60335-2-76 / IS 302" },
      { label: "Wire Construction", value: "20-24 strand high-tensile galvanized / aluminum-alloy security wire" },
      { label: "Post Architecture", value: "Intermediate steel droppers with UV-stabilized heavy insulators" },
      { label: "Alarm Sensitivity", value: "Triggers on cut, climb, short-circuit, or earth grounding" },
      { label: "Signage", value: "Reflective high-visibility bilingual hazard warning boards" },
    ],
    safetyNotes:
      "Use only a compliant, professionally designed non-lethal pulsed electric security fence. Do not use continuously energized lethal high-voltage fencing. Installation must follow applicable Indian safety requirements.",
    backupCovered: false,
    illustrationType: "electric-fencing",
  },
};

export const TIERS_DATA: TierData[] = [
  {
    id: 1,
    tierNumber: "Tier 1",
    title: "Basic Independent Monitoring",
    subtitle: "Vehicle Identification & Gate Evidence",
    description:
      "Establish an independent monitoring infrastructure controlled by the Governing Body, enabling vehicle identification, movement detection and local evidence collection without depending on contractor-controlled monitoring systems.",
    budgetDisplay: "₹21 lakh – ₹51.5 lakh",
    minBudget: 2100000,
    maxBudget: 5150000,
    equipmentIds: [
      "anpr-camera",
      "rfid-reader",
      "rfid-stickers",
      "boom-barriers",
      "radar-system",
      "local-server",
      "installation-commissioning",
    ],
    badge: "Core Independent Monitoring",
    accentColor: "#1f5eff",
  },
  {
    id: 2,
    tierNumber: "Tier 2",
    title: "Independent Monitoring + Weight Verification + Power Resilience",
    subtitle: "Dynamic Axle Weight Verification + 48h Grid Autonomy",
    description:
      "Extends Tier 1 with independent vehicle weight observation and a two-day backup power system covering the complete electrical equipment deployment.",
    budgetDisplay: "₹71 lakh – ₹2.07 crore",
    minBudget: 7100000,
    maxBudget: 20700000,
    equipmentIds: [
      "anpr-camera",
      "rfid-reader",
      "rfid-stickers",
      "boom-barriers",
      "radar-system",
      "local-server",
      "installation-commissioning",
      "wim-system",
      "battery-backup",
      "wim-commissioning",
    ],
    badge: "Weight Verification & Power Resilience",
    accentColor: "#10b981",
  },
  {
    id: 3,
    tierNumber: "Tier 3",
    title: "Advanced Monitoring + Aerial Intelligence + Perimeter Security",
    subtitle: "Aerial LiDAR volumetric scans, satellite oversight & perimeter enclosure",
    description:
      "Extends the independent monitoring infrastructure with aerial LiDAR surveys, satellite-based site monitoring and physical perimeter intrusion deterrence.",
    budgetDisplay: "₹1.06 crore – ₹2.72 crore*",
    minBudget: 10600000,
    maxBudget: 27200000,
    additionalNotes:
      "Initial investment excludes electric fencing (₹5L–₹12L/km based on boundary perimeter). Satellite imagery is an annual subscription of ₹3L–₹15L/year.",
    equipmentIds: [
      "anpr-camera",
      "rfid-reader",
      "rfid-stickers",
      "boom-barriers",
      "radar-system",
      "local-server",
      "installation-commissioning",
      "wim-system",
      "battery-backup",
      "wim-commissioning",
      "lidar-drone",
      "drone-software",
      "satellite-imagery",
      "electric-fencing",
    ],
    badge: "Full Defense-In-Depth & Aerial Intelligence",
    accentColor: "#8b5cf6",
  },
];

export interface CapabilityComparisonRow {
  capability: string;
  category: string;
  tier1: boolean;
  tier2: boolean;
  tier3: boolean;
  description: string;
}

export const CAPABILITY_COMPARISON: CapabilityComparisonRow[] = [
  {
    capability: "Solar-powered ANPR cameras",
    category: "Gate Sensing",
    tier1: true,
    tier2: true,
    tier3: true,
    description: "High-resolution number plate recognition with mono-PERC solar power & battery operation",
  },
  {
    capability: "Independent 4G connectivity",
    category: "Communications",
    tier1: true,
    tier2: true,
    tier3: true,
    description: "Governing Body cellular SIMs bypassing mine network infrastructure entirely",
  },
  {
    capability: "Cryptographic GB RFID",
    category: "Authentication",
    tier1: true,
    tier2: true,
    tier3: true,
    description: "AES-128 challenge-response reader authentication independent of contractor FASTag",
  },
  {
    capability: "Tamper-evident stickers",
    category: "Authentication",
    tier1: true,
    tier2: true,
    tier3: true,
    description: "Destructive frangible adhesive stickers that tear if transferred between vehicles",
  },
  {
    capability: "Automated entry/exit barriers",
    category: "Physical Control",
    tier1: true,
    tier2: true,
    tier3: true,
    description: "Industrial boom barriers opening solely upon GB cryptographic pass authorization",
  },
  {
    capability: "Radar monitoring",
    category: "Gate Sensing",
    tier1: true,
    tier2: true,
    tier3: true,
    description: "77 GHz 3D radar measuring speed, presence, and truck profile length in dust and rain",
  },
  {
    capability: "GB local server",
    category: "Edge Compute",
    tier1: true,
    tier2: true,
    tier3: true,
    description: "On-site edge server with hash-chained tamper-evident local database and offline resilience",
  },
  {
    capability: "Weigh-In-Motion (WIM)",
    category: "Weight Verification",
    tier1: false,
    tier2: true,
    tier3: true,
    description: "In-pavement dynamic quartz sensors capturing axle loads and estimating gross tonnage",
  },
  {
    capability: "48-hour backup for all electrical equipment",
    category: "Power Resilience",
    tier1: false,
    tier2: true,
    tier3: true,
    description: "Centralized battery bank powering all cameras, barriers, radar, WIM, and servers for 2 full days",
  },
  {
    capability: "LiDAR drone",
    category: "Aerial Intelligence",
    tier1: false,
    tier2: false,
    tier3: true,
    description: "Enterprise drone with laser scanner mapping pit elevation and computing stockpile volumes",
  },
  {
    capability: "Satellite imagery",
    category: "Orbital Oversight",
    tier1: false,
    tier2: false,
    tier3: true,
    description: "Sub-meter commercial satellite tasking observing boundary expansion and off-lease digging",
  },
  {
    capability: "Electric perimeter fencing",
    category: "Perimeter Security",
    tier1: false,
    tier2: false,
    tier3: true,
    description: "Non-lethal pulsed electric perimeter deterrence preventing perimeter breaches outside gates",
  },
];
