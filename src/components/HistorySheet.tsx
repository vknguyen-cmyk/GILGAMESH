import { useEffect, useState } from "react";
import type { PassengerRecord } from "../types/history";
import { fetchRecords, resetRecords, scanImageSrc } from "../lib/historyApi";
import { PassengerCard } from "./PassengerCard";

interface HistorySheetProps {
  open: boolean;
  onClose: () => void;
  refreshKey: number;
}

export function HistorySheet({ open, onClose, refreshKey }: HistorySheetProps) {
  const [records, setRecords] = useState<PassengerRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchRecords()
      .then((list) => {
        if (cancelled) return;
        setRecords(list);
        setSelectedId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, refreshKey]);

  if (!open) return null;

  const selected = records.find((entry) => entry.id === selectedId) ?? null;

  return (
    <div className="sheet history-sheet" role="dialog" aria-label="Luggage history">
      <div className="sheet-panel history-panel">
        <aside className="history-list">
          <div className="rail-head">
            <h2>History</h2>
            <button type="button" className="texty" onClick={onClose}>
              Done
            </button>
          </div>
          <p className="muted pad">Passenger, flight, and stored 2D scan for each bag.</p>
          {loading && <p className="muted pad">Loading…</p>}
          {error && (
            <div className="pad">
              <p className="note">{error}</p>
              <p className="muted">Start the API with npm run dev (it boots the history server).</p>
            </div>
          )}
          <ul className="history-rows">
            {records.map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  className={selectedId === record.id ? "on" : ""}
                  onClick={() => setSelectedId(record.id)}
                >
                  <img src={record.passenger.photoUrl} alt="" />
                  <span>
                    <b>{record.passenger.name}</b>
                    <em>
                      {record.bagId} · {record.flight.number}
                    </em>
                  </span>
                  <i className={`dot-status ${record.screening.action || record.screening.verdict}`} />
                </button>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void resetRecords().then(() => fetchRecords().then(setRecords));
              }}
            >
              Reset Demo History
            </button>
          </div>
        </aside>
        <section className="history-detail">
          {selected ? (
            <>
              <PassengerCard record={selected} />
              <div className="history-scan-large">
                <img src={scanImageSrc(selected)} alt={`Stored scan ${selected.bagId}`} />
              </div>
              <dl className="history-meta">
                <div>
                  <dt>Bag</dt>
                  <dd>{selected.bagId}</dd>
                </div>
                <div>
                  <dt>Record</dt>
                  <dd>{selected.id}</dd>
                </div>
                <div>
                  <dt>Threat</dt>
                  <dd>
                    {selected.screening.threatLabel
                      ? `${selected.screening.threatLabel}${
                          selected.screening.confidence != null
                            ? ` · ${selected.screening.confidence.toFixed(3)}`
                            : ""
                        }`
                      : "None"}
                  </dd>
                </div>
                <div>
                  <dt>Screened</dt>
                  <dd>
                    {selected.screening.screenedAt
                      ? new Date(selected.screening.screenedAt).toLocaleString()
                      : "Not yet"}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <div className="empty">
              <h2>No records yet</h2>
              <p>Screen a bag to store passenger and scan history.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
