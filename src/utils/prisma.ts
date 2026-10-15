import { PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "../config/database";

const databaseUrl = getDatabaseUrl();
const prisma = new PrismaClient(databaseUrl ? { datasourceUrl: databaseUrl } : undefined);
export default prisma;
