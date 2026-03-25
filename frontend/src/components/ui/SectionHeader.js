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
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            {eyebrow ? <span>{eyebrow}</span> : null}
            {eyebrow && tags.length ? <span className="text-slate-300">/</span> : null}
            {tags.map((tag, index) => (
              <span key={`${title}-${tag}`} className="contents">
                <span>{tag}</span>
                {index < tags.length - 1 ? (
                  <span className="text-slate-300">/</span>
                ) : null}
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
