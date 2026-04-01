async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  function norm(s) { return (s||"").toLowerCase().replace(/[^a-z]/g,""); }
  const clients = await prisma.client.findMany({ include: { retainerPlan: true, _count: { select: { projects: true, invoices: true, contacts: true } } } });
  const nameMap = {};
  clients.forEach(c => { const n = norm(c.name); if(!nameMap[n]) nameMap[n]=[]; nameMap[n].push(c); });
  const dups = Object.entries(nameMap).filter(([,cs]) => cs.length > 1);
  console.log("Found " + dups.length + " duplicate pairs");

  let archived=0, plansDeleted=0, plansMoved=0;
  for (const [, clist] of dups) {
    clist.sort((a,b) => {
      const sa=(a._count.projects||0)+(a._count.invoices||0)+(a.retainerPlan?10:0);
      const sb=(b._count.projects||0)+(b._count.invoices||0)+(b.retainerPlan?10:0);
      return sb-sa;
    });
    const primary=clist[0], dupe=clist[1];
    console.log("\n== " + primary.name + " vs " + dupe.name);
    console.log("PRIMARY proj=" + primary._count.projects + " inv=" + primary._count.invoices + " plan=" + !!primary.retainerPlan);
    console.log("DUPE     proj=" + dupe._count.projects + " inv=" + dupe._count.invoices + " plan=" + !!dupe.retainerPlan);
    if(dupe.retainerPlan && !primary.retainerPlan) {
      console.log("MOVE plan dupe->primary");
      await prisma.retainerPlan.update({ where: { id: dupe.retainerPlan.id }, data: { clientId: primary.id } });
      plansMoved++;
    } else if(dupe.retainerPlan && primary.retainerPlan) {
      console.log("DELETE dupe plan");
      await prisma.retainerPlan.delete({ where: { id: dupe.retainerPlan.id } });
      plansDeleted++;
    }
    await prisma.client.update({ where: { id: dupe.id }, data: { status: "ARCHIVED", name: dupe.name + " (archived-dupe)" } });
    archived++;
    console.log("ARCHIVED " + dupe.id.slice(-8));
  }

  console.log("\n== SUMMARY ==");
  console.log("Archived=" + archived + " DeletedPlans=" + plansDeleted + " MovedPlans=" + plansMoved);
  const fin = await prisma.retainerPlan.findMany({ where: { retainerStatus: "ACTIVE" }, include: { client: { select: { name: true } } } });
  const total = fin.reduce((s,x) => s+(x.monthlyAmountUsd||0)+(x.monthlyAmountCad||0), 0);
  console.log("FinalPlans=" + fin.length + " MRR=" + total);
  fin.forEach(x => console.log("  " + (x.client?.name||"?") + " USD=" + (x.monthlyAmountUsd||0) + " CAD=" + (x.monthlyAmountCad||0)));
  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR: " + e.message); process.exit(1); });
