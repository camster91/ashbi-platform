import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
const prisma = new PrismaClient();
const hash = crypto.createHash("sha256").update("Ashbi2026!").digest("hex");
const existing = await prisma.user.findUnique({ where: { email: "bianca@ashbi.ca" } });
if (existing) {
  console.log("Bianca already exists");
} else {
  const user = await prisma.user.create({
    data: { email: "bianca@ashbi.ca", password: hash, name: "Bianca", role: "TEAM" }
  });
  console.log("Created:", user.email, user.role);
}
await prisma.$disconnect();
