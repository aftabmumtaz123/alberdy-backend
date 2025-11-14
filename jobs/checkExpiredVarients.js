const cron = require('node-cron');
const Variant = require('../model/variantProduct');

// Schedule job to run every day at midnight
const checkExpiredVariants = () => {
  cron.schedule('0 0 * * *', async () => {
    console.log('Running expired variants check...');
    try {
      const currentDate = new Date();
      const expiredVariants = await Variant.find({
        expiryDate: { $lte: currentDate },
        status: 'Active',
      });

      if (expiredVariants.length > 0) {
        await Variant.updateMany(
          { _id: { $in: expiredVariants.map((v) => v._id) } },
          { $set: { status: 'Inactive', updatedAt: new Date() } }
        );
        console.log(`${expiredVariants.length} variants marked as Inactive.`);
      } else {
        console.log('No expired variants found.');
      }
    } catch (err) {
      console.error('Error checking expired variants:', err.message);
    }
  });
};

module.exports = checkExpiredVariants;