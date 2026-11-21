import React, { useState, useEffect } from "react";
import { X, CheckCircle2 } from "lucide-react";
import { PAVILIONS } from "../data/sanctuaryData.js";

export function BookingModal({ open, defaultPavilion, onClose }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pavilion, setPavilion] = useState(
    defaultPavilion || `${PAVILIONS[0].titleLine1} ${PAVILIONS[0].titleLine2}`
  );
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (defaultPavilion) setPavilion(defaultPavilion);
  }, [defaultPavilion]);

  if (!open) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSubmitted(true);
  };

  const resetAndClose = () => {
    setSubmitted(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#17233b]/65 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-title"
    >
      <div className="w-full max-w-lg rounded-2xl bg-[#f3f3ec] text-[#17233b] p-7 sm:p-10 shadow-2xl border border-[#17233b]/10 relative">
        <button
          type="button"
          onClick={resetAndClose}
          aria-label="Close booking dialog"
          className="absolute top-6 right-6 p-2 rounded-full hover:bg-[#17233b]/10 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {submitted ? (
          <div className="py-8 text-center space-y-5">
            <CheckCircle2 className="w-12 h-12 text-[#340c24] mx-auto" />
            <p className="font-micro text-[10px] tracking-[0.26em] text-[#340c24]">
              INQUIRY RECEIVED
            </p>
            <h3 className="font-display text-4xl">
              Thank you, {name.trim()}.
            </h3>
            <p className="text-sm text-[#17233b]/75 max-w-sm mx-auto leading-relaxed">
              Our Kyoto gallery advisor has noted your interest in{" "}
              <span className="font-medium text-[#17233b]">{pavilion}</span> and
              prepared the private floorplan dossier for{" "}
              <span className="font-medium text-[#17233b]">{email}</span>.
            </p>
            <button
              type="button"
              onClick={resetAndClose}
              className="mt-4 rounded-full bg-[#340c24] text-[#f3f3ec] px-8 py-3 font-micro text-[10px] tracking-[0.22em] hover:bg-[#17233b] transition-colors cursor-pointer"
            >
              RETURN TO SANCTUARY
            </button>
          </div>
        ) : (
          <>
            <p className="font-micro text-[10px] tracking-[0.26em] text-[#340c24]">
              PRIVATE CONSULTATION
            </p>
            <h3 id="booking-title" className="font-display text-4xl sm:text-5xl mt-1">
              Schedule a Viewing
            </h3>
            <p className="text-xs text-[#17233b]/70 mt-2">
              In-person Kyoto gallery tours and live architectural walkthroughs.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block font-micro text-[9px] tracking-[0.22em] mb-1.5">
                  FULL NAME *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Kenji Takahashi"
                  className="w-full rounded-lg border border-[#17233b]/20 bg-white/80 px-4 py-2.5 text-sm focus:outline-none focus:border-[#340c24]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-micro text-[9px] tracking-[0.22em] mb-1.5">
                    EMAIL ADDRESS *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full rounded-lg border border-[#17233b]/20 bg-white/80 px-4 py-2.5 text-sm focus:outline-none focus:border-[#340c24]"
                  />
                </div>
                <div>
                  <label className="block font-micro text-[9px] tracking-[0.22em] mb-1.5">
                    PREFERRED DATE
                  </label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-lg border border-[#17233b]/20 bg-white/80 px-4 py-2.5 text-sm focus:outline-none focus:border-[#340c24]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-micro text-[9px] tracking-[0.22em] mb-1.5">
                  PAVILION TYPOLOGY
                </label>
                <select
                  value={pavilion}
                  onChange={(e) => setPavilion(e.target.value)}
                  className="w-full rounded-lg border border-[#17233b]/20 bg-white/80 px-4 py-2.5 text-sm focus:outline-none focus:border-[#340c24]"
                >
                  {PAVILIONS.map((p) => {
                    const label = `${p.titleLine1} ${p.titleLine2}`;
                    return (
                      <option key={p.id} value={label}>
                        {label} ({p.area})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block font-micro text-[9px] tracking-[0.22em] mb-1.5">
                  NOTES (OPTIONAL)
                </label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Share preferred language, relocation timing, or bespoke upgrade questions…"
                  className="w-full rounded-lg border border-[#17233b]/20 bg-white/80 px-4 py-2.5 text-sm focus:outline-none focus:border-[#340c24]"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-full bg-[#340c24] text-[#f3f3ec] py-3.5 font-micro text-[10px] font-semibold tracking-[0.24em] hover:bg-[#17233b] transition-colors cursor-pointer"
              >
                CONFIRM PRIVATE CONSULTATION
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
