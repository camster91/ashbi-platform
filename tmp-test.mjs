(async()=>{
  const {PrismaClient} = await import("@prisma/client");
  const p = new PrismaClient();
  const c = await p.client.count();
  console.log("clients:", c);
  await p.$disconnect();
})().catch(e=>{ console.error("ERR:"+e.message); process.exit(1); });
