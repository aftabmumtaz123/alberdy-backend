const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(morgan('dev'));
app.use(cors());
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Database connection
const connection = require('./config/db');
connection();

// Models
const Offer = require('./model/Offer');
const Variant = require('./model/Variant');
const Product = require('./model/Product');
const StockEntry = require('./model/StockEntry');

// Calculate current stock for a product based on active variants
const calculateCurrentStock = async (productId) => {
  try {
    const variants = await Variant.find({
      product: productId,
      status: 'Active', // Only include active variants
    });
    const totalStock = variants.reduce((sum, variant) => sum + variant.stockQuantity, 0);
    return totalStock;
  } catch (error) {
    console.error(`Error calculating stock for product ${productId}:`, error);
    return 0;
  }
};

// Cron job: Daily at midnight (PKT)
cron.schedule('0 0 * * *', async () => {
  try {
    // Update expired offers
    await Offer.updateExpiredOffers();
    console.log('Expired offers updated');

    // Update expired variants
    await Variant.updateExpiredVariants();
    console.log('Expired variants updated');

    // Recompute product stock quantities
    const productsWithEntries = await StockEntry.distinct('product');
    for (const prodId of productsWithEntries) {
      const currentStock = await calculateCurrentStock(prodId);
      await Product.findByIdAndUpdate(prodId, { stockQuantity: currentStock });
    }
    console.log('Daily stock recalculation completed');
  } catch (error) {
    console.error('Cron job error:', error);
  }
}, {
  timezone: 'Asia/Karachi', // Ensure cron runs at midnight PKT (UTC+5)
});

// Routes
app.use('/api/products', require('./router/products'));
app.use('/api/brands', require('./router/brand'));
app.use('/api/categories', require('./router/categories'));
app.use('/api/subcategories', require('./router/subcategories'));
app.use('/api/reset-password', require('./router/resetPassword')); // Password reset routes
app.use('/api/units', require('./router/unit'));
app.use('/api/customer', require('./router/customer'));
app.use('/api/expenses', require('./router/expense'));
app.use('/api/expense-categories', require('./router/expenseCategory'));
app.use('/api/currencies', require('./router/currency'));
app.use('/api/inventory', require('./router/inventoryRoutes'));
app.use('/api/configuration', require('./router/appConfigurationRouter'));
app.use('/api/dashboard', require('./router/dashboard'));
app.use('/api/offers', require('./router/offer'));
app.use('/api/orders', require('./router/orderRouter'));
app.use('/api/contact', require('./router/contactUs'));
app.use('/api/auth', require('./router/authRouter')); // Authentication and user management
app.use('/api/variants', require('./router/variant'));

app.get('/', (req, res) => {
  res.json({ message: "API's are running well bro!!" });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));