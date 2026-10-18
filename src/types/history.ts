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
    imageUrl: string;
    view: string;
    caption?: string;
    dataUrl?: string | null;
  };
  screening: {
    verdict: "clear" | "review" | "threat" | "unscreened";
    action: "cleared" | "held" | null;
    threatLabel: string | null;
    confidence: number | null;
    screenedAt: string | null;
  };
  createdAt: string;
}
