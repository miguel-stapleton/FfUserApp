import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function upsertBackofficeUser() {
  const email = process.env.BACKOFFICE_EMAIL
  const password = process.env.BACKOFFICE_PASSWORD

  if (!email || !password) {
    throw new Error('BACKOFFICE_EMAIL and BACKOFFICE_PASSWORD environment variables are required')
  }

  console.log(`Upserting backoffice user: ${email}`)

  // Hash the password
  const passwordHash = await bcrypt.hash(password, 12)

  // Generate username from email (part before @)
  const username = email.split('@')[0]

  // Upsert the user
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: 'BACKOFFICE',
    },
    create: {
      email,
      username,
      passwordHash,
      role: 'BACKOFFICE',
    },
  })

  console.log(`✅ Backoffice user upserted:`)
  console.log(`   ID: ${user.id}`)
  console.log(`   Email: ${user.email}`)
  console.log(`   Username: ${user.username}`)
  console.log(`   Role: ${user.role}`)

  return user
}

async function main() {
  try {
    await upsertBackofficeUser()
    console.log('\n🎉 Seed completed successfully!')
    console.log('\n📋 Login Instructions:')
    console.log(`   1. Go to /login`)
    console.log(`   2. Use email: ${process.env.BACKOFFICE_EMAIL}`)
    console.log(`   3. Use password: ${process.env.BACKOFFICE_PASSWORD}`)
    console.log(`   4. You'll be redirected to /(backoffice)/proposals`)
  } catch (error) {
    console.error('❌ Error during seeding:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the seed function if this file is executed directly
if (require.main === module) {
  main()
}

export { upsertBackofficeUser }
