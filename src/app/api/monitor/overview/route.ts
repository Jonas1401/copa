import { NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin/auth";
import { garantirTabelas } from "@/lib/estado";
import { firebaseConfigurado } from "@/lib/firebase";
import { resumoMonitor } from "@/lib/monitor";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await exigirAdmin();
  if (admin instanceof NextResponse) return admin;
  await garantirTabelas();
  return NextResponse.json({ ...(await resumoMonitor()), firebaseConfigurado: firebaseConfigurado() },
    { headers: { "Cache-Control": "private, no-store" } });
}
