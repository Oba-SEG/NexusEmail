"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
}

/** Copy-to-clipboard with inline "Copied" feedback — no dialogs, no
 * extra chrome. Falls back to a hidden textarea for non-secure contexts. */
export default function CopyButton({ value, label, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      try {
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      } finally {
        document.body.removeChild(ta);
      }
    }
    if (ok) {
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setFailed(true);
      setTimeout(() => setFailed(false), 2000);
    }
  };

  const btn = (
    <button
      type="button"
      onClick={copy}
      aria-label={failed ? "Copy failed" : copied ? "Copied" : `Copy ${label || "value"}`}
      className={
        className ||
        "inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200 transition-colors flex-shrink-0 cursor-pointer"
      }
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {failed ? "Copy failed" : copied ? "Copied" : label ? label : ""}
    </button>
  );
  // polite announcement without moving focus (button label change alone
  // is not reliably announced)
  return (
    <span className="inline-flex items-center gap-1">
      {btn}
      <span role="status" className="sr-only">{failed ? "Copy failed" : copied ? "Copied to clipboard" : ""}</span>
    </span>
  );
}
