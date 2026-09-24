import prismaPkg from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcrypt'

const { PrismaClient } = prismaPkg
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
})

function hashPassword(password) {
  return bcrypt.hashSync(password, 12)
}

async function createUserOrSkip(organizationId, email, password, name, role, options = {}) {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return existing
  return prisma.user.create({
    data: {
      organizationId,
      email,
      name,
      password: hashPassword(password),
      role,
      ...options
    }
  })
}

async function main() {
  console.log('Seeding database...')

  const adminPass = process.env.ADMIN_SEED_PASSWORD
  if (!adminPass) {
    console.error('❌ ADMIN_SEED_PASSWORD env var is required. Set a strong password and run again.')
    process.exit(1)
  }

  // Users require an organization. Use the same default organization that
  // local login assigns to ownerless accounts (src/auth/providers/local.provider.js).
  const organization = await prisma.organization.upsert({
    where: { slug: 'ashbi-agency' },
    create: { name: 'Ashbi Agency', slug: 'ashbi-agency' },
    update: {}
  })

  const admin = await createUserOrSkip(
    organization.id, 'cameron@ashbi.ca', adminPass, 'Cameron', 'ADMIN',
    { hourlyRate: 50, skills: JSON.stringify(['management', 'design', 'development']), capacity: 100 }
  )
  console.log('Created admin:', admin.email)

  const bianca = await createUserOrSkip(
    organization.id, 'bianca@ashbi.ca', adminPass, 'Bianca', 'TEAM',
    { hourlyRate: 50, skills: JSON.stringify(['design', 'ui', 'branding']), capacity: 100 }
  )
  console.log('Created team member:', bianca.email)

  const numan = await createUserOrSkip(
    organization.id, 'numan@ashbi.ca', adminPass, 'Numan', 'CONTRACTOR',
    { hourlyRate: 50, skills: JSON.stringify(['development', 'fullstack']), capacity: 80 }
  )
  console.log('Created contractor:', numan.email)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
