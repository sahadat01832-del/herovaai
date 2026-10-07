const bcrypt = require('bcryptjs');
const User = require('../models/User');
const AIMemory = require('../models/AIMemory');

async function seedAdmin() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@contentbot.local';
    const existing = await User.findOne({ email: adminEmail });
    
    if (!existing) {
      const hashedPassword = await bcrypt.hash(
        process.env.ADMIN_PASSWORD || 'Admin@123456',
        12
      );
      
      const admin = await User.create({
        name: 'Admin',
        email: adminEmail,
        password: hashedPassword,
        role: 'admin',
        isActive: true,
      });

      await AIMemory.create({ userId: admin._id });
      
      console.log(`✅ Admin account created: ${adminEmail}`);
      console.log(`🔑 Default password: ${process.env.ADMIN_PASSWORD || 'Admin@123456'}`);
      console.log('⚠️  Please change the admin password after first login!');
    } else {
      console.log(`✅ Admin account already exists: ${adminEmail}`);
    }
  } catch (err) {
    console.error('Seed error:', err.message);
  }
}

module.exports = { seedAdmin };
