const bcrypt = require('bcryptjs');
const User = require('../models/User');
const AIMemory = require('../models/AIMemory');

async function seedAdmin() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@contentbot.local';
    const existing = await User.findOne({ email: adminEmail });
    
    if (!existing) {
      if (!process.env.ADMIN_PASSWORD) {
        console.error('Refusing to seed the admin account without ADMIN_PASSWORD in .env.');
        return;
      }
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
      
      const admin = await User.create({
        name: 'Admin',
        email: adminEmail,
        password: hashedPassword,
        role: 'admin',
        isActive: true,
      });

      await AIMemory.create({ userId: admin._id });
      
      console.log(`✅ Admin account created: ${adminEmail}`);
      console.log('⚠️  Rotate the admin password in Settings after first login.');
    } else {
      console.log(`✅ Admin account already exists: ${adminEmail}`);
    }
  } catch (err) {
    console.error('Seed error:', err.message);
  }
}

module.exports = { seedAdmin };
