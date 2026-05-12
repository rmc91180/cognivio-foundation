import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const TOUR_STEPS = [
  { selector: "[data-tour='dashboard']", route: "/dashboard", title: "Your command center", description: "All teachers' progress at a glance.", position: "bottom" },
  { selector: "[data-tour='plan-observation']", route: "/observation/new", title: "Plan observation", description: "Start here to plan your next classroom visit.", position: "bottom" },
  { selector: "[data-tour='teachers']", route: "/teachers", title: "Teachers page", description: "Your full roster with performance tracking.", position: "right" },
  { selector: "[data-tour='coaching']", route: "/coaching", title: "Coaching hub", description: "Manage all coaching actions in one place.", position: "right" },
  { selector: "[data-tour='recognition']", route: "/recognition-review", title: "Recognition", description: "Recognize exceptional teaching when you see it.", position: "left" },
];

export function ProductTourOverlay() {
  const navigate = useNavigate();
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (localStorage.getItem("cognivio-tour-pending") === "1") {
      setActive(true);
      localStorage.removeItem("cognivio-tour-pending");
    }
  }, []);

  if (!active) return null;
  const step = TOUR_STEPS[index];

  const next = () => {
    if (index >= TOUR_STEPS.length - 1) {
      localStorage.setItem("cognivio-tour-complete", "1");
      setActive(false);
      return;
    }
    const nextIndex = index + 1;
    setIndex(nextIndex);
    navigate(TOUR_STEPS[nextIndex].route);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/40">
      <div className="absolute bottom-6 left-1/2 w-[min(92vw,420px)] -translate-x-1/2 rounded-xl border border-teal-200 bg-white p-5 shadow-2xl">
        <div className="text-xs font-semibold uppercase tracking-wide text-teal-700">
          Tour stop {index + 1} of {TOUR_STEPS.length}
        </div>
        <h2 className="mt-2 text-lg font-semibold text-slate-950">{step.title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{step.description}</p>
        <div className="mt-5 flex justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              localStorage.setItem("cognivio-tour-complete", "1");
              setActive(false);
            }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Skip
          </button>
          <button type="button" onClick={next} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">
            {index >= TOUR_STEPS.length - 1 ? "Finish tour" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
