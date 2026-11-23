import type { SVGProps } from "react";

interface IllustrationProps extends SVGProps<SVGSVGElement> {
  type: string;
  className?: string;
}

export function EquipmentIllustration({ type, className = "", ...props }: IllustrationProps) {
  switch (type) {
    case "anpr-camera":
      return (
        <svg viewBox="0 0 400 225" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
          <rect width="400" height="225" fill="#0B1324" />
          <defs>
            <radialGradient id="camGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(240 105) rotate(90) scale(120)">
              <stop stopColor="#1F5EFF" stopOpacity="0.35" />
              <stop offset="1" stopColor="#0B1324" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="solarGrad" x1="80" y1="35" x2="160" y2="75" gradientUnits="userSpaceOnUse">
              <stop stopColor="#1E293B" />
              <stop offset="0.5" stopColor="#0F172A" />
              <stop offset="1" stopColor="#0284C7" />
            </linearGradient>
            <linearGradient id="beamGrad" x1="260" y1="105" x2="390" y2="160" gradientUnits="userSpaceOnUse">
              <stop stopColor="#38BDF8" stopOpacity="0.45" />
              <stop offset="1" stopColor="#38BDF8" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Background Grid Lines */}
          <path d="M20 40H380M20 80H380M20 120H380M20 160H380M20 200H380" stroke="#1E293B" strokeWidth="0.8" strokeDasharray="3 3" />
          <path d="M80 20V210M160 20V210M240 20V210M320 20V210" stroke="#1E293B" strokeWidth="0.8" strokeDasharray="3 3" />

          {/* Glowing field */}
          <circle cx="240" cy="105" r="100" fill="url(#camGlow)" />

          {/* Vertical Pole */}
          <rect x="135" y="70" width="16" height="145" rx="3" fill="#334155" />
          <rect x="138" y="70" width="4" height="145" fill="#64748B" />
          <rect x="125" y="205" width="36" height="10" rx="2" fill="#1E293B" stroke="#475569" strokeWidth="1" />

          {/* Solar Panel & Bracket */}
          <path d="M143 75L110 40" stroke="#64748B" strokeWidth="4" strokeLinecap="round" />
          <g transform="translate(60, 22) rotate(-18 60 20)">
            <rect x="30" y="8" width="95" height="42" rx="4" fill="url(#solarGrad)" stroke="#38BDF8" strokeWidth="1.5" />
            {/* Solar cells */}
            <line x1="53" y1="8" x2="53" y2="50" stroke="#38BDF8" strokeWidth="0.8" opacity="0.7" />
            <line x1="77" y1="8" x2="77" y2="50" stroke="#38BDF8" strokeWidth="0.8" opacity="0.7" />
            <line x1="101" y1="8" x2="101" y2="50" stroke="#38BDF8" strokeWidth="0.8" opacity="0.7" />
            <line x1="30" y1="29" x2="125" y2="29" stroke="#38BDF8" strokeWidth="0.8" opacity="0.7" />
          </g>

          {/* Camera Mounting Arm */}
          <path d="M145 105L195 105" stroke="#64748B" strokeWidth="6" strokeLinecap="round" />
          <circle cx="195" cy="105" r="6" fill="#475569" />

          {/* Camera Body */}
          <rect x="190" y="88" width="72" height="34" rx="6" fill="#1E293B" stroke="#94A3B8" strokeWidth="1.5" />
          <rect x="195" y="93" width="55" height="6" rx="2" fill="#334155" />
          {/* Sunshield */}
          <path d="M185 86H270L264 92H185V86Z" fill="#475569" />

          {/* Lens & IR Ring */}
          <rect x="258" y="92" width="12" height="26" rx="4" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" />
          <circle cx="264" cy="105" r="7" fill="#0284C7" />
          <circle cx="264" cy="105" r="3.5" fill="#38BDF8" />
          {/* IR LEDs */}
          <circle cx="264" cy="95" r="1.5" fill="#EF4444" opacity="0.9" />
          <circle cx="264" cy="115" r="1.5" fill="#EF4444" opacity="0.9" />

          {/* 4G Antenna */}
          <line x1="205" y1="88" x2="205" y2="60" stroke="#E2E8F0" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="205" cy="58" r="2.5" fill="#38BDF8" />
          <path d="M200 54C202 51 208 51 210 54" stroke="#38BDF8" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
          <path d="M196 50C201 45 209 45 214 50" stroke="#38BDF8" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />

          {/* Optical Scan Cone */}
          <polygon points="270,103 385,65 385,155 270,107" fill="url(#beamGrad)" />
          <line x1="270" y1="105" x2="385" y2="65" stroke="#38BDF8" strokeWidth="1" strokeDasharray="3 3" opacity="0.8" />
          <line x1="270" y1="105" x2="385" y2="155" stroke="#38BDF8" strokeWidth="1" strokeDasharray="3 3" opacity="0.8" />

          {/* Simulated Number Plate in FOV */}
          <g transform="translate(320, 95)">
            <rect x="0" y="0" width="60" height="20" rx="3" fill="#FEF08A" stroke="#000" strokeWidth="1.2" />
            <text x="5" y="14" fill="#000" fontSize="9" fontFamily="monospace" fontWeight="bold">OD 09 A 2241</text>
            <circle cx="53" cy="10" r="3" fill="#1F5EFF" opacity="0.7" />
          </g>

          {/* Technical HUD Overlay */}
          <text x="25" y="32" fill="#38BDF8" fontSize="10" fontFamily="monospace" fontWeight="bold">ANPR // OPTICAL ENGINE</text>
          <text x="25" y="47" fill="#64748B" fontSize="8" fontFamily="monospace">SOLAR + DUAL 4G LTE</text>
          <rect x="25" y="195" width="70" height="16" rx="3" fill="#1E293B" stroke="#334155" strokeWidth="1" />
          <text x="32" y="206" fill="#10B981" fontSize="8" fontFamily="monospace">● 100% ONLINE</text>
        </svg>
      );

    case "rfid-reader":
      return (
        <svg viewBox="0 0 400 225" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
          <rect width="400" height="225" fill="#090E17" />
          <defs>
            <radialGradient id="rfidPulse" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(195 110) rotate(90) scale(110)">
              <stop stopColor="#6366F1" stopOpacity="0.4" />
              <stop offset="1" stopColor="#090E17" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Background Grid */}
          <path d="M20 40H380M20 80H380M20 120H380M20 160H380M20 200H380" stroke="#1E293B" strokeWidth="0.8" strokeDasharray="3 3" />
          <circle cx="195" cy="110" r="95" fill="url(#rfidPulse)" />

          {/* RFID Reader Flat Panel Antenna */}
          <rect x="85" y="55" width="110" height="110" rx="10" fill="#1E293B" stroke="#6366F1" strokeWidth="2.5" />
          <rect x="95" y="65" width="90" height="90" rx="6" fill="#0F172A" stroke="#334155" strokeWidth="1.5" />
          <circle cx="140" cy="110" r="28" stroke="#6366F1" strokeWidth="2" strokeDasharray="4 4" />
          <circle cx="140" cy="110" r="14" fill="#312E81" stroke="#818CF8" strokeWidth="2" />
          <circle cx="140" cy="110" r="4" fill="#A5B4FC" />

          {/* Antenna Status LEDs */}
          <circle cx="103" cy="73" r="2.5" fill="#10B981" />
          <circle cx="111" cy="73" r="2.5" fill="#38BDF8" />
          <circle cx="119" cy="73" r="2.5" fill="#6366F1" />

          {/* Emitted Crypto Wavefronts */}
          <path d="M210 75C235 90 235 130 210 145" stroke="#818CF8" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M230 60C265 85 265 135 230 160" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
          <path d="M250 48C295 80 295 140 250 172" stroke="#4F46E5" strokeWidth="1.8" strokeLinecap="round" opacity="0.6" strokeDasharray="5 4" />

          {/* Cryptographic Shield / Chip Node */}
          <g transform="translate(290, 80)">
            <rect x="0" y="0" width="75" height="60" rx="8" fill="#1E1B4B" stroke="#818CF8" strokeWidth="1.5" />
            <text x="10" y="20" fill="#A5B4FC" fontSize="9" fontFamily="monospace" fontWeight="bold">UCODE DNA</text>
            <text x="10" y="34" fill="#38BDF8" fontSize="8" fontFamily="monospace">AES-128</text>
            <text x="10" y="48" fill="#10B981" fontSize="8" fontFamily="monospace">VALID TAG</text>
          </g>

          {/* Interconnecting Data Line */}
          <path d="M140 165V188H260V140H290" stroke="#6366F1" strokeWidth="1.5" strokeDasharray="3 3" />
          <circle cx="290" cy="140" r="3" fill="#6366F1" />

          {/* Technical HUD Overlay */}
          <text x="25" y="32" fill="#818CF8" fontSize="10" fontFamily="monospace" fontWeight="bold">RFID // CRYPTO READER</text>
          <text x="25" y="47" fill="#64748B" fontSize="8" fontFamily="monospace">865-867 MHz UHF · AES-128</text>
        </svg>
      );

    case "rfid-sticker":
      return (
        <svg viewBox="0 0 400 225" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
          <rect width="400" height="225" fill="#0B1321" />
          <defs>
            <linearGradient id="foilGrad" x1="60" y1="50" x2="340" y2="175" gradientUnits="userSpaceOnUse">
              <stop stopColor="#1E293B" />
              <stop offset="0.3" stopColor="#312E81" />
              <stop offset="0.6" stopColor="#0284C7" />
              <stop offset="1" stopColor="#0F172A" />
            </linearGradient>
            <linearGradient id="tamperCut" x1="0" y1="0" x2="1" y2="0">
              <stop stopColor="#EF4444" />
              <stop offset="1" stopColor="#F59E0B" />
            </linearGradient>
          </defs>

          {/* Background Windshield Glass Tint */}
          <rect x="35" y="30" width="330" height="165" rx="12" fill="#0F172A" stroke="#334155" strokeWidth="1" />

          {/* Frangible Sticker Body */}
          <g transform="translate(60, 48)">
            <rect x="0" y="0" width="280" height="130" rx="8" fill="url(#foilGrad)" stroke="#38BDF8" strokeWidth="2" />

            {/* Tamper Frangible Cut Lines (Tears on Peel) */}
            <path d="M30 0L45 130M95 0L110 130M165 0L180 130M235 0L250 130" stroke="#F43F5E" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.65" />
            <path d="M0 40H280M0 90H280" stroke="#F43F5E" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.5" />

            {/* Embedded Microchip & Antenna Loop */}
            <rect x="115" y="42" width="50" height="46" rx="4" fill="#020617" stroke="#F59E0B" strokeWidth="1.8" />
            <circle cx="140" cy="65" r="8" fill="#B45309" stroke="#FCD34D" strokeWidth="1.2" />
            {/* Dipole Antenna Wings */}
            <path d="M115 55H60V75H35" stroke="#38BDF8" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M165 55H220V75H245" stroke="#38BDF8" strokeWidth="2.5" strokeLinecap="round" />

            {/* Holographic Security Text */}
            <text x="15" y="24" fill="#E2E8F0" fontSize="10" fontFamily="sans-serif" fontWeight="bold" letterSpacing="0.1em">GOVERNING BODY · SITEWATCH</text>
            <text x="15" y="115" fill="#38BDF8" fontSize="8" fontFamily="monospace">TID: 0x98A4 · SECURE UCODE DNA</text>
            <text x="180" y="115" fill="#F43F5E" fontSize="7.5" fontFamily="monospace" fontWeight="bold">DO NOT REMOVE</text>
          </g>

          <text x="25" y="24" fill="#38BDF8" fontSize="9" fontFamily="monospace">TAMPER-EVIDENT RFID STICKER</text>
        </svg>
      );

    case "boom-barrier":
      return (
        <svg viewBox="0 0 400 225" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
          <rect width="400" height="225" fill="#0B1323" />
          <defs>
            <linearGradient id="barrierArmGrad" x1="140" y1="85" x2="380" y2="85" gradientUnits="userSpaceOnUse">
              <stop stopColor="#F8FAFC" />
              <stop offset="0.5" stopColor="#EF4444" />
              <stop offset="1" stopColor="#F8FAFC" />
            </linearGradient>
            <linearGradient id="groundLoopGrad" x1="180" y1="180" x2="360" y2="210" gradientUnits="userSpaceOnUse">
              <stop stopColor="#1E293B" stopOpacity="0.8" />
              <stop offset="1" stopColor="#0B1323" stopOpacity="0.1" />
            </linearGradient>
          </defs>

          {/* Road Surface */}
          <rect x="0" y="175" width="400" height="50" fill="#111827" />
          <line x1="0" y1="175" x2="400" y2="175" stroke="#334155" strokeWidth="2" />
          {/* Yellow Road Lane Stripes */}
          <line x1="20" y1="205" x2="90" y2="205" stroke="#EAB308" strokeWidth="3" strokeDasharray="12 8" />
          <line x1="130" y1="205" x2="240" y2="205" stroke="#EAB308" strokeWidth="3" strokeDasharray="12 8" />
          <line x1="280" y1="205" x2="390" y2="205" stroke="#EAB308" strokeWidth="3" strokeDasharray="12 8" />

          {/* Inductive Safety Ground Loop */}
          <polygon points="170,182 340,182 360,215 150,215" fill="url(#groundLoopGrad)" stroke="#38BDF8" strokeWidth="1" strokeDasharray="4 3" />
          <text x="220" y="202" fill="#38BDF8" fontSize="8" fontFamily="monospace" opacity="0.8">INDUCTIVE LOOP</text>

          {/* Barrier Housing Cabinet */}
          <rect x="70" y="70" width="55" height="110" rx="6" fill="#1E293B" stroke="#94A3B8" strokeWidth="2" />
          <rect x="76" y="78" width="43" height="35" rx="3" fill="#0F172A" />
          {/* Status Indicator */}
          <circle cx="97" cy="95" r="7" fill="#EF4444" />
          <circle cx="97" cy="95" r="3" fill="#FCA5A5" />
          <rect x="78" y="125" width="39" height="45" rx="2" fill="#334155" stroke="#475569" strokeWidth="1" />
          <circle cx="85" cy="147" r="2" fill="#F59E0B" />

          {/* Pivot Joint & Motor Hub */}
          <circle cx="118" cy="85" r="14" fill="#334155" stroke="#CBD5E1" strokeWidth="2.5" />
          <circle cx="118" cy="85" r="5" fill="#E2E8F0" />

          {/* Heavy Duty Boom Arm with Chevron Pattern */}
          <g>
            <rect x="126" y="80" width="240" height="10" rx="3" fill="#F8FAFC" stroke="#64748B" strokeWidth="1" />
            {/* Red reflective bands */}
            <polygon points="150,80 162,80 154,90 142,90" fill="#DC2626" />
            <polygon points="180,80 192,80 184,90 172,90" fill="#DC2626" />
            <polygon points="210,80 222,80 214,90 202,90" fill="#DC2626" />
            <polygon points="240,80 252,80 244,90 232,90" fill="#DC2626" />
            <polygon points="270,80 282,80 274,90 262,90" fill="#DC2626" />
            <polygon points="300,80 312,80 304,90 292,90" fill="#DC2626" />
            <polygon points="330,80 342,80 334,90 322,90" fill="#DC2626" />
            {/* LED Strip Light */}
            <line x1="130" y1="78" x2="360" y2="78" stroke="#EF4444" strokeWidth="2" strokeDasharray="6 3" />
          </g>

          {/* Safety Photocells */}
          <rect x="45" y="145" width="10" height="30" rx="2" fill="#334155" stroke="#64748B" strokeWidth="1" />
          <circle cx="50" cy="155" r="3" fill="#EF4444" />
          <line x1="50" y1="155" x2="390" y2="155" stroke="#EF4444" strokeWidth="1" strokeDasharray="5 3" opacity="0.6" />

          <text x="25" y="32" fill="#F59E0B" fontSize="10" fontFamily="monospace" fontWeight="bold">BOOM BARRIER // DUAL SAFETY LOOP</text>
          <text x="25" y="47" fill="#64748B" fontSize="8" fontFamily="monospace">GB SYSTEM INTERLOCKED</text>
        </svg>
      );

    case "radar-system":
      return (
        <svg viewBox="0 0 400 225" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
          <rect width="400" height="225" fill="#070D18" />
          <defs>
            <radialGradient id="radarScan" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(100 112) rotate(45) scale(260)">
              <stop stopColor="#10B981" stopOpacity="0.4" />
              <stop offset="0.6" stopColor="#059669" stopOpacity="0.1" />
              <stop offset="1" stopColor="#070D18" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Radar Radar Cone Array */}
          <path d="M100 112L360 30C390 80 390 150 360 195L100 112Z" fill="url(#radarScan)" />
          <path d="M100 112L360 30" stroke="#10B981" strokeWidth="1.2" strokeDasharray="4 4" />
          <path d="M100 112L360 195" stroke="#10B981" strokeWidth="1.2" strokeDasharray="4 4" />
          {/* Range rings */}
          <path d="M160 85C175 98 175 125 160 140" stroke="#10B981" strokeWidth="1.5" opacity="0.8" />
          <path d="M230 65C255 85 255 140 230 160" stroke="#10B981" strokeWidth="1.2" opacity="0.6" />
          <path d="M300 45C335 75 335 150 300 180" stroke="#10B981" strokeWidth="1" opacity="0.4" />

          {/* 3D Detection Target Matrix (Truck profile) */}
          <g transform="translate(250, 85)">
            <rect x="0" y="0" width="85" height="45" rx="4" fill="#064E3B" stroke="#34D399" strokeWidth="1.5" />
            <text x="8" y="16" fill="#A7F3D0" fontSize="8" fontFamily="monospace" fontWeight="bold">TARGET ACQUIRED</text>
            <text x="8" y="28" fill="#FCD34D" fontSize="8" fontFamily="monospace">L: 8.42m · W: 2.50m</text>
            <text x="8" y="40" fill="#38BDF8" fontSize="8" fontFamily="monospace">SPEED: 14.2 km/h</text>
          </g>

          {/* Radar Sensor Pod */}
          <g transform="translate(60, 75)">
            <rect x="0" y="0" width="45" height="75" rx="8" fill="#1E293B" stroke="#10B981" strokeWidth="2" />
            <rect x="6" y="8" width="33" height="58" rx="4" fill="#0F172A" />
            <circle cx="22" cy="25" r="9" fill="#065F46" stroke="#34D399" strokeWidth="1.5" />
            <circle cx="22" cy="25" r="3" fill="#6EE7B7" />
            <rect x="10" y="45" width="25" height="15" rx="2" fill="#111827" stroke="#334155" strokeWidth="1" />
          </g>

          <text x="25" y="32" fill="#34D399" fontSize="10" fontFamily="monospace" fontWeight="bold">FMCW RADAR // 77-81 GHz</text>
          <text x="25" y="47" fill="#64748B" fontSize="8" fontFamily="monospace">3D DIMENSION + VELOCITY TRACKING</text>
        </svg>
      );

    case "local-server":
      return (
        <svg viewBox="0 0 400 225" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
          <rect width="400" height="225" fill="#0A0F1D" />
          {/* Ruggedized Server Cabinet Frame */}
          <rect x="100" y="35" width="200" height="155" rx="8" fill="#111827" stroke="#38BDF8" strokeWidth="2" />
          <rect x="110" y="45" width="180" height="135" rx="4" fill="#030712" />

          {/* 1U Management Switch */}
          <g transform="translate(118, 52)">
            <rect x="0" y="0" width="164" height="20" rx="3" fill="#1E293B" stroke="#475569" strokeWidth="1" />
            <circle cx="10" cy="10" r="3" fill="#10B981" />
            {/* RJ45 Ports */}
            {[25, 38, 51, 64, 77, 90, 103, 116, 129, 142].map((px) => (
              <rect key={px} x={px} y="5" width="8" height="10" rx="1" fill="#0F172A" stroke="#38BDF8" strokeWidth="0.8" />
            ))}
          </g>

          {/* 2U Primary Edge Server */}
          <g transform="translate(118, 78)">
            <rect x="0" y="0" width="164" height="38" rx="3" fill="#1E293B" stroke="#38BDF8" strokeWidth="1.5" />
            {/* Hot-swap Drive Caddies */}
            {[8, 28, 48, 68].map((dx) => (
              <g key={dx}>
                <rect x={dx} y="6" width="16" height="26" rx="2" fill="#0F172A" stroke="#64748B" strokeWidth="0.8" />
                <circle cx={dx + 8} cy="10" r="1.5" fill="#10B981" />
                <circle cx={dx + 8} cy="15" r="1.5" fill="#38BDF8" />
              </g>
            ))}
            <text x="96" y="20" fill="#E2E8F0" fontSize="8" fontFamily="monospace" fontWeight="bold">GB EDGE RACK</text>
            <text x="96" y="30" fill="#34D399" fontSize="7" fontFamily="monospace">POSTGRESQL // HASH-CHAIN</text>
          </g>

          {/* 2U UPS / Smart Power Backup Unit */}
          <g transform="translate(118, 122)">
            <rect x="0" y="0" width="164" height="32" rx="3" fill="#1E293B" stroke="#F59E0B" strokeWidth="1" />
            <rect x="10" y="8" width="40" height="16" rx="2" fill="#0F172A" stroke="#FCD34D" strokeWidth="0.8" />
            <text x="14" y="20" fill="#FCD34D" fontSize="8" fontFamily="monospace">230V OK</text>
            <circle cx="65" cy="16" r="3" fill="#10B981" />
            <circle cx="75" cy="16" r="3" fill="#10B981" />
            <text x="90" y="20" fill="#94A3B8" fontSize="8" fontFamily="monospace">SMART UPS</text>
          </g>

          {/* Tamper Hardware Lock Badge */}
          <circle cx="280" cy="165" r="8" fill="#1E293B" stroke="#10B981" strokeWidth="1.5" />
          <path d="M277 165V163C277 161 278 160 280 160C282 160 283 161 283 163V165M276 165H284V169H276V165Z" stroke="#10B981" strokeWidth="1" fill="none" />

          <text x="25" y="30" fill="#38BDF8" fontSize="10" fontFamily="monospace" fontWeight="bold">LOCAL SERVER // EDGE STACK</text>
          <text x="25" y="45" fill="#64748B" fontSize="8" fontFamily="monospace">DELL/HPE · AUTONOMOUS OFFLINE MODE</text>
        </svg>
      );

    case "installation-commissioning":
    case "wim-commissioning":
      return (
        <svg viewBox="0 0 400 225" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
          <rect width="400" height="225" fill="#0F172A" />
          {/* Engineering Blueprint Background Grid */}
          <path d="M20 40H380M20 80H380M20 120H380M20 160H380M20 200H380" stroke="#1E293B" strokeWidth="0.8" />
          <path d="M50 20V210M100 20V210M150 20V210M200 20V210M250 20V210M300 20V210M350 20V210" stroke="#1E293B" strokeWidth="0.8" />

          {/* Gantry & Enclosure Schematic */}
          <rect x="80" y="60" width="70" height="95" rx="6" fill="#1E293B" stroke="#38BDF8" strokeWidth="2" strokeDasharray="4 2" />
          <circle cx="115" cy="85" r="14" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" />
          <path d="M115 75V95M105 85H125" stroke="#38BDF8" strokeWidth="1.5" />
          <rect x="95" y="115" width="40" height="25" rx="3" fill="#334155" />

          {/* Calibration Checklist Graphic */}
          <g transform="translate(190, 55)">
            <rect x="0" y="0" width="160" height="115" rx="6" fill="#1E293B" stroke="#10B981" strokeWidth="1.5" />
            <text x="14" y="24" fill="#34D399" fontSize="9" fontFamily="monospace" fontWeight="bold">COMMISSIONING PROTOCOL</text>
            <path d="M14 42L20 48L32 36" stroke="#10B981" strokeWidth="2" strokeLinecap="round" />
            <text x="38" y="44" fill="#E2E8F0" fontSize="8" fontFamily="sans-serif">Pole Civil &amp; Cabling</text>
            <path d="M14 66L20 72L32 60" stroke="#10B981" strokeWidth="2" strokeLinecap="round" />
            <text x="38" y="68" fill="#E2E8F0" fontSize="8" fontFamily="sans-serif">Earthing &amp; Surge SPDs</text>
            <path d="M14 90L20 96L32 84" stroke="#10B981" strokeWidth="2" strokeLinecap="round" />
            <text x="38" y="92" fill="#E2E8F0" fontSize="8" fontFamily="sans-serif">Dynamic Calibration Sign-Off</text>
          </g>

          <text x="25" y="32" fill="#38BDF8" fontSize="10" fontFamily="monospace" fontWeight="bold">INSTALLATION &amp; FIELD COMMISSIONING</text>
          <text x="25" y="47" fill="#64748B" fontSize="8" fontFamily="monospace">TURN-KEY SITE INTEGRATION</text>
        </svg>
      );

    case "wim-system":
      return (
        <svg viewBox="0 0 400 225" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
          <rect width="400" height="225" fill="#080F1A" />
          {/* Pavement Cross-Section */}
          <rect x="0" y="140" width="400" height="85" fill="#1E293B" />
          <rect x="0" y="130" width="400" height="15" fill="#334155" />

          {/* Embedded Dual Quartz Sensor Strips */}
          <rect x="120" y="128" width="18" height="18" fill="#0284C7" stroke="#38BDF8" strokeWidth="2" />
          <rect x="220" y="128" width="18" height="18" fill="#0284C7" stroke="#38BDF8" strokeWidth="2" />
          <line x1="129" y1="146" x2="129" y2="190" stroke="#38BDF8" strokeWidth="1.5" strokeDasharray="3 3" />
          <line x1="229" y1="146" x2="229" y2="190" stroke="#38BDF8" strokeWidth="1.5" strokeDasharray="3 3" />
          <path d="M129 190H280V170H310" stroke="#38BDF8" strokeWidth="1.5" />

          {/* Dynamic Axle Load Pressure Waves */}
          <ellipse cx="129" cy="115" r="28" rx="28" ry="12" fill="#0284C7" fillOpacity="0.25" />
          <ellipse cx="129" cy="100" r="38" rx="38" ry="18" stroke="#38BDF8" strokeWidth="1.5" strokeDasharray="4 3" />

          {/* Heavy Truck Wheel Profile */}
          <g transform="translate(95, 35)">
            <rect x="20" y="10" width="28" height="70" rx="10" fill="#0F172A" stroke="#94A3B8" strokeWidth="2" />
            <circle cx="34" cy="45" r="8" fill="#475569" stroke="#CBD5E1" strokeWidth="1.5" />
            {/* Downward force vector arrow */}
            <path d="M34 50V90M30 84L34 92L38 84" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" />
            <text x="44" y="75" fill="#EF4444" fontSize="9" fontFamily="monospace" fontWeight="bold">LOAD: 12.4 t</text>
          </g>

          {/* High Speed DAQ Controller Box */}
          <g transform="translate(310, 140)">
            <rect x="0" y="0" width="70" height="55" rx="5" fill="#0F172A" stroke="#10B981" strokeWidth="1.8" />
            <text x="8" y="16" fill="#34D399" fontSize="8" fontFamily="monospace" fontWeight="bold">WIM DAQ</text>
            <text x="8" y="28" fill="#E2E8F0" fontSize="7" fontFamily="monospace">OIML R134</text>
            <text x="8" y="42" fill="#38BDF8" fontSize="8" fontFamily="monospace">GVW: 38.6 t</text>
          </g>

          <text x="25" y="32" fill="#38BDF8" fontSize="10" fontFamily="monospace" fontWeight="bold">WEIGH-IN-MOTION // QUARTZ SENSOR ARRAY</text>
          <text x="25" y="47" fill="#64748B" fontSize="8" fontFamily="monospace">DYNAMIC AXLE WEIGHT &amp; SPEED MEASUREMENT</text>
        </svg>
      );

    case "battery-backup":
      return (
        <svg viewBox="0 0 400 225" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
          <rect width="400" height="225" fill="#0C1322" />
          <defs>
            <linearGradient id="batterySoc" x1="0" y1="0" x2="1" y2="0">
              <stop stopColor="#10B981" />
              <stop offset="1" stopColor="#34D399" />
            </linearGradient>
          </defs>

          {/* High Capacity Battery Bank Enclosure */}
          <rect x="75" y="40" width="140" height="155" rx="8" fill="#1E293B" stroke="#10B981" strokeWidth="2" />
          {/* Battery Modular Drawers (48V LiFePO4 / VRLA) */}
          {[52, 80, 108, 136, 164].map((by) => (
            <g key={by} transform={`translate(85, ${by})`}>
              <rect x="0" y="0" width="120" height="22" rx="3" fill="#0F172A" stroke="#334155" strokeWidth="1" />
              <circle cx="10" cy="11" r="3" fill="#10B981" />
              <rect x="25" y="6" width="70" height="10" rx="2" fill="#064E3B" />
              <rect x="25" y="6" width="62" height="10" rx="2" fill="url(#batterySoc)" />
              <text x="100" y="14" fill="#6EE7B7" fontSize="7" fontFamily="monospace">100%</text>
            </g>
          ))}

          {/* Industrial Inverter & PDB Cabinet */}
          <g transform="translate(235, 40)">
            <rect x="0" y="0" width="105" height="155" rx="8" fill="#1E293B" stroke="#38BDF8" strokeWidth="2" />
            {/* Digital Display */}
            <rect x="12" y="14" width="81" height="35" rx="4" fill="#030712" stroke="#475569" strokeWidth="1" />
            <text x="18" y="28" fill="#38BDF8" fontSize="8" fontFamily="monospace" fontWeight="bold">AUTONOMY: 48h</text>
            <text x="18" y="40" fill="#10B981" fontSize="8" fontFamily="monospace">LOAD: 1.8 kW</text>

            {/* Heavy Switchgear Breakers */}
            <rect x="12" y="60" width="81" height="75" rx="4" fill="#0F172A" />
            <line x1="25" y1="70" x2="25" y2="100" stroke="#E2E8F0" strokeWidth="3" strokeLinecap="round" />
            <line x1="45" y1="70" x2="45" y2="100" stroke="#E2E8F0" strokeWidth="3" strokeLinecap="round" />
            <line x1="65" y1="70" x2="65" y2="100" stroke="#E2E8F0" strokeWidth="3" strokeLinecap="round" />
            <line x1="85" y1="70" x2="85" y2="100" stroke="#E2E8F0" strokeWidth="3" strokeLinecap="round" />
            <text x="20" y="124" fill="#F59E0B" fontSize="8" fontFamily="monospace">ONLINE UPS</text>
          </g>

          <text x="25" y="26" fill="#10B981" fontSize="10" fontFamily="monospace" fontWeight="bold">POWER RESILIENCE // 48-HOUR AUTONOMY</text>
        </svg>
      );

    case "lidar-drone":
      return (
        <svg viewBox="0 0 400 225" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
          <rect width="400" height="225" fill="#070C16" />
          <defs>
            <radialGradient id="lidarScanCone" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(200 85) rotate(90) scale(140 180)">
              <stop stopColor="#8B5CF6" stopOpacity="0.45" />
              <stop offset="0.6" stopColor="#8B5CF6" stopOpacity="0.1" />
              <stop offset="1" stopColor="#070C16" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Laser Scanning Cone Downward */}
          <polygon points="200,85 50,215 350,215" fill="url(#lidarScanCone)" />
          <line x1="200" y1="85" x2="50" y2="215" stroke="#A78BFA" strokeWidth="1" strokeDasharray="4 3" />
          <line x1="200" y1="85" x2="350" y2="215" stroke="#A78BFA" strokeWidth="1" strokeDasharray="4 3" />
          {/* Laser Return Points / 3D Contour lines */}
          <path d="M70 190Q140 170 200 185T330 180" stroke="#C4B5FD" strokeWidth="1.5" strokeDasharray="2 3" opacity="0.8" />
          <path d="M90 205Q160 190 200 200T310 198" stroke="#8B5CF6" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.6" />

          {/* Drone Platform (DJI Enterprise style) */}
          <g transform="translate(145, 30)">
            {/* Rotor Arms */}
            <line x1="10" y1="20" x2="100" y2="20" stroke="#475569" strokeWidth="4" strokeLinecap="round" />
            <line x1="20" y1="35" x2="90" y2="5" stroke="#334155" strokeWidth="4" strokeLinecap="round" />

            {/* Rotors with spinning motion blur */}
            <ellipse cx="10" cy="20" rx="22" ry="5" fill="#64748B" fillOpacity="0.3" stroke="#94A3B8" strokeWidth="1" />
            <ellipse cx="100" cy="20" rx="22" ry="5" fill="#64748B" fillOpacity="0.3" stroke="#94A3B8" strokeWidth="1" />

            {/* Drone Fuselage */}
            <rect x="35" y="10" width="40" height="25" rx="6" fill="#1E293B" stroke="#94A3B8" strokeWidth="1.8" />
            <circle cx="55" cy="20" r="5" fill="#0F172A" />
            <circle cx="55" cy="20" r="2" fill="#38BDF8" />

            {/* RTK Antenna Stems */}
            <line x1="42" y1="10" x2="42" y2="0" stroke="#CBD5E1" strokeWidth="2" />
            <circle cx="42" cy="0" r="2" fill="#10B981" />
            <line x1="68" y1="10" x2="68" y2="0" stroke="#CBD5E1" strokeWidth="2" />
            <circle cx="68" cy="0" r="2" fill="#10B981" />

            {/* LiDAR Gimbal Sensor */}
            <g transform="translate(45, 35)">
              <rect x="5" y="0" width="10" height="8" rx="2" fill="#475569" />
              <circle cx="10" cy="14" r="9" fill="#1E1B4B" stroke="#8B5CF6" strokeWidth="2" />
              <circle cx="10" cy="14" r="4" fill="#C4B5FD" />
            </g>
          </g>

          <text x="25" y="32" fill="#A78BFA" fontSize="10" fontFamily="monospace" fontWeight="bold">UAV DRONE // AERIAL LiDAR</text>
          <text x="25" y="47" fill="#64748B" fontSize="8" fontFamily="monospace">3D TERRAIN SCANNING &amp; STOCKPILE VOLUMES</text>
        </svg>
      );

    case "drone-software":
      return (
        <svg viewBox="0 0 400 225" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
          <rect width="400" height="225" fill="#0C101F" />
          {/* Workstation Display Screen */}
          <rect x="40" y="30" width="320" height="165" rx="8" fill="#111827" stroke="#8B5CF6" strokeWidth="2" />
          <rect x="48" y="38" width="304" height="149" rx="4" fill="#020617" />

          {/* 3D Pit Mesh Wireframe & Elevation Heatmap */}
          <g transform="translate(65, 55)">
            {/* Contour bands */}
            <path d="M10 90C40 60 120 50 180 85C210 100 240 80 260 90" stroke="#EF4444" strokeWidth="1.5" fill="none" />
            <path d="M20 75C50 45 130 35 190 70C220 85 240 70 255 75" stroke="#F59E0B" strokeWidth="1.5" fill="none" />
            <path d="M30 60C60 30 140 20 200 55C230 70 240 55 250 60" stroke="#10B981" strokeWidth="1.5" fill="none" />
            <path d="M40 45C70 15 150 10 210 40C235 52 245 42 248 45" stroke="#38BDF8" strokeWidth="1.5" fill="none" />

            {/* Cut-and-Fill Computation Box */}
            <rect x="150" y="10" width="115" height="50" rx="4" fill="#1E293B" stroke="#8B5CF6" strokeWidth="1" />
            <text x="160" y="24" fill="#C4B5FD" fontSize="8" fontFamily="monospace" fontWeight="bold">SURVEY VOLUMETRICS</text>
            <text x="160" y="36" fill="#F87171" fontSize="7.5" fontFamily="monospace">CUT: 42,180 m³</text>
            <text x="160" y="48" fill="#34D399" fontSize="7.5" fontFamily="monospace">TONNES: 105,450 t</text>
          </g>

          <text x="25" y="24" fill="#8B5CF6" fontSize="9" fontFamily="monospace">PHOTOGRAMMETRY &amp; 3D SURVEY SUITE</text>
        </svg>
      );

    case "satellite-imagery":
      return (
        <svg viewBox="0 0 400 225" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
          <rect width="400" height="225" fill="#040814" />
          <defs>
            <radialGradient id="earthCurvature" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(200 350) scale(260)">
              <stop stopColor="#0369A1" stopOpacity="0.4" />
              <stop offset="0.7" stopColor="#082F49" stopOpacity="0.15" />
              <stop offset="1" stopColor="#040814" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Earth Horizon Curvature */}
          <circle cx="200" cy="350" r="240" fill="url(#earthCurvature)" stroke="#0284C7" strokeWidth="1" />

          {/* Lease Boundary Polygon on Earth Surface */}
          <polygon points="150,165 240,155 260,195 170,205" fill="#0369A1" fillOpacity="0.3" stroke="#38BDF8" strokeWidth="1.5" strokeDasharray="3 2" />
          {/* Off-lease unauthorized pit alert */}
          <polygon points="275,170 310,162 315,185 285,190" fill="#EF4444" fillOpacity="0.4" stroke="#F43F5E" strokeWidth="1.8" />
          <text x="270" y="155" fill="#F87171" fontSize="8" fontFamily="monospace" fontWeight="bold">OFF-LEASE PIT</text>

          {/* Orbital Satellite */}
          <g transform="translate(140, 25)">
            {/* Solar Arrays (Left & Right) */}
            <rect x="0" y="15" width="40" height="22" rx="2" fill="#0369A1" stroke="#38BDF8" strokeWidth="1" />
            <rect x="80" y="15" width="40" height="22" rx="2" fill="#0369A1" stroke="#38BDF8" strokeWidth="1" />

            {/* Satellite Body & Optical Telescope */}
            <rect x="42" y="10" width="36" height="32" rx="4" fill="#CBD5E1" stroke="#94A3B8" strokeWidth="1.5" />
            <circle cx="60" cy="26" r="6" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" />
            <path d="M54 42L60 52L66 42" fill="#64748B" />

            {/* Observation Ray to Earth */}
            <polygon points="60,52 140,165 270,165" fill="#38BDF8" fillOpacity="0.08" />
            <line x1="60" y1="52" x2="140" y2="165" stroke="#38BDF8" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            <line x1="60" y1="52" x2="270" y2="165" stroke="#38BDF8" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
          </g>

          <text x="25" y="32" fill="#38BDF8" fontSize="10" fontFamily="monospace" fontWeight="bold">ORBITAL SATELLITE // SITE MONITORING</text>
          <text x="25" y="47" fill="#64748B" fontSize="8" fontFamily="monospace">30-50cm OPTICAL RESOLUTION · BOUNDARY SURVEILLANCE</text>
        </svg>
      );

    case "electric-fencing":
      return (
        <svg viewBox="0 0 400 225" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
          <rect width="400" height="225" fill="#0B1321" />
          {/* Ground Terrain */}
          <rect x="0" y="170" width="400" height="55" fill="#1E293B" />
          <line x1="0" y1="170" x2="400" y2="170" stroke="#334155" strokeWidth="2" />

          {/* Steel Fence Posts & Droppers */}
          {[60, 150, 240, 330].map((px) => (
            <g key={px}>
              <line x1={px} y1="60" x2={px} y2="185" stroke="#64748B" strokeWidth="4" strokeLinecap="round" />
              {/* Insulators */}
              {[75, 95, 115, 135, 155].map((iy) => (
                <circle key={iy} cx={px} cy={iy} r="4" fill="#0F172A" stroke="#F59E0B" strokeWidth="1.5" />
              ))}
            </g>
          ))}

          {/* High-Tensile Pulsed Wires */}
          {[75, 95, 115, 135, 155].map((wy, idx) => (
            <g key={wy}>
              <line x1="20" y1={wy} x2="380" y2={wy} stroke="#CBD5E1" strokeWidth="1.5" />
              {/* Electric pulse spark on some wires */}
              {idx % 2 === 0 && (
                <path d={`M190 ${wy - 6}L200 ${wy}L195 ${wy}L205 ${wy + 6}`} stroke="#FCD34D" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </g>
          ))}

          {/* Energizer Control Enclosure */}
          <g transform="translate(20, 95)">
            <rect x="0" y="0" width="32" height="48" rx="4" fill="#1E293B" stroke="#F59E0B" strokeWidth="1.5" />
            <circle cx="16" cy="15" r="4" fill="#EF4444" />
            <rect x="8" y="28" width="16" height="12" rx="1" fill="#0F172A" />
          </g>

          {/* Bilingual Warning Signage */}
          <g transform="translate(175, 90)">
            <rect x="0" y="0" width="50" height="35" rx="3" fill="#FEF08A" stroke="#000" strokeWidth="1.5" />
            <path d="M25 8L15 26H35L25 8Z" fill="#DC2626" />
            <text x="25" y="23" fill="#FFF" fontSize="8" fontWeight="bold" textAnchor="middle">⚡</text>
            <text x="25" y="32" fill="#000" fontSize="5.5" fontFamily="sans-serif" fontWeight="bold" textAnchor="middle">DANGER 48V</text>
          </g>

          <text x="25" y="32" fill="#F59E0B" fontSize="10" fontFamily="monospace" fontWeight="bold">PERIMETER SECURITY // PULSED ELECTRIC FENCE</text>
          <text x="25" y="47" fill="#64748B" fontSize="8" fontFamily="monospace">NON-LETHAL · IS 302 / IEC 60335-2-76 COMPLIANT</text>
        </svg>
      );

    default:
      return (
        <svg viewBox="0 0 400 225" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
          <rect width="400" height="225" fill="#0F172A" />
          <circle cx="200" cy="112" r="50" fill="#1E293B" stroke="#38BDF8" strokeWidth="2" />
          <text x="200" y="117" fill="#E2E8F0" fontSize="12" fontFamily="sans-serif" textAnchor="middle">HARDWARE</text>
        </svg>
      );
  }
}
