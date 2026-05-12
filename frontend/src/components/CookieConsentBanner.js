import React, { useEffect, useState } from "react";

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("cognivio-cookie-consent")) setVisible(true);
  }, []);

  if (!visible) return null;
  const decide = (value) => {
    localStorage.setItem("cognivio-cookie-consent", value);
    setVisible(false);
  };

  return (
    <div className="fixed bottom-4 left-1/2 z-[80] w-[min(92vw,720px)] -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-900">Cookie preferences</div>
          <div className="text-sm text-slate-600">
            Cognivio uses functional cookies for login, language, and workspace preferences. See the cookie policy for details.
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => decide("rejected")} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Reject</button>
          <button type="button" onClick={() => decide("accepted")} className="rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white">Accept</button>
        </div>
      </div>
    </div>
  );
}
