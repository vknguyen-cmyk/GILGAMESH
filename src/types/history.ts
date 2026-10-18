export interface PassengerRecord {
  id: string;
  bagId: string;
  passenger: {
    name: string;
    idNumber: string;
    photoUrl: string;
  };
  flight: {
    number: string;
    from: string;
    to: string;
    date: string;
  };
  scan: {
    /** The stored 2D scan: /api/scans/<bag>.jpg once screened, a placeholder before. */
    imageUrl: string;
    caption?: string | null;
  };
  screening: {
    verdict: "clear" | "review" | "threat" | "unscreened";
    action: "cleared" | "held" | null;
    threatLabel: string | null;
    confidence: number | null;
    screenedAt: string | null;
    source?: "lane" | "console" | null;
  };
  /** True for generated demo travelers; the console only sees the X-ray. */
  demo?: boolean;
  createdAt: string;
  updatedAt?: string;
}
