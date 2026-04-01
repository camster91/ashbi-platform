(async()=>{
  const {PrismaClient} = await import("@prisma/client");
  const p = new PrismaClient();

  const merges = [
    { keep: "Specialty Rice Inc", archive: "Specialty Rice" },
    { keep: "Mom Water", archive: "Sloane Taylor (Mom Water)" },
  ];

  let archived = 0;
  for (const {keep, archive} of merges) {
    const keeper = await p.client.findFirst({ where: { name: keep }, include: { retainerPlan: true, _count: { select: { projects: true, invoices: true } } } });
    const archiver = await p.client.findFirst({ where: { name: archive }, include: { retainerPlan: true, _count: { select: { projects: true, invoices: true } } } });
    if (!keeper || !archiver) { console.log("SKIP:", keep, archive, keeper?"":"no-keep", archiver?"":"no-archive"); continue; }
    console.log("Merging:", archive, "->", keep);
    console.log("  Keeper:", keeper.name, "id:", keeper.id.slice(-8), "proj:", keeper._count.projects, "inv:", keeper._count.invoices, "plan:", !!keeper.retainerPlan);
    console.log("  Archiver:", archiver.name, "id:", archiver.id.slice(-8), "proj:", archiver._count.projects, "inv:", archiver._count.invoices, "plan:", !!archiver.retainerPlan);
    // Transfer any projects/invoices from archiver to keeper
    await p.project.updateMany({ where: { clientId: archiver.id }, data: { clientId: keeper.id } });
    await p.invoice.updateMany({ where: { clientId: archiver.id }, data: { clientId: keeper.id } });
    // If archiver has plan but keeper doesn't, move it
    if (archiver.retainerPlan && !keeper.retainerPlan) {
      await p.retainerPlan.update({ where: { id: archiver.retainerPlan.id }, data: { clientId: keeper.id } });
      console.log("  Moved plan");
    } else if (archiver.retainerPlan) {
      await p.retainerPlan.delete({ where: { id: archiver.retainerPlan.id } });
      console.log("  Deleted duplicate plan");
    }
    await p.client.update({ where: { id: archiver.id }, data: { status: "ARCHIVED", name: archiver.name + " (archived-merged)" } });
    archived++;
    console.log("  Archived");
  }

  const fin = await p.retainerPlan.findMany({ where: { retainerStatus: "ACTIVE" }, include: { client: { select: { name: true } } } });
  const total = fin.reduce((s,x) => s+(x.monthlyAmountUsd||0)+(x.monthlyAmountCad||0), 0);
  console.log("\nFinal Plans:", fin.length, "| MRR:", total);
  fin.forEach(x => console.log("  " + (x.client?.name||"?") + " USD:" + (x.monthlyAmountUsd||0) + " CAD:" + (x.monthlyAmountCad||0)));
  await p.$disconnect();
})().catch(e=>{ console.error("ERR:"+e.message); process.exit(1); });
