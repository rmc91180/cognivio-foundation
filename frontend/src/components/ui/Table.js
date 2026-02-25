import React from "react";
import classNames from "classnames";

export function TableShell({ className, children }) {
  return <div className={classNames("cv-table-wrap", className)}>{children}</div>;
}

export function DataTable({ className, children }) {
  return <table className={classNames("cv-table", className)}>{children}</table>;
}
