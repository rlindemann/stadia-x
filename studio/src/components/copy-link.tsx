"use client";

import { useState } from "react";

// Copies a shareable URL to the clipboard. Defaults to the current page URL.
export function CopyLink({ href, label = "Copy link" }: { href?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="link-copy"
      onClick={() => {
        const url = href ?? window.location.href;
        navigator.clipboard?.writeText(url.startsWith("http") ? url : window.location.origin + url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Link copied" : label}
    </button>
  );
}
