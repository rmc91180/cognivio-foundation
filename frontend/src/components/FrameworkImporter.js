import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button, Field, Panel, Select } from "@/components/ui";
import { frameworkApi } from "@/lib/api";

function parsePreview(file, text) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".json")) {
    const payload = JSON.parse(text);
    const domains = payload.domains || payload.rubric || [];
    return {
      name: payload.name || payload.title || file.name,
      domains: domains.map((domain) => ({
        name: domain.name || domain.domain || "Untitled domain",
        elements: (domain.elements || []).map((element) =>
          typeof element === "string" ? element : element.name || element.element
        ).filter(Boolean),
      })),
    };
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = (lines.shift() || "").split(",").map((item) => item.trim().toLowerCase());
  const domainIndex = headers.findIndex((header) => ["domain", "category", "standard"].includes(header));
  const elementIndex = headers.findIndex((header) => ["element", "indicator", "competency"].includes(header));
  const grouped = {};
  lines.forEach((line) => {
    const cells = line.split(",").map((item) => item.trim());
    const domain = cells[domainIndex] || "Competency";
    const element = cells[elementIndex] || "";
    if (!element) return;
    grouped[domain] = grouped[domain] || [];
    grouped[domain].push(element);
  });
  return {
    name: file.name.replace(/\.[^.]+$/, ""),
    domains: Object.entries(grouped).map(([name, elements]) => ({ name, elements })),
  };
}

export function FrameworkImporter() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [standardKey, setStandardKey] = useState("program_custom");

  const { data: standardsRes } = useQuery({
    queryKey: ["framework-standards"],
    queryFn: () => frameworkApi.standards().then((res) => res.data),
  });

  const importMutation = useMutation({
    mutationFn: () => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("standard_key", standardKey);
      return frameworkApi.importFramework(formData);
    },
    onSuccess: () => {
      toast.success("Training competency framework imported.");
      queryClient.invalidateQueries({ queryKey: ["frameworks"] });
      queryClient.invalidateQueries({ queryKey: ["framework-selection"] });
      setFile(null);
      setPreview(null);
    },
    onError: (error) => {
      toast.error(error?.response?.data?.detail || "Could not import framework.");
    },
  });

  const standards = standardsRes?.standards || [];
  const summary = useMemo(() => {
    const domains = preview?.domains || [];
    return {
      domains: domains.length,
      elements: domains.reduce((sum, domain) => sum + (domain.elements?.length || 0), 0),
    };
  }, [preview]);

  const onFileChange = (event) => {
    const selected = event.target.files?.[0] || null;
    setFile(selected);
    setPreview(null);
    if (!selected) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setPreview(parsePreview(selected, String(reader.result || "")));
      } catch {
        toast.error("Could not preview this framework file.");
      }
    };
    reader.readAsText(selected);
  };

  return (
    <Panel className="border border-slate-200 bg-white">
      <div className="flex items-center gap-2">
        <div className="rounded-md bg-teal-50 p-2 text-teal-700">
          <FileUp className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-950">Import competency framework</h2>
          <p className="text-xs text-slate-500">Upload CSV or JSON, preview domains, then save as a training competency framework.</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Standard mapping">
          <Select value={standardKey} onChange={(event) => setStandardKey(event.target.value)}>
            {standards.map((standard) => (
              <option key={standard.key} value={standard.key}>
                {standard.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="CSV or JSON file">
          <input
            type="file"
            accept=".csv,.json,application/json,text/csv"
            onChange={onFileChange}
            className="block w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          />
        </Field>
      </div>

      {preview ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-950">{preview.name}</div>
              <div className="mt-1 text-xs text-slate-500">
                {summary.domains} domains, {summary.elements} competencies
              </div>
            </div>
            <Button
              type="button"
              onClick={() => importMutation.mutate()}
              disabled={!file || importMutation.isPending}
              className="gap-2"
            >
              <UploadCloud className="h-4 w-4" />
              Confirm import
            </Button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {preview.domains.slice(0, 4).map((domain) => (
              <div key={domain.name} className="rounded-md bg-white px-3 py-3 text-sm">
                <div className="font-semibold text-slate-900">{domain.name}</div>
                <div className="mt-2 text-xs text-slate-500">
                  {(domain.elements || []).slice(0, 3).join(", ")}
                  {(domain.elements || []).length > 3 ? "..." : ""}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
