import { NextRequest, NextResponse } from "next/server";
import { alertedRecently, checkAlerts, logAudit } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scheduled alert check (Vercel Cron hits this on a schedule; see vercel.json). For each
// NEW alert (deduped against the last 30m), record it and push to ALERT_WEBHOOK_URL if set.
// Protected by CRON_SECRET when configured (Vercel Cron sends it as a Bearer token).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const alerts = await checkAlerts(30);
  const fired: string[] = [];
  for (const a of alerts) {
    if (await alertedRecently(a.kind, 30)) continue;
    await logAudit({ action: "alert", target: a.kind, status: "fired", meta: a.meta });
    const url = process.env.ALERT_WEBHOOK_URL;
    if (url) {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: `⚠ stadia-x alert: ${a.message}` }),
      }).catch(() => {});
    }
    fired.push(a.kind);
  }
  return NextResponse.json({ checked: alerts.length, fired, webhook: !!process.env.ALERT_WEBHOOK_URL });
}
