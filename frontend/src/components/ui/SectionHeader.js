export function SectionHeader({
  title,
  description,
  eyebrow = null,
  tags = [],
  actions = null,
  className = "",
}) {
  return (
    <div className={["flex flex-wrap items-start justify-between gap-3", className].join(" ").trim()}>
      <div className="max-w-3xl">
        {eyebrow || tags.length ? (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {eyebrow ? (
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                {eyebrow}
              </span>
            ) : null}
            {tags.map((tag) => (
              <span
                key={`${title}-${tag}`}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description ? <p className="mt-1 text-xs text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div>{actions}</div> : null}
    </div>
  );
}
