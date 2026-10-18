import type { PassengerRecord } from "../types/history";
import { photoSrc, scanImageSrc } from "../lib/historyApi";

interface PassengerCardProps {
  record: PassengerRecord;
  compact?: boolean;
}

export function PassengerCard({ record, compact = false }: PassengerCardProps) {
  const { passenger, flight, screening } = record;
  return (
    <article className={`passenger-card ${compact ? "compact" : ""}`}>
      <div className="passenger-top">
        <img src={photoSrc(record)} alt="" className="passenger-photo" />
        <div>
          <h3>{passenger.name}</h3>
          <p>
            ID {passenger.idNumber}
            {record.demo ? " · demo identity" : ""}
          </p>
        </div>
        <span className={`passenger-badge ${screening.verdict}`}>
          {screening.action
            ? screening.action === "cleared"
              ? "Cleared"
              : "Held"
            : screening.verdict === "threat"
              ? "Threat"
              : screening.verdict === "review"
                ? "Review"
                : screening.verdict === "clear"
                  ? "Clear"
                  : "Pending"}
        </span>
      </div>
      <div className="passenger-flight">
        <div>
          <span className="label">Flight</span>
          <strong>{flight.number}</strong>
        </div>
        <div>
          <span className="label">Route</span>
          <strong>
            {flight.from} → {flight.to}
          </strong>
        </div>
        <div>
          <span className="label">Date</span>
          <strong>{flight.date}</strong>
        </div>
      </div>
      {!compact && (
        <div className="passenger-scan">
          <img src={scanImageSrc(record)} alt={`Scan for ${record.bagId}`} />
          <p>{record.scan.caption || record.bagId}</p>
        </div>
      )}
    </article>
  );
}
