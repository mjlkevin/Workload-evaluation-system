import express from "express";

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json());

app.get("/api/v1/health", (_req, res) => {
  res.json({
    code: 0,
    message: "ok",
    data: {
      service: "workload-api",
      status: "up"
    }
  });
});

app.listen(port, () => {
  // Keep startup logs explicit for local bootstrap checks.
  console.log(`[api] listening on http://localhost:${port}`);
});
