import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://localhost:3456";
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET || "";

async function proxyRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { error: { message: "Unauthorized" } },
      { status: 401 }
    );
  }

  const { path } = await params;
  const targetPath = `/api/admin/${path.join("/")}`;
  const url = new URL(targetPath, INTERNAL_API_URL);

  // Forward query params
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  const body = request.method !== "GET" && request.method !== "HEAD"
    ? await request.text()
    : undefined;

  const res = await fetch(url.toString(), {
    method: request.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_API_SECRET}`,
    },
    body,
    cache: "no-store",
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const DELETE = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
