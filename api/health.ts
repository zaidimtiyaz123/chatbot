export default function handler(_req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json({
    status: "ok",
    environment: "vercel",
    timestamp: new Date().toISOString(),
  });
}
