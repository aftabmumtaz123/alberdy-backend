const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config();
// Require models at the top for better organization
const categoryRoutes = require('./router/categories'); // Import routes
const productRoutes = require('./router/products'); // Import routes
const morgan = require('morgan');
const app = express();
const PORT = process.env.PORT || 5000;
// Middleware (parsers first!)
const cookieParser = require('cookie-parser'); // Add require
app.use(morgan('dev'));
app.use(cors());



// Daily at midnight: Recompute all product stockQuantity excluding expired
cron.schedule('0 0 * * *', async () => {
  const now = new Date();
  const productsWithEntries = await StockEntry.distinct('product');
  for (const prodId of productsWithEntries) {
    const currentStock = await calculateCurrentStock(prodId);
    await Product.findByIdAndUpdate(prodId, { stockQuantity: currentStock });
  }
  console.log('Daily stock recalculation completed');
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
app.use('/api', require('./router/customer')); // Example: Protected customer routes
app.use('/api/expenses', require('./router/expense')); // Example: Protected expense routes
app.use('/api/expense-categories', require('./router/expenseCategory')); // Example: Protected expense category routes
app.use('/api/currencies', require('./router/currency')); // Example: Protected currency routes
app.use('/api', require('./router/inventoryRoutes')); // Example: Protected inventory routes
app.use('/configuration', require('./router/appConfigurationRouter')); // Example: Protected configuration routes
const dashboardRoutes = require('./router/dashboard');
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/offer', require('./router/offer'));
app.use('/api/orders', require('./router/orderRouter')); // Example: Protected order routes
app.use('/', require('./router/authRouter')); // Example: Auth routes (login, register, refresh, logout)

app.get("/",(req,res)=>{
  res.json({Message: "API's are running well bro!!"})
})

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));