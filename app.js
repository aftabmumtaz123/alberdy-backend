const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const Variant = require('./model/variantProduct')
require('dotenv').config();
const categoryRoutes = require('./router/categories'); // Import routes
const productRoutes = require('./router/products'); // Import routes
const morgan = require('morgan');
const app = express();
const PORT = process.env.PORT || 5000;
// Middleware (parsers first!)
const cookieParser = require('cookie-parser'); // Add require
app.use(morgan('dev'));
app.use(cors());
app.set('trust proxy', 1);



const Offer = require('./model/Offer');

cron.schedule('0 0 * * *', async () => {
  try {
    await Offer.updateExpiredOffers();
    await Variant.updateExpiredVariants();
    const now = new Date();
    const productsWithEntries = await StockEntry.distinct('product');
    for (const prodId of productsWithEntries) {
      const currentStock = await calculateCurrentStock(prodId);
      await Product.findByIdAndUpdate(prodId, { stockQuantity: currentStock });
    }
    console.log('Daily stock recalculation and variant status update completed at', new Date());
  } catch (error) {
    console.error('Cron job failed:', error);
    // Optionally integrate a notification system (e.g., email or logging service)
  }
});



app.use(express.json());
app.use(cookieParser()); // Add cookie-parser middleware
app.use(express.urlencoded({ extended: true }));


const connection = require('./config/db'); // Connect to DB
connection();

// Routes
app.use('/api/products', productRoutes); // Example: Protected product routes
app.use('/api/brands', require('./router/brand')); // Example: Protected brand routes
app.use('/api/categories', categoryRoutes); // Example: Protected category routes
app.use('/api/subcategories', require('./router/subcategories')); // Example: Protected subcategory routes
app.use('/api/auth', require("./router/resetPassword"))
app.use('/api/units', require('./router/unit')); // Example: Protected unit routes
app.use('/api', require('./router/customer')); 
app.use('/api/expenses', require('./router/expense')); 
app.use('/api/expense-categories', require('./router/expenseCategory')); 
app.use('/api/currencies', require('./router/currency')); 
app.use('/api', require('./router/inventoryRoutes')); 
app.use('/api/configuration', require('./router/appConfigurationRouter')); 
app.use('/api/dashboard', require('./router/dashboard'));
app.use('/api/offer', require('./router/offer'));
app.use('/api/orders', require('./router/orderRouter')); 
app.use('/api/contact', require("./router/contactUs")) 
app.use('/', require('./router/authRouter')); 
app.use('/api/variants', require('./router/variant'));
app.use('/api/report', require('./router/reportsRouter'))


app.use('/api/supplier', require('./router/supplierRouter')); 
// app.use('/api/purchase', require('./router/purchaseRouter'));




app.get("/",(req,res)=>{
  res.json({Message: "API's are running well bro!!"})
})


app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

