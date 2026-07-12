"use client";

import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type Props = {
  fileUrl: string;
  pageNumber: number;
  onPageChange: (updater: (p: number) => number) => void;
};

export default function PdfPane({ fileUrl, pageNumber, onPageChange }: Props) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [width, setWidth] = useState(600);
  const [pageInput, setPageInput] = useState(String(pageNumber));
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => setNumPages(null), [fileUrl]);
  useEffect(() => setPageInput(String(pageNumber)), [pageNumber]);

  useEffect(() => {
    const measure = () => {
      if (paneRef.current) setWidth(paneRef.current.clientWidth - 32);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  function commitPage() {
    const n = parseInt(pageInput, 10);
    if (Number.isNaN(n)) {
      setPageInput(String(pageNumber));
      return;
    }
    const clamped = Math.min(Math.max(1, n), numPages ?? n);
    onPageChange(() => clamped);
  }

  return (
    <div className="rv-pdf" ref={paneRef}>
      <div className="rv-pdf-bar">
        <button className="rv-nav" onClick={() => onPageChange((p) => Math.max(1, p - 1))}>
          ‹
        </button>
        <span className="rv-pageno">
          Page
          <input
            className="rv-pageinput"
            value={pageInput}
            inputMode="numeric"
            aria-label="Page number"
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitPage();
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={commitPage}
          />
          {numPages ? `/ ${numPages}` : ""}
        </span>
        <button className="rv-nav" onClick={() => onPageChange((p) => Math.min(numPages ?? p, p + 1))}>
          ›
        </button>
      </div>
      <div className="rv-pdf-scroll">
        <Document
          file={fileUrl}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          loading={<div className="rv-pdf-msg">Loading PDF…</div>}
          error={<div className="rv-pdf-msg">Could not load PDF.</div>}
        >
          <Page pageNumber={pageNumber} width={width} renderAnnotationLayer={false} />
        </Document>
      </div>
    </div>
  );
}
