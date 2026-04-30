import React from "react";
import {
  Bar,
  BarChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const COLORS = {
  teacher: "#0f766e",
  student: "#2563eb",
  silence: "#94a3b8",
};

function pct(value) {
  const numeric = Number(value || 0);
  return `${Math.round(numeric)}%`;
}

function secondsLabel(value) {
  const numeric = Math.max(0, Number(value || 0));
  if (numeric < 60) return `${Math.round(numeric)}s`;
  const minutes = Math.floor(numeric / 60);
  const seconds = Math.round(numeric % 60);
  return `${minutes}m ${seconds}s`;
}

function SegmentLabel({ x, y, width, height, value }) {
  if (!value || width < 34) return null;
  return (
    <text
      x={x + width / 2}
      y={y + height / 2}
      fill="#ffffff"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={700}
    >
      {pct(value)}
    </text>
  );
}

export function TalkTimeChart({
  teacherTalkPct = 0,
  studentTalkPct = 0,
  silencePct = 0,
  teacherTalkSeconds = 0,
  studentTalkSeconds = 0,
  totalDurationSeconds = 0,
  compact = false,
}) {
  const teacher = Math.max(0, Number(teacherTalkPct || 0));
  const student = Math.max(0, Number(studentTalkPct || 0));
  const silence = Math.max(0, Number(silencePct || 0));
  const data = [{ name: "Talk time", teacher, student, silence }];
  const hasData = teacher + student + silence > 0;

  if (!hasData) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
        Audio talk-time data is not available yet.
      </div>
    );
  }

  return (
    <div className="text-xs text-slate-700">
      <div className={compact ? "h-16" : "h-20"}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 8, right: 0, bottom: 8, left: 0 }}
          >
            <XAxis type="number" hide domain={[0, 100]} />
            <YAxis type="category" dataKey="name" hide />
            <Tooltip
              formatter={(value, name) => [pct(value), name]}
              cursor={false}
            />
            <Bar dataKey="teacher" stackId="talk" fill={COLORS.teacher} radius={[6, 0, 0, 6]}>
              <LabelList dataKey="teacher" content={<SegmentLabel />} />
            </Bar>
            <Bar dataKey="student" stackId="talk" fill={COLORS.student}>
              <LabelList dataKey="student" content={<SegmentLabel />} />
            </Bar>
            <Bar dataKey="silence" stackId="talk" fill={COLORS.silence} radius={[0, 6, 6, 0]}>
              <LabelList dataKey="silence" content={<SegmentLabel />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <div>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-teal-700" />
          Teacher {pct(teacher)}
        </div>
        <div>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-blue-600" />
          Student {pct(student)}
        </div>
        <div>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-slate-400" />
          Silence {pct(silence)}
        </div>
      </div>
      <div className="mt-2 text-[11px] text-slate-500">
        Inquiry-based learning target: 40% teacher / 60% student
      </div>
      <div className="mt-1 text-[11px] text-slate-500">
        Teacher {secondsLabel(teacherTalkSeconds)} · Student {secondsLabel(studentTalkSeconds)} · Total{" "}
        {secondsLabel(totalDurationSeconds)}
      </div>
    </div>
  );
}

export default TalkTimeChart;
