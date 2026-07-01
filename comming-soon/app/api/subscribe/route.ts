export async function POST(req: Request) {
  try {
    const { email } = await req.json();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Invalid email address" }, { status: 400 });
    }

    const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;

    if (!webhookUrl) {
      return Response.json({ error: "Server not configured" }, { status: 500 });
    }

    const body = JSON.stringify({ email, timestamp: new Date().toISOString() });

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("Webhook error:", res.status, text);
      return Response.json({ error: "Failed to save email" }, { status: 502 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("Subscribe error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
