import { RequestHandler } from "express";

export const downloadFile: RequestHandler = (_req, res) => {
  res.status(501).json({ error: "not implemented" });
};

export const history: RequestHandler = (_req, res) => {
  res.status(501).json({ error: "not implemented" });
};
