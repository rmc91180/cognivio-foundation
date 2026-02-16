import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const DOMAIN_COLORS = [
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#0f766e",
  "#be123c",
  "#9333ea",
  "#4f46e5",
];

function formatScore(value) {
  return typeof value === "number" ? value.toFixed(2) : "—";
}

export function DomainTrendsChart({
  chartData,
  domains,
  selectedTeacherId,
  selectedTeacherName,
  isLoading,
}) {
  if (isLoading) {
    return (
      <div className="h-72 rounded-md bg-slate-50">
        <div className="flex h-full items-center justify-center text-xs text-slate-500">
          Loading domain trend data...
        </div>
      </div>
    );
  }

  if (!chartData.length || !domains.length) {
    return (
      <div className="h-72 rounded-md bg-slate-50">
        <div className="flex h-full items-center justify-center text-xs text-slate-500">
          No trend data for the selected filters.
        </div>
      </div>
    );
  }

  const comparisonEnabled = Boolean(selectedTeacherId);

  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 12, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="label" stroke="#64748b" />
          <YAxis stroke="#64748b" domain={[0, 10]} />
          <Tooltip
            formatter={(value) => formatScore(value)}
            contentStyle={{
              backgroundColor: "#ffffff",
              borderColor: "#e2e8f0",
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />

          <Line
            type="monotone"
            dataKey="overall_all"
            name="All teachers overall"
            stroke="#0f172a"
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls
          />

          {comparisonEnabled && (
            <Line
              type="monotone"
              dataKey="overall_teacher"
              name={`${selectedTeacherName || "Selected teacher"} overall`}
              stroke="#334155"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={{ r: 2 }}
              connectNulls
            />
          )}

          {domains.map((domain, index) => {
            const color = DOMAIN_COLORS[index % DOMAIN_COLORS.length];
            return (
              <Line
                key={`all_${domain.id}`}
                type="monotone"
                dataKey={`all_${domain.id}`}
                name={comparisonEnabled ? `${domain.name} (All)` : domain.name}
                stroke={color}
                strokeWidth={comparisonEnabled ? 1.5 : 2}
                strokeDasharray={comparisonEnabled ? "4 3" : undefined}
                dot={{ r: 1.5 }}
                connectNulls
              />
            );
          })}

          {comparisonEnabled &&
            domains.map((domain, index) => {
              const color = DOMAIN_COLORS[index % DOMAIN_COLORS.length];
              return (
                <Line
                  key={`teacher_${domain.id}`}
                  type="monotone"
                  dataKey={`teacher_${domain.id}`}
                  name={`${domain.name} (${selectedTeacherName || "Selected"})`}
                  stroke={color}
                  strokeWidth={2.5}
                  dot={{ r: 2 }}
                  connectNulls
                />
              );
            })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
