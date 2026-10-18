/** Demo passenger + luggage records for the booth. */

export const SEED_RECORDS = [
  {
    id: "R-1001",
    bagId: "B-1842",
    passenger: {
      name: "Alex Rivera",
      idNumber: "P-482910",
      photoUrl: "/history/avatars/alex.svg",
    },
    flight: {
      number: "VN 650",
      from: "SGN",
      to: "ICN",
      date: "2026-10-18",
    },
    scan: {
      imageUrl: "/history/scans/B-1842.svg",
      view: "top",
      caption: "Cabin roller · dual-energy top view",
    },
    screening: {
      verdict: "threat",
      action: null,
      threatLabel: "gun",
      confidence: 0.997,
      screenedAt: null,
    },
    createdAt: "2026-10-18T01:00:00.000Z",
  },
  {
    id: "R-1002",
    bagId: "B-1904",
    passenger: {
      name: "Jordan Lee",
      idNumber: "P-771204",
      photoUrl: "/history/avatars/jordan.svg",
    },
    flight: {
      number: "KE 456",
      from: "ICN",
      to: "NRT",
      date: "2026-10-18",
    },
    scan: {
      imageUrl: "/history/scans/B-1904.svg",
      view: "top",
      caption: "Backpack · clear scan",
    },
    screening: {
      verdict: "clear",
      action: null,
      threatLabel: null,
      confidence: null,
      screenedAt: null,
    },
    createdAt: "2026-10-18T01:05:00.000Z",
  },
  {
    id: "R-1003",
    bagId: "B-1766",
    passenger: {
      name: "Sam Okonkwo",
      idNumber: "P-339881",
      photoUrl: "/history/avatars/sam.svg",
    },
    flight: {
      number: "JL 12",
      from: "NRT",
      to: "LAX",
      date: "2026-10-18",
    },
    scan: {
      imageUrl: "/history/scans/B-1766.svg",
      view: "top",
      caption: "Duffel · knife flagged",
    },
    screening: {
      verdict: "threat",
      action: null,
      threatLabel: "knife",
      confidence: 0.941,
      screenedAt: null,
    },
    createdAt: "2026-10-18T01:10:00.000Z",
  },
  {
    id: "R-1004",
    bagId: "B-2031",
    passenger: {
      name: "Morgan Chen",
      idNumber: "P-905512",
      photoUrl: "/history/avatars/morgan.svg",
    },
    flight: {
      number: "UA 870",
      from: "LAX",
      to: "SFO",
      date: "2026-10-18",
    },
    scan: {
      imageUrl: "/history/scans/B-2031.svg",
      view: "top",
      caption: "Tote · clear scan",
    },
    screening: {
      verdict: "clear",
      action: null,
      threatLabel: null,
      confidence: null,
      screenedAt: null,
    },
    createdAt: "2026-10-18T01:15:00.000Z",
  },
  {
    id: "R-1005",
    bagId: "B-2110",
    passenger: {
      name: "Riley Santos",
      idNumber: "P-228447",
      photoUrl: "/history/avatars/riley.svg",
    },
    flight: {
      number: "SQ 31",
      from: "SIN",
      to: "SGN",
      date: "2026-10-18",
    },
    scan: {
      imageUrl: "/history/scans/B-2110.svg",
      view: "top",
      caption: "Hard shell · firearm component",
    },
    screening: {
      verdict: "threat",
      action: null,
      threatLabel: "firearm component",
      confidence: 0.918,
      screenedAt: null,
    },
    createdAt: "2026-10-18T01:20:00.000Z",
  },
  {
    id: "R-1006",
    bagId: "B-1888",
    passenger: {
      name: "Casey Nguyen",
      idNumber: "P-614003",
      photoUrl: "/history/avatars/casey.svg",
    },
    flight: {
      number: "QH 204",
      from: "HAN",
      to: "SGN",
      date: "2026-10-18",
    },
    scan: {
      imageUrl: "/history/scans/B-1888.svg",
      view: "top",
      caption: "Backpack · clear scan",
    },
    screening: {
      verdict: "clear",
      action: null,
      threatLabel: null,
      confidence: null,
      screenedAt: null,
    },
    createdAt: "2026-10-18T01:25:00.000Z",
  },
];
