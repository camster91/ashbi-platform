import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
const prisma = new PrismaClient();
const hash = crypto.createHash("sha256").update("Ashbi2026!").digest("hex");
const count = await prisma.user.count();
if (count > 0) {
  console.log("Users already exist:", count);
} else {
  const user = await prisma.user.create({
    data: { email: "cameron@ashbi.ca", password: hash, name: "Cameron", role: "ADMIN" }
  });
  console.log("Admin created:", user.email, user.role);
}
await prisma.$disconnect();
