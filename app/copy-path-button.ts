"use client";

import { createElement, useEffect, useState } from "react";

export function CopyPathButton({
  path,
  label = "Copy path",
}: {
  path: string;
  label?: string;
}) {
  const [copySignal, setCopySignal] = useState(0);
  const copied = copySignal > 0;

  useEffect(() => {
    if (!copied) return;
    const resetTimeout = setTimeout(() => setCopySignal(0), 1500);
    return () => clearTimeout(resetTimeout);
  }, [copied, copySignal]);

  async function copyPath(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    try {
      if (!navigator.clipboard?.writeText) return;
      await navigator.clipboard.writeText(path);
      setCopySignal((signal) => signal + 1);
    } catch {
      // Clipboard access can be unavailable or denied. Leave the button unchanged.
    }
  }

  return createElement(
    "button",
    {
      className: `copy-path-button${copied ? " is-copied" : ""}`,
      onClick: copyPath,
      type: "button",
    },
    copied ? "Copied" : label,
  );
}
