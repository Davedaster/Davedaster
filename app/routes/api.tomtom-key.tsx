import { json } from "@remix-run/node";

export const loader = async () => json({ apiKey: process.env.TOMTOM_API_KEY || "" });
