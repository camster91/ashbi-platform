import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

function hashPassword(password) {
  return bcrypt.hashSync(password, 12)
}

async function createUserOrSkip(email, password, name, role, options = {}) {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return existing
  return prisma.user.create({
    data: {
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

  const admin = await createUserOrSkip(
    'cameron@ashbi.ca', adminPass, 'Cameron', 'ADMIN',
    { hourlyRate: 50, skills: JSON.stringify(['management', 'design', 'development']), capacity: 100 }
  )
  console.log('Created admin:', admin.email)

  const bianca = await createUserOrSkip(
    'bianca@ashbi.ca', adminPass, 'Bianca', 'TEAM',
    { hourlyRate: 50, skills: JSON.stringify(['design', 'ui', 'branding']), capacity: 100 }
  )
  console.log('Created team member:', bianca.email)

  const numan = await createUserOrSkip(
    'numan@ashbi.ca', adminPass, 'Numan', 'CONTRACTOR',
    { hourlyRate: 50, skills: JSON.stringify(['development', 'fullstack']), capacity: 80 }
  )
  console.log('Created contractor:', numan.email)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
