import React from "react";
import classNames from "classnames";

export function Panel({
  as: Component = "section",
  className,
  padded = true,
  children,
  ...props
}) {
  return (
    <Component className={classNames("cv-panel", padded && "p-5", className)} {...props}>
      {children}
    </Component>
  );
}
